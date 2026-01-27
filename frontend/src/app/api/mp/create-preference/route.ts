// src/app/api/mp/create-preference/route.ts
import { NextResponse } from "next/server";

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

function normalizeStrapiBase(url: string) {
  let u = String(url ?? "").trim();
  u = u.endsWith("/") ? u.slice(0, -1) : u;
  if (u.toLowerCase().endsWith("/api")) u = u.slice(0, -4);
  return u;
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

// Evita mandar undefined/null/"" en metadata
function cleanObject<T extends Record<string, any>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== "")
  );
}

/* ===================== STRAPI HELPERS ===================== */

function pickAttr(row: any) {
  return row?.attributes ?? row ?? {};
}

function pickDocumentId(row: any): string | null {
  const attr = pickAttr(row);
  const v =
    row?.documentId ??
    row?.attributes?.documentId ??
    row?.attributes?.document_id ??
    attr?.documentId ??
    attr?.document_id ??
    null;

  const s = v != null ? String(v).trim() : "";
  return s ? s : null;
}

function pickTitle(row: any): string {
  const attr = pickAttr(row);
  return String(attr?.title ?? row?.title ?? "Producto");
}

function pickStock(row: any): number | null {
  const attr = pickAttr(row);
  const raw = attr?.stock ?? row?.stock ?? null;
  if (raw === null || raw === undefined) return null; // si no hay stock, no validamos
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

async function fetchStrapiJson(url: string, token: string) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const json = await r.json().catch(() => null);
  return { r, json };
}

async function getOrderFromStrapi(strapiBase: string, token: string, orderId: string) {
  // Strapi v5: /api/orders/:documentId
  const url = `${strapiBase}/api/orders/${encodeURIComponent(orderId)}?populate=*`;
  const { r, json } = await fetchStrapiJson(url, token);

  if (!r.ok || !json?.data) {
    return { ok: false as const, status: r.status, json };
  }

  // v4 puede venir con attributes; v5 suele venir flat
  const row = json.data;
  const flat = row?.attributes ? { id: row.id, documentId: row.documentId, ...row.attributes } : row;

  return { ok: true as const, data: flat, raw: json.data };
}

/* ===================== STOCK VALIDATION (BEFORE PAY) ===================== */

async function validateStockOrThrow(
  strapiBase: string,
  token: string,
  items: any[]
) {
  const need = new Map<string, { requested: number; title?: string }>();

  for (const it of Array.isArray(items) ? items : []) {
    const doc = String(it?.productDocumentId ?? "").trim();
    const qty = Number(it?.qty ?? it?.quantity ?? 0);
    if (!doc || !Number.isFinite(qty) || qty <= 0) continue;

    const prev = need.get(doc);
    need.set(doc, {
      requested: (prev?.requested ?? 0) + qty,
      title: String(it?.title ?? prev?.title ?? "Producto"),
    });
  }

  const docIds = Array.from(need.keys());
  if (!docIds.length) return;

  // Buscar productos por documentId
  const sp = new URLSearchParams();
  sp.set("pagination[pageSize]", String(Math.min(docIds.length, 100)));
  sp.set("populate", "*");
  sp.set("filters[publishedAt][$notNull]", "true");

  docIds.forEach((doc, i) => {
    sp.set(`filters[$or][${i}][documentId][$eq]`, doc);
  });

  const url = `${strapiBase}/api/products?${sp.toString()}`;
  const { r, json } = await fetchStrapiJson(url, token);

  if (!r.ok) {
    const err: any = new Error("STRAPI_PRODUCTS_FETCH_FAILED");
    err.code = "STRAPI_PRODUCTS_FETCH_FAILED";
    err.status = r.status;
    err.details = json;
    throw err;
  }

  const rows = Array.isArray(json?.data) ? json.data : [];

  const byDoc = new Map<string, any>();
  for (const row of rows) {
    const doc = pickDocumentId(row);
    if (doc) byDoc.set(doc, row);
  }

  const problems: Array<{
    productDocumentId: string;
    title: string;
    requested: number;
    available: number;
  }> = [];

  for (const doc of docIds) {
    const requested = need.get(doc)!.requested;
    const row = byDoc.get(doc);

    if (!row) {
      problems.push({
        productDocumentId: doc,
        title: need.get(doc)?.title ?? "Producto",
        requested,
        available: 0,
      });
      continue;
    }

    const stock = pickStock(row);

    // si stock es null => no validamos (producto sin control de stock)
    if (stock === null) continue;

    if (stock < requested) {
      problems.push({
        productDocumentId: doc,
        title: pickTitle(row),
        requested,
        available: stock,
      });
    }
  }

  if (problems.length) {
    const err: any = new Error("OUT_OF_STOCK");
    err.code = "OUT_OF_STOCK";
    err.problems = problems;
    throw err;
  }
}

