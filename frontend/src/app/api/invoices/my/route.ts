// src/app/api/invoices/my/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

function normalizeStrapiBase(url: string) {
  let u = String(url ?? "").trim();
  u = u.endsWith("/") ? u.slice(0, -1) : u;
  if (u.toLowerCase().endsWith("/api")) u = u.slice(0, -4);
  return u;
}

async function fetchJson(url: string, init: RequestInit) {
  const r = await fetch(url, { ...init, cache: "no-store" });
  const text = await r.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text || null };
  }
  return { r, json, text };
}

function flattenAny(row: any) {
  if (!row) return null;
  if (row?.attributes) return { id: row.id, documentId: row.documentId, ...row.attributes };
  return row;
}

function pickAttr(row: any) {
  return row?.attributes ?? row ?? {};
}

function toAbsStrapiUrl(strapiBase: string, maybeUrl: any) {
  const u = typeof maybeUrl === "string" ? maybeUrl.trim() : "";
  if (!u) return null;
  if (/^https?:\/\//i.test(u)) return u;
  return `${strapiBase}${u.startsWith("/") ? "" : "/"}${u}`;
}

function pickPdfUrl(strapiBase: string, pdfField: any) {
  const node = pdfField?.data ?? pdfField;
  const row = Array.isArray(node) ? node[0] : node;
  const flat = pickAttr(row);
  return toAbsStrapiUrl(strapiBase, flat?.url);
}

/**
 * Extrae AMG-#### desde un invoice.number (soporta RC-...-AMG-#### y RC_..._AMG-####)
 */
function extractOrderNumberFromInvoiceNumber(invoiceNumber: any): string | null {
  const s = String(invoiceNumber ?? "").trim();
  if (!s) return null;
  const m = /(AMG-\d{4,})/i.exec(s);
  return m?.[1] ? m[1].toUpperCase() : null;
}

/**
 * Trae las órdenes del usuario (server token) y devuelve sus orderNumber
 * (fallback por email si no hay relación user en tu Order)
 */
async function getMyOrderNumbers(params: {
  strapiBase: string;
  serverToken: string;
  userId: string | null;
  userEmail: string | null;
}) {
  const { strapiBase, serverToken, userId, userEmail } = params;
  const headers = { Authorization: `Bearer ${serverToken}` };

  // Intento 1: por relación user.id
  if (userId) {
    const sp = new URLSearchParams();
    sp.set("pagination[pageSize]", "200");
    sp.set("fields[0]", "orderNumber");
    sp.set("filters[user][id][$eq]", String(userId));
    const url = `${strapiBase}/api/orders?${sp.toString()}`;

    const res = await fetchJson(url, { headers });
    if (res.r.ok) {
      const data = Array.isArray(res.json?.data) ? res.json.data : [];
      const set = new Set<string>();
      for (const row of data) {
        const flat = flattenAny(row);
        const on = typeof flat?.orderNumber === "string" ? flat.orderNumber.trim() : "";
        if (on) set.add(on.toUpperCase());
      }
      if (set.size) return { set, used: "userId" as const, url };
    }
  }

  // Intento 2: por email
  if (userEmail) {
    const sp = new URLSearchParams();
    sp.set("pagination[pageSize]", "200");
    sp.set("fields[0]", "orderNumber");
    sp.set("filters[email][$eq]", String(userEmail));
    const url = `${strapiBase}/api/orders?${sp.toString()}`;

    const res = await fetchJson(url, { headers });
    if (res.r.ok) {
      const data = Array.isArray(res.json?.data) ? res.json.data : [];
      const set = new Set<string>();
      for (const row of data) {
        const flat = flattenAny(row);
        const on = typeof flat?.orderNumber === "string" ? flat.orderNumber.trim() : "";
        if (on) set.add(on.toUpperCase());
      }
      return { set, used: "email" as const, url };
    }

    return { set: new Set<string>(), used: "email" as const, url };
  }

  return { set: new Set<string>(), used: "none" as const, url: null as any };
}

/**
 * Lista invoices con populate de pdf (y solo eso).
 * Importante: NO usamos `order` porque NO existe en tu Invoice.
 */
async function listInvoicesWithPdf(strapiBase: string, token: string) {
  const headers = { Authorization: `Bearer ${token}` };

  // Intento A: populate[0]=pdf + sort issuedAt desc
  {
    const sp = new URLSearchParams();
    sp.set("pagination[pageSize]", "200");
    sp.set("sort[0]", "issuedAt:desc");
    sp.set("populate[0]", "pdf");
    const url = `${strapiBase}/api/invoices?${sp.toString()}`;
    const res = await fetchJson(url, { headers });
    if (res.r.ok) return { ok: true as const, url, ...res };
    if (res.r.status !== 400) return { ok: false as const, url, ...res };
  }

  // Intento B: populate=pdf + sort issuedAt desc
  {
    const sp = new URLSearchParams();
    sp.set("pagination[pageSize]", "200");
    sp.set("sort[0]", "issuedAt:desc");
    sp.append("populate", "pdf");
    const url = `${strapiBase}/api/invoices?${sp.toString()}`;
    const res = await fetchJson(url, { headers });
    if (res.r.ok) return { ok: true as const, url, ...res };
    if (res.r.status !== 400) return { ok: false as const, url, ...res };
  }

  // Intento C: sin populate, pero con sort fallback createdAt desc
  {
    const sp = new URLSearchParams();
    sp.set("pagination[pageSize]", "200");
    // algunos setups no tienen issuedAt, por eso fallback:
    sp.set("sort[0]", "createdAt:desc");
    const url = `${strapiBase}/api/invoices?${sp.toString()}`;
    const res = await fetchJson(url, { headers });
    return { ok: res.r.ok as boolean, url, ...res };
  }
}

export async function GET() {
  const jwt = cookies().get("strapi_jwt")?.value || null;
  if (!jwt) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const strapiBase = normalizeStrapiBase(
    process.env.STRAPI_URL || process.env.NEXT_PUBLIC_STRAPI_URL || "http://localhost:1337"
  );

  const serverToken = process.env.STRAPI_API_TOKEN || process.env.STRAPI_TOKEN || null;
  if (!serverToken) {
    return NextResponse.json(
      { error: "Falta STRAPI_API_TOKEN/STRAPI_TOKEN en Next (.env)" },
      { status: 500 }
    );
  }

  // 1) identidad del usuario (JWT)
  const meRes = await fetchJson(`${strapiBase}/api/users/me`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  if (!meRes.r.ok) {
    return NextResponse.json(
      { error: "JWT inválido o expirado", status: meRes.r.status, details: meRes.json },
      { status: 401 }
    );
  }

  const me = meRes.json;
  const userId = me?.id != null ? String(me.id) : null;
  const userEmail = typeof me?.email === "string" ? me.email.trim().toLowerCase() : null;

  // 2) Traer mis orders -> set de orderNumber
  const myOrders = await getMyOrderNumbers({
    strapiBase,
    serverToken,
    userId,
    userEmail,
  });

  const myOrderNumbers = myOrders.set;

  if (myOrderNumbers.size === 0) {
    return NextResponse.json(
      {
        invoices: [],
        debug: {
          reason: "no_orders",
          usedOrderLookup: myOrders.used,
          ordersUrl: myOrders.url,
        },
      },
      { status: 200 }
    );
  }

  // 3) Listar invoices (server token) SOLO con pdf
  const list = await listInvoicesWithPdf(strapiBase, serverToken);

  if (!list.ok) {
    return NextResponse.json(
      {
        error: "Strapi error (list invoices)",
        status: list.r.status,
        url: list.url,
        details: list.json,
      },
      { status: list.r.status || 500 }
    );
  }

  const rows = Array.isArray(list.json?.data) ? list.json.data : [];

  // 4) Filtrar por AMG-#### extraído del invoice.number (soporta RC- y RC_)
  const ownedRows = rows.filter((row: any) => {
    const inv = flattenAny(row);
    const number = typeof inv?.number === "string" ? inv.number.trim() : "";
    if (!number) return false;

    const on = extractOrderNumberFromInvoiceNumber(number);
    if (!on) return false;

    return myOrderNumbers.has(on);
  });

  // 5) Mapear
  const invoices = ownedRows.map((row: any) => {
    const inv = flattenAny(row);
    const invNumber = inv?.number ?? null;

    return {
      id: inv?.documentId ?? inv?.id ?? null,
      number: invNumber,
      issuedAt: inv?.issuedAt ?? inv?.createdAt ?? null,
      total: inv?.total ?? null,
      currency: inv?.currency ?? "ARS",
      pdfUrl: pickPdfUrl(strapiBase, inv?.pdf),
      orderNumber: extractOrderNumberFromInvoiceNumber(invNumber),
    };
  });

  return NextResponse.json(
    {
      invoices,
      debug: {
        totalInvoicesFetched: rows.length,
        totalOwned: invoices.length,
        myOrderNumbers: myOrderNumbers.size,
        usedOrderLookup: myOrders.used,
        ordersUrl: myOrders.url,
        invoicesUrl: list.url,
      },
    },
    { status: 200 }
  );
}
