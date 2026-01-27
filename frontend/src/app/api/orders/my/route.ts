import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

function normalizeStrapiBase(url: string) {
  let u = String(url ?? "").trim();
  u = u.endsWith("/") ? u.slice(0, -1) : u;
  if (u.toLowerCase().endsWith("/api")) u = u.slice(0, -4);
  return u;
}

function pickIdForOps(row: any) {
  // Strapi v5: documentId; v4: id
  return (
    row?.documentId ??
    row?.id ??
    row?.attributes?.documentId ??
    row?.attributes?.id ??
    null
  );
}

function pickField(row: any, key: string) {
  return row?.[key] ?? row?.attributes?.[key] ?? null;
}

async function fetchJson(url: string, init: RequestInit) {
  const r = await fetch(url, { ...init, cache: "no-store" });
  const json = await r.json().catch(() => null);
  return { r, json };
}

export async function GET() {
  const jwt = cookies().get("strapi_jwt")?.value;
  if (!jwt) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const strapiBase = normalizeStrapiBase(
    process.env.STRAPI_URL ||
      process.env.NEXT_PUBLIC_STRAPI_URL ||
      "http://localhost:1337"
  );

  // 1) Usuario logueado
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
  const userId = me?.id ?? null; // v4 users/me devuelve id
  const userEmail = String(me?.email || "").trim().toLowerCase();

  if (!userId && !userEmail) {
    return NextResponse.json(
      { error: "No se pudo resolver usuario (sin id/email)" },
      { status: 500 }
    );
  }

  // 2) Pedidos del usuario (preferimos relación user)
  const sp = new URLSearchParams();
  sp.set("pagination[pageSize]", "50");
  sp.set("sort[0]", "createdAt:desc");
  sp.set("populate", "*");

  // ✅ con la relación nueva en Order: user
  if (userId) {
    // Strapi v4 relation filter
    sp.set("filters[user][id][$eq]", String(userId));
  }

  let ordersRes = await fetchJson(`${strapiBase}/api/orders?${sp.toString()}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });

  const dataByUser = Array.isArray(ordersRes.json?.data) ? ordersRes.json.data : [];

  // 3) Fallback por email (para pedidos viejos sin user seteado)
  const shouldFallback =
    (!!userEmail && ordersRes.r.ok && dataByUser.length === 0) ||
    (!!userEmail && !ordersRes.r.ok);

  if (shouldFallback) {
    const sp2 = new URLSearchParams();
    sp2.set("filters[email][$eq]", userEmail);
    sp2.set("pagination[pageSize]", "50");
    sp2.set("sort[0]", "createdAt:desc");
    sp2.set("populate", "*");

    ordersRes = await fetchJson(`${strapiBase}/api/orders?${sp2.toString()}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
  }

  if (!ordersRes.r.ok) {
    return NextResponse.json(
      { error: "Strapi error", status: ordersRes.r.status, details: ordersRes.json },
      { status: ordersRes.r.status }
    );
  }

  const data = Array.isArray(ordersRes.json?.data) ? ordersRes.json.data : [];

  const orders = data.map((row: any) => ({
    id: pickIdForOps(row),
    orderNumber: pickField(row, "orderNumber"),
    orderStatus: pickField(row, "orderStatus"),
    total: pickField(row, "total"),
    createdAt: pickField(row, "createdAt"),
    shippingAddress: pickField(row, "shippingAddress"),
    items: pickField(row, "items"),
    // opcional, por si querés debug:
    // user: pickField(row, "user"),
    // email: pickField(row, "email"),
  }));

  return NextResponse.json({ orders }, { status: 200 });
}
