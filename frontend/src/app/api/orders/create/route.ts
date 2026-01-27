// src/app/api/orders/create/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

function normalizeStrapiBase(url: string) {
  let u = String(url ?? "").trim();
  u = u.endsWith("/") ? u.slice(0, -1) : u;
  // evita /api/api
  if (u.toLowerCase().endsWith("/api")) u = u.slice(0, -4);
  return u;
}

function isNonEmptyString(v: any): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function safeUUID() {
  const fn = (crypto as any)?.randomUUID;
  if (typeof fn === "function") return fn.call(crypto);
  return crypto.randomBytes(16).toString("hex");
}

function makeOrderNumber(numericId: string | number) {
  const n = Number(numericId);
  const padded = String(isNaN(n) ? numericId : n).padStart(4, "0");
  return `AMG-${padded}`;
}

async function strapiJSON(res: Response) {
  const data = await res.json().catch(() => null);
  return data;
}

function badRequest(msg: string, fields?: Record<string, any>) {
  return NextResponse.json({ error: msg, fields }, { status: 400 });
}

function readShipping(obj: any) {
  const s = obj?.shippingAddress ?? null;
  return {
    street: isNonEmptyString(s?.street) ? s.street.trim() : "",
    number: isNonEmptyString(s?.number) ? s.number.trim() : "",
    city: isNonEmptyString(s?.city) ? s.city.trim() : "",
    province: isNonEmptyString(s?.province) ? s.province.trim() : "",
    postalCode: isNonEmptyString(s?.postalCode) ? s.postalCode.trim() : "",
    notes: isNonEmptyString(s?.notes) ? s.notes.trim() : "",
    // text puede venir o lo generamos
    text: isNonEmptyString(s?.text) ? s.text.trim() : "",
  };
}

