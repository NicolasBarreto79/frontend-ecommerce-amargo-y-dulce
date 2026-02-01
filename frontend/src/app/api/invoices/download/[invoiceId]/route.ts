import { NextResponse } from "next/server";
import { downloadRemoteFileAsResponse } from "@/lib/download/remoteFile";
import { ensureExt } from "@/lib/download/filenames";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeStrapiBase(url: string) {
  let u = String(url ?? "").trim();
  u = u.endsWith("/") ? u.slice(0, -1) : u;
  if (u.toLowerCase().endsWith("/api")) u = u.slice(0, -4);
  return u;
}

function pickFlat(row: any) {
  if (!row) return null;
  if (row?.attributes) {
    return {
      id: row.id ?? null,
      documentId:
        row.documentId ??
        row?.attributes?.documentId ??
        row?.attributes?.document_id ??
        null,
      ...row.attributes,
    };
  }
  return row;
}

function pickPdfFile(inv: any) {
  const node = inv?.pdf?.data ?? inv?.pdf ?? null;
  const row = Array.isArray(node) ? node[0] : node;
  return pickFlat(row);
}

function ensureAbsoluteUrl(url: string, fallbackOrigin: string) {
  const s = String(url ?? "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/")) return `${fallbackOrigin}${s}`;
  return `${fallbackOrigin}/${s}`;
}

function sanitizeFileBaseName(name: string) {
  // Permitimos letras/números/guion/underscore; convertimos espacios y símbolos a "_"
  const s = String(name ?? "").trim();
  if (!s) return "RC";
  const normalized = s
    .replace(/\s+/g, "_")
    .replace(/[^\w-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "RC";
}

async function getMe(req: Request) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const base = `${proto}://${host}`;

  const r = await fetch(`${base}/api/auth/me`, {
    headers: { cookie: req.headers.get("cookie") ?? "" },
    cache: "no-store",
  });

  const data = await r.json().catch(() => null);
  const user = data?.user;
  if (!r.ok || !user?.id) return null;

  const email =
    typeof user?.email === "string" ? user.email.trim().toLowerCase() : null;

  return { id: Number(user.id), email };
}

async function fetchStrapiJson(url: string, token: string) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const json = await r.json().catch(() => null);
  return { r, json };
}

async function findInvoiceByDocumentId(params: {
  strapiBase: string;
  token: string;
  invoiceId: string;
}) {
  const { strapiBase, token, invoiceId } = params;

  const sp = new URLSearchParams();
  sp.set("pagination[pageSize]", "1");
  sp.set("filters[documentId][$eq]", invoiceId);
  sp.set("populate", "pdf");
  sp.append("populate", "order");
  sp.append("populate", "order.user");

  const url = `${strapiBase}/api/invoices?${sp.toString()}`;
  const { r, json } = await fetchStrapiJson(url, token);

  if (!r.ok) return { ok: false as const, status: r.status, url, json };

  const row = json?.data?.[0];
  return { ok: true as const, data: pickFlat(row), url, raw: json };
}

function extractOrderNumberFromInvoiceNumber(invoiceNumber: any): string | null {
  const s = String(invoiceNumber ?? "").trim();
  // esperado: RC-YYYYMMDD-AMG-0001
  const m = /(AMG-\d{4,})/i.exec(s);
  return m?.[1] ? m[1].toUpperCase() : null;
}

async function findOrderOwnerByOrderNumber(params: {
  strapiBase: string;
  token: string;
  orderNumber: string;
}) {
  const { strapiBase, token, orderNumber } = params;

  const sp = new URLSearchParams();
  sp.set("pagination[pageSize]", "1");
  sp.set("filters[orderNumber][$eq]", orderNumber);
  sp.set("populate", "user");
  sp.set("fields[0]", "orderNumber");
  sp.set("fields[1]", "email");

  const url = `${strapiBase}/api/orders?${sp.toString()}`;
  const { r, json } = await fetchStrapiJson(url, token);

  if (!r.ok) return { ok: false as const, status: r.status, url, json };

  const row = json?.data?.[0];
  const flat = pickFlat(row);
  if (!flat) return { ok: true as const, data: null, url, raw: json };

  const userNode = flat?.user?.data ?? flat?.user ?? null;
  const userFlat = pickFlat(userNode);

  const ownerId = userFlat?.id ?? null;
  const orderEmail =
    typeof flat?.email === "string" ? flat.email.trim().toLowerCase() : null;

  return { ok: true as const, data: { ownerId, orderEmail }, url, raw: json };
}

