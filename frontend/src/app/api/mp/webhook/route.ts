// src/app/api/mp/webhook/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Webhook Mercado Pago (Checkout Pro)
 * - Recibe notificación (query o body)
 * - Consulta el pago real en MP
 * - Actualiza la orden en Strapi con mpPaymentId, mpStatus, orderStatus
 *
 * IMPORTANTE:
 * - external_reference puede ser orderId o orderNumber
 * - Si es orderNumber -> buscamos por filters[orderNumber] y tomamos el id real
 *
 * FIX para tu 404:
 * - Normalizamos STRAPI_URL para evitar casos donde termina en /api y queda /api/api/...
 */

function pickPaymentInfo(url: URL, body: any) {
  const typeFromQuery =
    url.searchParams.get("type") ||
    url.searchParams.get("topic") ||
    url.searchParams.get("action"); // a veces viene "payment.created"

  const qpId =
    url.searchParams.get("data.id") ||
    url.searchParams.get("id") ||
    url.searchParams.get("data[id]") ||
    url.searchParams.get("payment_id") ||
    url.searchParams.get("collection_id");

  const bodyType = body?.type || body?.topic || body?.action;
  const bodyId = body?.data?.id || body?.data?.["id"] || body?.id;

  const type = typeFromQuery || bodyType || undefined;
  const paymentId = qpId || bodyId || null;

  return { type, paymentId: paymentId ? String(paymentId) : null };
}

function mapMpToOrderStatus(mpStatus?: string) {
  switch (mpStatus) {
    case "approved":
      return "paid";
    case "rejected":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "pending";
  }
}

// ✅ Fix: normaliza base y elimina /api final para evitar /api/api
function normalizeStrapiBase(url: string) {
  let u = String(url ?? "").trim();
  u = u.endsWith("/") ? u.slice(0, -1) : u;
  if (u.toLowerCase().endsWith("/api")) u = u.slice(0, -4);
  return u;
}

function isNumericId(v: string) {
  return /^\d+$/.test(v);
}

async function findOrderIdInStrapi(
  strapiBase: string,
  token: string,
  externalRef: string
) {
  // Caso A: external_reference es el id numérico de Strapi
  if (isNumericId(externalRef)) return externalRef;

  // Caso B: external_reference es orderNumber (ej "AMG-0033")
  const q = new URLSearchParams({
    "filters[orderNumber][$eq]": externalRef,
    "pagination[pageSize]": "1",
    "fields[0]": "id",
  });

  const res = await fetch(`${strapiBase}/api/orders?${q.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data) {
    const text = data ? JSON.stringify(data) : "";
    throw new Error(`Strapi search failed (${res.status}) ${text}`);
  }

  const id = data?.data?.[0]?.id;
  return id ? String(id) : null;
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);

    // Body (a veces viene vacío o no es JSON)
    let body: any = null;
    try {
      body = await req.json();
    } catch {
      // ok
    }

    const { type, paymentId } = pickPaymentInfo(url, body);

    // Respuesta rápida
    if (!paymentId) return NextResponse.json({ ok: true }, { status: 200 });

    // Algunos envían "payment.created" / "payment.updated"
    if (type && !String(type).includes("payment")) {
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const accessToken = process.env.MP_ACCESS_TOKEN;
    if (!accessToken) {
      console.error("Webhook: falta MP_ACCESS_TOKEN");
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    // 1) Consultar el pago real en MP
    const payRes = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      }
    );

    const payment = await payRes.json().catch(() => null);

    if (!payRes.ok || !payment) {
      const errText = payment ? JSON.stringify(payment) : "";
      console.error("Webhook: MP payment fetch failed", payRes.status, errText);
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const mpStatus: string | undefined = payment?.status;
    const mpStatusDetail: string | undefined = payment?.status_detail;

    const externalRefRaw =
      payment?.external_reference ??
      payment?.metadata?.orderId ??
      payment?.metadata?.orderNumber;

    if (!externalRefRaw) {
      console.warn("Webhook: payment sin external_reference / metadata", {
        paymentId,
        mpStatus,
      });
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const externalRef = String(externalRefRaw);

    // 2) Update en Strapi
    const strapiBase = normalizeStrapiBase(
      process.env.STRAPI_URL ||
        process.env.NEXT_PUBLIC_STRAPI_URL ||
        "http://localhost:1337"
    );

    const token = process.env.STRAPI_API_TOKEN || process.env.STRAPI_TOKEN;
    if (!token) {
      console.error("Webhook: falta STRAPI_API_TOKEN / STRAPI_TOKEN");
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    // ✅ FIX PRINCIPAL: resolver el ID real de la orden
    let orderId: string | null = null;
    try {
      orderId = await findOrderIdInStrapi(strapiBase, token, externalRef);
    } catch (e: any) {
      console.error("Webhook: no pude resolver orderId en Strapi", e?.message || e);
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    if (!orderId) {
      console.warn("Webhook: order no encontrada en Strapi para externalRef:", externalRef);
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    const orderStatus = mapMpToOrderStatus(mpStatus);

    const updatePayload = {
      data: {
        orderStatus,
        mpPaymentId: String(paymentId),
        mpStatus: mpStatus ? String(mpStatus) : null,
        mpStatusDetail: mpStatusDetail ? String(mpStatusDetail) : null,
        mpMerchantOrderId: payment?.order?.id ? String(payment.order.id) : null,
        mpExternalReference: externalRef, // ahora existe en Strapi (schema.json)
      },
    };

    const updateUrl = `${strapiBase}/api/orders/${encodeURIComponent(orderId)}`;
    console.log("[Webhook] strapiBase:", strapiBase);
    console.log("[Webhook] orderId resolved:", orderId);
    console.log("[Webhook] update URL:", updateUrl);

    const updateRes = await fetch(updateUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(updatePayload),
      cache: "no-store",
    });

    if (!updateRes.ok) {
      const text = await updateRes.text().catch(() => "");
      console.error("Webhook: Strapi update failed", updateRes.status, text || "(no body)");
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    console.error("Webhook: fatal error", err?.message || err);
    return NextResponse.json({ ok: true }, { status: 200 });
  }
}

// Por compatibilidad (algunas configs viejas envían GET)
export async function GET(req: Request) {
  return POST(req);
}