async function getLoggedUser(strapiBase: string) {
  const jwt = cookies().get("strapi_jwt")?.value;
  if (!jwt) return null;

  try {
    const r = await fetch(`${strapiBase}/api/users/me`, {
      headers: { Authorization: `Bearer ${jwt}` },
      cache: "no-store",
    });

    if (!r.ok) return null;

    const me = await r.json().catch(() => null);
    const id = me?.id ?? null; // Strapi v4 devuelve id
    const email = typeof me?.email === "string" ? me.email.trim().toLowerCase() : null;

    if (!id) return null;
    return { id, email };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const strapiBase = normalizeStrapiBase(
    process.env.STRAPI_URL ||
      process.env.NEXT_PUBLIC_STRAPI_URL ||
      "http://localhost:1337"
  );

  // Este token es el de servidor (API token) para crear la orden en Strapi
  const token = process.env.STRAPI_TOKEN || process.env.STRAPI_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "Falta STRAPI_TOKEN / STRAPI_API_TOKEN en .env.local (Next)" },
      { status: 500 }
    );
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Body inválido (se esperaba JSON)" },
      { status: 400 }
    );
  }

  // Acepta {data:{...}} o {...}
  const incomingData =
    body && typeof body === "object" && "data" in body ? body.data : body;

  if (!incomingData || typeof incomingData !== "object") {
    return NextResponse.json(
      { error: "Body inválido: se esperaba un objeto con datos de la orden" },
      { status: 400 }
    );
  }

  // ✅ si hay usuario logueado, lo resolvemos acá (id + email)
  const logged = await getLoggedUser(strapiBase);

  // ===================== VALIDACIONES server-side (obligatorios) =====================

  const name = isNonEmptyString(incomingData.name) ? incomingData.name.trim() : "";

  // ✅ si está logueado, usamos SIEMPRE el email del usuario
  const email = logged?.email
    ? logged.email
    : isNonEmptyString(incomingData.email)
    ? incomingData.email.trim().toLowerCase()
    : "";

  const phone = isNonEmptyString(incomingData.phone) ? incomingData.phone.trim() : "";

  if (name.length < 2) return badRequest("Nombre inválido", { name });
  if (!email.includes("@")) return badRequest("Email inválido", { email });
  if (phone.length < 6) return badRequest("Teléfono inválido", { phone });

  const shipping = readShipping(incomingData);

  if (shipping.street.length < 2) return badRequest("Falta street", { street: shipping.street });
  if (shipping.number.length < 1) return badRequest("Falta number", { number: shipping.number });
  if (shipping.city.length < 2) return badRequest("Falta city", { city: shipping.city });
  if (shipping.province.length < 2) return badRequest("Falta province", { province: shipping.province });
  if (shipping.postalCode.length < 4) return badRequest("Falta postalCode", { postalCode: shipping.postalCode });

  // items mínimos
  const items = Array.isArray(incomingData.items) ? incomingData.items : [];
  if (items.length === 0) return badRequest("Tu carrito está vacío (items).");

  // total mínimo
  const total = Number(incomingData.total);
  if (!Number.isFinite(total) || total <= 0) return badRequest("Total inválido", { total: incomingData.total });

  // ===================== Normalizaciones =====================

  // mpExternalReference server-side (si no viene)
  const mpExternalReference = isNonEmptyString(incomingData.mpExternalReference)
    ? incomingData.mpExternalReference.trim()
    : safeUUID();

  // si no vino text, lo generamos acá para consistencia
  const shippingText =
    shipping.text ||
    `${shipping.street} ${shipping.number}, ${shipping.city}, ${shipping.province} (${shipping.postalCode})`;

  // 1) CREATE en Strapi
  const createPayload = {
    data: {
      // No confiamos en que el cliente mande todo perfecto: sobreescribimos normalizados
      ...incomingData,
      name,
      email,
      phone,
      total,
      items,

      shippingAddress: {
        street: shipping.street,
        number: shipping.number,
        city: shipping.city,
        province: shipping.province,
        postalCode: shipping.postalCode,
        notes: shipping.notes || null,
        text: shippingText,
      },

      mpExternalReference,

      // ✅ guardar relación con el usuario logueado (nuevo campo relation en Order)
      ...(logged?.id ? { user: logged.id } : {}),

      // NO ponemos orderNumber acá porque todavía no tenemos numericId con certeza
    },
  };

  console.log(
    "[orders/create] → Strapi CREATE payload:",
    JSON.stringify(createPayload, null, 2)
  );

  const createRes = await fetch(`${strapiBase}/api/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(createPayload),
    cache: "no-store",
  });

  const created = await strapiJSON(createRes);

  if (!createRes.ok) {
    console.error("[orders/create] Strapi CREATE returned", createRes.status, created);
    return NextResponse.json(
      { error: "Strapi error (create)", details: created },
      { status: createRes.status || 500 }
    );
  }

  // Strapi v5: para PUT /api/orders/:id usamos documentId
  const documentId = created?.data?.documentId ? String(created.data.documentId) : null;
  const numericId = created?.data?.id ? String(created.data.id) : null;

  if (!documentId) {
    return NextResponse.json(
      {
        error: "Strapi no devolvió documentId al crear la orden",
        strapi: created,
      },
      { status: 500 }
    );
  }

  const orderNumber = numericId ? makeOrderNumber(numericId) : null;

  // 2) UPDATE en Strapi para setear orderNumber (si pudimos calcularlo)
  if (orderNumber) {
    const updatePayload = {
      data: {
        orderNumber,
        mpExternalReference,
      },
    };

    const updateUrl = `${strapiBase}/api/orders/${encodeURIComponent(documentId)}`;
    console.log("[orders/create] → Strapi UPDATE url:", updateUrl);
    console.log(
      "[orders/create] → Strapi UPDATE payload:",
      JSON.stringify(updatePayload, null, 2)
    );

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
      const upd = await updateRes.text().catch(() => "");
      console.warn(
        "[orders/create] Strapi UPDATE failed (no bloqueo):",
        updateRes.status,
        upd
      );
      // No bloqueamos: la orden ya existe y el pago puede seguir.
    }
  } else {
    console.warn(
      "[orders/create] Strapi no devolvió numericId; no pude calcular orderNumber."
    );
  }

  // 3) Respuesta útil al front
  return NextResponse.json({
    orderId: documentId, // <-- ESTE es el que vas a usar luego en /api/orders/[id] y en back_urls
    orderDocumentId: documentId,
    orderNumericId: numericId,
    orderNumber,
    mpExternalReference,
    strapi: created,
  });
}