export async function GET(
  req: Request,
  { params }: { params: { invoiceId: string } }
) {
  const invoiceId = String(params.invoiceId || "").trim();
  if (!invoiceId) {
    return NextResponse.json({ error: "Missing invoiceId" }, { status: 400 });
  }

  const me = await getMe(req);
  if (!me) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const strapiBase = normalizeStrapiBase(
    process.env.STRAPI_URL ||
      process.env.NEXT_PUBLIC_STRAPI_URL ||
      "http://localhost:1337"
  );

  const token = process.env.STRAPI_API_TOKEN || process.env.STRAPI_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "Missing STRAPI_API_TOKEN" },
      { status: 500 }
    );
  }

  // 1) Traer invoice + pdf (+ order/user si existe)
  const invRes = await findInvoiceByDocumentId({ strapiBase, token, invoiceId });

  if (!invRes.ok || !invRes.data) {
    return NextResponse.json(
      {
        error: "No se pudo obtener la invoice",
        status: invRes.status,
        url: invRes.url,
        details: invRes.json,
      },
      { status: invRes.status || 500 }
    );
  }

  const inv = invRes.data;

  // 2) Autorización:
  const orderRelNode = inv?.order?.data ?? inv?.order ?? null;
  const orderRel = pickFlat(orderRelNode);

  const userNode = orderRel?.user?.data ?? orderRel?.user ?? null;
  const userFlat = pickFlat(userNode);
  const ownerIdFromRelation = userFlat?.id ?? null;

  let authorized = false;

  if (ownerIdFromRelation != null) {
    authorized = Number(ownerIdFromRelation) === Number(me.id);
  } else {
    const invNumber = inv?.number ?? inv?.invoiceNumber ?? null;
    const orderNumber = extractOrderNumberFromInvoiceNumber(invNumber);

    if (orderNumber) {
      const owner = await findOrderOwnerByOrderNumber({
        strapiBase,
        token,
        orderNumber,
      });

      if (owner.ok && owner.data) {
        if (
          owner.data.ownerId != null &&
          Number(owner.data.ownerId) === Number(me.id)
        ) {
          authorized = true;
        } else if (me.email && owner.data.orderEmail && me.email === owner.data.orderEmail) {
          authorized = true;
        }
      }
    }
  }

  if (!authorized) {
    return NextResponse.json(
      {
        error: "Prohibido",
        debug: {
          invoiceId,
          invoiceNumber: inv?.number ?? null,
          hasOrderRelation: !!orderRelNode,
          meId: me.id,
        },
      },
      { status: 403 }
    );
  }

  // 3) Resolver URL del PDF
  const pdf = pickPdfFile(inv);
  const rawUrl = typeof pdf?.url === "string" ? pdf.url.trim() : "";
  if (!rawUrl) {
    return NextResponse.json({ error: "Esta invoice no tiene PDF" }, { status: 404 });
  }

  const fileUrl = ensureAbsoluteUrl(rawUrl, strapiBase);

  // ✅ 4) Nombre REAL de la factura: usar inv.number (ej: "RC_20260131_AMG_0155")
  // Si inv.number viene con guiones, lo normalizamos a "_" para que quede exactamente como pedís.
  const invNumberRaw = String(inv?.number ?? inv?.invoiceNumber ?? "").trim();
  const baseName = invNumberRaw
    ? sanitizeFileBaseName(invNumberRaw).replace(/-/g, "_")
    : `RC_${invoiceId}`;

  const filename = ensureExt(baseName, ".pdf");

  // 5) Download reusable handler (stream)
  return downloadRemoteFileAsResponse(fileUrl, {
    filename,
    contentTypeFallback: "application/pdf",
    disposition: "attachment",
    cacheSeconds: 0,
  });
}