/* ===================== ROUTE ===================== */

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
      { error: "NEXT_PUBLIC_SITE_URL inválida (http/https requerido)", got: rawSiteUrl },
      { status: 500 }
    );
  }

  const strapiBase = normalizeStrapiBase(
    process.env.STRAPI_URL || process.env.NEXT_PUBLIC_STRAPI_URL || "http://localhost:1337"
  );

  const strapiToken = process.env.STRAPI_TOKEN || process.env.STRAPI_API_TOKEN;
  if (!strapiToken) {
    return NextResponse.json(
      { error: "Falta STRAPI_TOKEN / STRAPI_API_TOKEN (server) para validar orden/stock" },
      { status: 500 }
    );
  }

  const orderId = String(body?.orderId ?? "").trim();
  if (!orderId) {
    return NextResponse.json(
      { error: "Falta orderId (documentId real de Strapi)" },
      { status: 400 }
    );
  }

  // ✅ 0) Traemos la orden REAL desde Strapi (no confiamos en lo que manda el front)
  const orderRes = await getOrderFromStrapi(strapiBase, strapiToken, orderId);
  if (!orderRes.ok) {
    return NextResponse.json(
      {
        error: "No se pudo obtener la orden desde Strapi",
        status: orderRes.status,
        details: orderRes.json,
      },
      { status: orderRes.status || 500 }
    );
  }

  const order = orderRes.data;

  const orderNumber = order?.orderNumber ? String(order.orderNumber) : null;
  const mpExternalReference =
    typeof order?.mpExternalReference === "string" && order.mpExternalReference.trim()
      ? order.mpExternalReference.trim()
      : (typeof body?.mpExternalReference === "string" ? body.mpExternalReference.trim() : "");

  if (!mpExternalReference) {
    return NextResponse.json(
      { error: "La orden no tiene mpExternalReference (ni vino por body). Re-creá la orden." },
      { status: 400 }
    );
  }

  const items = Array.isArray(order?.items) ? order.items : [];
  if (!items.length) {
    return NextResponse.json(
      { error: "La orden no tiene items válidos en Strapi" },
      { status: 400 }
    );
  }

  const totalNumber = Number(order?.total);
  if (!Number.isFinite(totalNumber) || totalNumber <= 0) {
    return NextResponse.json(
      { error: "La orden tiene total inválido en Strapi", total: order?.total },
      { status: 400 }
    );
  }

  // ✅ 1) VALIDAR STOCK ANTES DE PAGAR (contra Strapi)
  try {
    await validateStockOrThrow(strapiBase, strapiToken, items);
  } catch (e: any) {
    if (e?.code === "OUT_OF_STOCK") {
      return NextResponse.json(
        { error: "Sin stock suficiente", code: "OUT_OF_STOCK", problems: e.problems ?? [] },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: e?.message || "Error validando stock", code: e?.code, details: e?.details },
      { status: 500 }
    );
  }

  // ✅ 2) Normalizar items SOLO para sanity check (pero cobramos 1 item con el total final)
  const normalizedItems: MPItem[] = items
    .map((it: any) => {
      const title = String(it?.title ?? "Producto").trim();
      const quantityRaw = Number(it?.qty ?? it?.quantity ?? 1);
      const quantity = Number.isFinite(quantityRaw) ? Math.max(1, Math.floor(quantityRaw)) : 1;
      const unit_price = Number(it?.unit_price ?? it?.price ?? 0);

      return { title: title || "Producto", quantity, unit_price, currency_id: "ARS" as const };
    })
    .filter((it) => it.title && it.quantity > 0 && Number.isFinite(it.unit_price) && it.unit_price > 0);

  if (normalizedItems.length === 0) {
    return NextResponse.json(
      { error: "No hay items válidos en la orden para crear la preferencia" },
      { status: 400 }
    );
  }

  // 🔒 Cobrar EXACTAMENTE el total final de la orden en Strapi
  const chargeItems: MPItem[] = [
    {
      title: orderNumber ? `Pedido ${orderNumber}` : "Compra Amargo y Dulce",
      quantity: 1,
      unit_price: Math.round(totalNumber),
      currency_id: "ARS",
    },
  ];

  const external_reference = mpExternalReference;

  const notification_url = `${siteUrl}/api/mp/webhook`;
  const back_urls = {
    success: `${siteUrl}/gracias?status=success&orderId=${encodeURIComponent(orderId)}`,
    failure: `${siteUrl}/gracias?status=failure&orderId=${encodeURIComponent(orderId)}`,
    pending: `${siteUrl}/gracias?status=pending&orderId=${encodeURIComponent(orderId)}`,
  };

  const preferenceBody = {
    items: chargeItems,
    external_reference,
    back_urls,
    auto_return: "approved",
    notification_url,
    metadata: cleanObject({
      orderId,
      orderNumber: orderNumber ?? undefined,
      mpExternalReference: external_reference,
      // si querés, guardamos algo del total original
      total: String(Math.round(totalNumber)),
    }),
  };

  console.log("[create-preference] orderId:", orderId, "total:", Math.round(totalNumber));

  try {
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
      console.error("[create-preference] MP error (short):", {
        status: res.status,
        message: pickMpErrorMessage(data, "MercadoPago rechazó la preferencia"),
      });

      return NextResponse.json(
        {
          error: pickMpErrorMessage(data, "MercadoPago rechazó la preferencia"),
          status: res.status,
        },
        { status: res.status || 500 }
      );
    }

    return NextResponse.json({
      id: data.id,
      init_point: data.init_point,
      sandbox_init_point: data.sandbox_init_point,
      mpExternalReference: external_reference,
      orderId,
    });
  } catch (e: any) {
    console.error("[create-preference] fetch error:", e?.message || e);
    return NextResponse.json(
      { error: "Error conectando con MercadoPago" },
      { status: 500 }
    );
  }
}
