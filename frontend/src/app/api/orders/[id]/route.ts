import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

/**
 * GET /api/orders/:id
 *
 * Soporta:
 * - documentId (Strapi v5)
 * - orderNumber (ej: "AMG-0051")
 * - id numérico (legacy)
 *
 * Seguridad:
 * - Requiere cookie strapi_jwt (usuario logueado)
 * - Solo devuelve el pedido si pertenece al usuario (order.user.id === me.id)
 *   o si coincide email (fallback para pedidos viejos sin relación user)
 */

function isNumeric(v: string) {
  return /^\d+$/.test(v);
}

function normalizeStrapiBase(url: string) {
  let u = String(url ?? "").trim();
  u = u.endsWith("/") ? u.slice(0, -1) : u;
  if (u.toLowerCase().endsWith("/api")) u = u.slice(0, -4);
  return u;
}

async function fetchStrapi(url: string, jwt: string) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${jwt}` },
    cache: "no-store",
  });
  const json = await res.json().catch(() => null);
  return { res, json };
}

// Normaliza row a "flat" + devuelve también raw
function normalizeOrderRow(row: any) {
  const flat = row?.attributes ? { id: row.id, ...row.attributes } : row;
  return {
    data: {
      documentId: flat?.documentId ?? row?.documentId ?? null,
      id: flat?.id ?? row?.id ?? null,
      ...flat,
    },
    raw: row,
  };
}

function pickOwnerInfo(row: any) {
  // soporta v4: row.attributes.user.data.id
  // soporta v5 (posible): row.user?.id
  const userId =
    row?.user?.id ??
    row?.attributes?.user?.data?.id ??
    row?.attributes?.user?.data?.documentId ??
    row?.user?.data?.id ??
    null;

  const email =
    row?.email ??
    row?.attributes?.email ??
    null;

  return { userId, email: typeof email === "string" ? email.trim().toLowerCase() : null };
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const jwt = cookies().get("strapi_jwt")?.value;
  if (!jwt) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const strapiBase = normalizeStrapiBase(
    process.env.STRAPI_URL ||
      process.env.NEXT_PUBLIC_STRAPI_URL ||
      "http://localhost:1337"
  );

  const idOrNumber = String(params.id || "").trim();
  if (!idOrNumber) {
    return NextResponse.json({ error: "Falta id" }, { status: 400 });
  }

  // 0) Usuario logueado (para chequear ownership)
  const meRes = await fetchStrapi(`${strapiBase}/api/users/me`, jwt);
  if (!meRes.res.ok) {
    return NextResponse.json(
      { error: "JWT inválido o expirado", status: meRes.res.status, details: meRes.json },
      { status: 401 }
    );
  }
  const me = meRes.json;
  const meId = me?.id ?? null;
  const meEmail = typeof me?.email === "string" ? me.email.trim().toLowerCase() : null;

  if (!meId && !meEmail) {
    return NextResponse.json({ error: "No se pudo resolver usuario" }, { status: 500 });
  }

  async function authorizeAndReturn(row: any) {
    const { userId, email } = pickOwnerInfo(row);

    const okByUser = !!meId && !!userId && String(userId) === String(meId);
    const okByEmail = !!meEmail && !!email && email === meEmail;

    if (!okByUser && !okByEmail) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const normalized = normalizeOrderRow(row);
    return NextResponse.json({ data: normalized.data }, { status: 200 });
  }

  // 1) Intento directo por documentId (Strapi v5)
  {
    const url = `${strapiBase}/api/orders/${encodeURIComponent(idOrNumber)}?populate=*`;
    const { res, json } = await fetchStrapi(url, jwt);

    if (res.ok && json?.data) {
      return authorizeAndReturn(json.data);
    }

    if (!res.ok && res.status !== 404) {
      return NextResponse.json(
        { error: "Strapi error", status: res.status, details: json },
        { status: res.status }
      );
    }
  }

  // 2) Buscar por orderNumber (AMG-XXXX)
  {
    const q = new URLSearchParams();
    q.set("filters[orderNumber][$eq]", idOrNumber);
    q.set("pagination[pageSize]", "1");
    q.set("populate", "*");

    const url = `${strapiBase}/api/orders?${q.toString()}`;
    const { res, json } = await fetchStrapi(url, jwt);

    if (!res.ok) {
      return NextResponse.json(
        { error: "Strapi error", status: res.status, details: json },
        { status: res.status }
      );
    }

    const row = json?.data?.[0];
    if (row) return authorizeAndReturn(row);
  }

  // 3) Fallback por id numérico
  if (isNumeric(idOrNumber)) {
    const q = new URLSearchParams();
    q.set("filters[id][$eq]", idOrNumber);
    q.set("pagination[pageSize]", "1");
    q.set("populate", "*");

    const url = `${strapiBase}/api/orders?${q.toString()}`;
    const { res, json } = await fetchStrapi(url, jwt);

    if (!res.ok) {
      return NextResponse.json(
        { error: "Strapi error", status: res.status, details: json },
        { status: res.status }
      );
    }

    const row = json?.data?.[0];
    if (row) return authorizeAndReturn(row);
  }

  return NextResponse.json(
    { error: "Order not found", id: idOrNumber },
    { status: 404 }
  );
}
