import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/orders/:id
 *
 * - Acepta id numérico de Strapi O orderNumber
 * - Si :id es numérico → busca por id
 * - Si :id NO es numérico → busca por orderNumber
 * - Devuelve la orden normalizada
 */

function isNumericId(v: string) {
  return /^\d+$/.test(v);
}

function normalizeBaseUrl(url: string) {
  const u = String(url ?? "").trim();
  return u.endsWith("/") ? u.slice(0, -1) : u;
}

export async function GET(
  _: Request,
  { params }: { params: { id: string } }
) {
  const strapiBase = normalizeBaseUrl(
    process.env.STRAPI_URL ||
      process.env.NEXT_PUBLIC_STRAPI_URL ||
      "http://localhost:1337"
  );

  const token =
    process.env.STRAPI_API_TOKEN || process.env.STRAPI_TOKEN;

  if (!token) {
    return NextResponse.json(
      { error: "Falta STRAPI_API_TOKEN / STRAPI_TOKEN" },
      { status: 500 }
    );
  }

  const idOrNumber = params.id;

  // 🔑 FIX: soportar ID o orderNumber
  const query = isNumericId(idOrNumber)
    ? `filters[id][$eq]=${encodeURIComponent(idOrNumber)}`
    : `filters[orderNumber][$eq]=${encodeURIComponent(idOrNumber)}`;

  const url = `${strapiBase}/api/orders?${query}&populate=*`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    return NextResponse.json(
      {
        error: "Strapi error",
        status: res.status,
        details: json,
      },
      { status: res.status }
    );
  }

  const row = json?.data?.[0];
  if (!row) {
    return NextResponse.json(
      { error: "Order not found", id: idOrNumber },
      { status: 404 }
    );
  }

  // Normalizamos respuesta (muy útil para frontend)
  return NextResponse.json({
    data: {
      id: row.id,
      ...row.attributes,
    },
  });
}
