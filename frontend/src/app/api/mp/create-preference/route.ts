import { NextResponse } from "next/server";

/**
 * /api/mp/create-preference
 * Crea una preferencia de Checkout Pro (MercadoPago)
 *
 * Requisitos:
 * - MP_ACCESS_TOKEN (server-only)
 * - NEXT_PUBLIC_SITE_URL (URL PUBLICA: ngrok o dominio real; NO localhost si querés webhook)
 *
 * Este handler:
 * - valida items
 * - usa external_reference = orderNumber (si existe) o orderId (Strapi)
 * - agrega orderId y orderNumber a back_urls para polling post-redirect
 * - SIEMPRE manda notification_url (clave para webhook)
 */

export const dynamic = "force-dynamic";

type MPItem = {
  title: string;
  quantity: number;
  unit_price: number;
  currency_id: "ARS";
};

function normalizeBaseUrl(url: string) {
  const u = String(url ?? "").trim();
  return u.endsWith("/") ? u.slice(0, -1) : u;
}

function isHttpUrl(url: string) {
  return /^https?:\/\//i.test(url);
}

function pickMpErrorMessage(payload: any, fallback: string) {
  if (!payload) return fallback;
  if (typeof payload === "string") return payload;
  if (payload?.message) return payload.message;
  if (payload?.error) return payload.error;
  if (payload?.cause?.[0]?.description) return payload.cause[0].description;
  return fallback;
}

// Evita mandar undefined en metadata
function cleanObject<T extends Record<string, any>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== "")
  );
}

export async function POST(req: Request) {
  let body: any;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Body inválido (se esperaba JSON)" },
      { status: 400 }
    );
  }

  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    return NextResponse.json(
      { error: "Falta MP_ACCESS_TOKEN en el servidor" },
      { status: 500 }
    );
  }

  const rawSiteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const siteUrl = normalizeBaseUrl(rawSiteUrl);

  if (!isHttpUrl(siteUrl)) {
    return NextResponse.json(
      {
        error: "NEXT_PUBLIC_SITE_URL inválida. Debe empezar con http:// o https://",
        got: rawSiteUrl,
      },
      { status: 500 }
    );
  }

  const { orderId, orderNumber, items } = body ?? {};

  if (!orderId) {
    return NextResponse.json(
      { error: "Falta orderId (id de Strapi)" },
      { status: 400 }
    );
  }

  // Normalizar items (y asegurarnos que quantity sea entero)
  const normalizedItems: MPItem[] = (Array.isArray(items) ? items : [])
    .map((it: any) => {
      const title = String(it?.title ?? "Producto").trim();
      const quantityRaw = Number(it?.qty ?? it?.quantity ?? 1);
      const quantity = Number.isFinite(quantityRaw) ? Math.max(1, Math.floor(quantityRaw)) : 1;
      const unit_price = Number(it?.unit_price ?? it?.price ?? 0);

      return {
        title: title || "Producto",
        quantity,
        unit_price,
        currency_id: "ARS",
      };
    })
    .filter(
      (it) =>
        it.title &&
        it.quantity > 0 &&
        Number.isFinite(it.unit_price) &&
        it.unit_price > 0
    );

  if (normalizedItems.length === 0) {
    return NextResponse.json(
      { error: "No hay items válidos para crear la preferencia" },
      { status: 400 }
    );
  }

  // ✅ CORRECCION CLAVE:
  // external_reference debe ser un identificador que puedas buscar fácil en el webhook.
  // Preferible orderNumber si existe (más estable y legible), sino orderId.
  // ✅ DESPUÉS (FIX)
  const external_reference = String(orderId);


  // ✅ CORRECCION CLAVE:
  // notification_url debe ser PUBLICA y estable.
  // Si NEXT_PUBLIC_SITE_URL es localhost, MP NO podrá pegarle.
  const notification_url = `${siteUrl}/api/mp/webhook`;

  // ✅ back_urls con datos útiles para tu pantalla de confirmación/polling
  const back_urls = {
    success: `${siteUrl}/checkout?status=success&orderId=${encodeURIComponent(
      String(orderId)
    )}&external_reference=${encodeURIComponent(external_reference)}`,
    failure: `${siteUrl}/checkout?status=failure&orderId=${encodeURIComponent(
      String(orderId)
    )}&external_reference=${encodeURIComponent(external_reference)}`,
    pending: `${siteUrl}/checkout?status=pending&orderId=${encodeURIComponent(
      String(orderId)
    )}&external_reference=${encodeURIComponent(external_reference)}`,
  };

  const preferenceBody = {
    items: normalizedItems,
    external_reference,
    back_urls,
    auto_return: "approved",
    notification_url,
    metadata: cleanObject({
      orderId: String(orderId),
      orderNumber: orderNumber ? String(orderNumber) : undefined,
    }),
  };

  console.log("MP preferenceBody:", preferenceBody);

  const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(preferenceBody),
    cache: "no-store",
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    console.error("MP preference error:", data);
    return NextResponse.json(
      {
        error: pickMpErrorMessage(data, "MercadoPago rechazó la preferencia"),
        mp: data,
      },
      { status: res.status || 500 }
    );
  }

  return NextResponse.json({
    id: data.id,
    init_point: data.init_point,
    sandbox_init_point: data.sandbox_init_point,
  });
}

