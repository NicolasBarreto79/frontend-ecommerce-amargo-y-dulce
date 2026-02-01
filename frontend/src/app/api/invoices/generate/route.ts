import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import path from "path";
import fs from "fs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function normalizeStrapiBase(url: string) {
  let u = String(url ?? "").trim();
  u = u.endsWith("/") ? u.slice(0, -1) : u;
  if (u.toLowerCase().endsWith("/api")) u = u.slice(0, -4);
  return u;
}

function normalizeBearer(token: string) {
  return String(token ?? "").trim().replace(/^bearer\s+/i, "");
}

async function fetchStrapiText(url: string, token: string, init?: RequestInit) {
  const r = await fetch(url, {
    ...(init || {}),
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${normalizeBearer(token)}`,
    },
    cache: "no-store",
  });

  const text = await r.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text || null };
  }

  return { r, json, text };
}

function moneyARS(n: any) {
  const num = Number(n);
  const safe = Number.isFinite(num) ? num : 0;
  return safe.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
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

// ✅ RC_YYYYMMDD_AMG-0172
function buildInvoiceNumber(orderNumber?: string | null) {
  const ts = new Date();
  const y = ts.getFullYear();
  const mm = String(ts.getMonth() + 1).padStart(2, "0");
  const dd = String(ts.getDate()).padStart(2, "0");
  const base = (orderNumber || "AMG-XXXX").replace(/\s+/g, "");
  return `RC_${y}${mm}${dd}_${base}`;
}

/**
 * FIND invoice by number (robusto)
 */
async function findInvoiceByNumber(
  strapiBase: string,
  token: string,
  number: string
) {
  // Intento A: populate[0]=pdf
  {
    const sp = new URLSearchParams();
    sp.set("pagination[pageSize]", "1");
    sp.set("filters[number][$eq]", number);
    sp.set("populate[0]", "pdf");
    const url = `${strapiBase}/api/invoices?${sp.toString()}`;

    const r = await fetchStrapiText(url, token);
    if (r.r.ok) {
      const row = r.json?.data?.[0];
      return row ? pickFlat(row) : null;
    }
    if (r.r.status !== 400) {
      const err: any = new Error("STRAPI_FIND_INVOICE_FAILED");
      err.status = r.r.status;
      err.details = r.json;
      throw err;
    }
  }

  // Intento B: populate=pdf
  {
    const sp = new URLSearchParams();
    sp.set("pagination[pageSize]", "1");
    sp.set("filters[number][$eq]", number);
    sp.append("populate", "pdf");
    const url = `${strapiBase}/api/invoices?${sp.toString()}`;

    const r = await fetchStrapiText(url, token);
    if (r.r.ok) {
      const row = r.json?.data?.[0];
      return row ? pickFlat(row) : null;
    }
    if (r.r.status !== 400) {
      const err: any = new Error("STRAPI_FIND_INVOICE_FAILED");
      err.status = r.r.status;
      err.details = r.json;
      throw err;
    }
  }

  // Intento C: sin populate
  {
    const sp = new URLSearchParams();
    sp.set("pagination[pageSize]", "1");
    sp.set("filters[number][$eq]", number);
    const url = `${strapiBase}/api/invoices?${sp.toString()}`;

    const r = await fetchStrapiText(url, token);
    if (!r.r.ok) {
      const err: any = new Error("STRAPI_FIND_INVOICE_FAILED");
      err.status = r.r.status;
      err.details = r.json;
      throw err;
    }
    const row = r.json?.data?.[0];
    return row ? pickFlat(row) : null;
  }
}

/**
 * ✅ Trae una orden por documentId usando el endpoint de LISTA (find)
 */
async function fetchOrderByDocumentId(
  strapiBase: string,
  token: string,
  orderDocumentId: string
) {
  const sp = new URLSearchParams();
  sp.set("pagination[pageSize]", "1");
  sp.set("filters[documentId][$eq]", orderDocumentId);
  sp.set("populate", "*");

  const url = `${strapiBase}/api/orders?${sp.toString()}`;
  const r = await fetchStrapiText(url, token);

  if (!r.r.ok) {
    const err: any = new Error("STRAPI_ORDER_FETCH_FAILED");
    err.status = r.r.status;
    err.url = url;
    err.details = r.json;
    throw err;
  }

  const row = r.json?.data?.[0];
  const flat = pickFlat(row);
  if (!flat) return null;

  const doc = String(flat?.documentId ?? "").trim();
  if (!doc) {
    const err: any = new Error("STRAPI_ORDER_MISSING_DOCUMENTID");
    err.status = 500;
    err.url = url;
    err.details = r.json;
    throw err;
  }

  return flat;
}

/**
 * Fuente robusta para PDFKit en Next
 */
function applyPdfFont(doc: any) {
  const fontPath = path.join(
    process.cwd(),
    "src",
    "assets",
    "fonts",
    "DejaVuSans.ttf"
  );

  try {
    const buf = fs.readFileSync(fontPath);
    const size = buf.length;
    const headHex = buf.slice(0, 4).toString("hex");
    const headAscii = buf.slice(0, 4).toString("ascii");

    const isTtf = headHex === "00010000";
    const isOtf = headAscii === "OTTO";

    if (!size || size < 1000 || (!isTtf && !isOtf)) {
      console.warn("[invoice/pdf] Font inválida, uso Helvetica:", {
        fontPath,
        size,
        headHex,
        headAscii,
      });
      doc.font("Helvetica");
      return;
    }

    doc.registerFont("DejaVu", fontPath);
    doc.font("DejaVu");
  } catch (e: any) {
    console.warn(
      "[invoice/pdf] No pude aplicar fuente (uso Helvetica):",
      e?.message || e
    );
    doc.font("Helvetica");
  }
}

async function renderPdfBuffer(order: any) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const chunks: Buffer[] = [];

  doc.on("data", (c: any) =>
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
  );
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  applyPdfFont(doc);

  const orderNumber = String(order?.orderNumber ?? "").trim() || "AMG-XXXX";
  const createdAt = order?.createdAt ? new Date(order.createdAt) : new Date();
  const issuedAt = new Date();

  // ✅ FIX: Formato 24hs + timezone Argentina
  const dateFmt: Intl.DateTimeFormatOptions = {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  };

  const shippingMethod = order?.shippingMethod ?? "delivery";
  const shippingCost = Number(order?.shippingCost ?? 0);
  const pickupPoint = order?.pickupPoint ?? null;

  const subtotal = Number(order?.subtotal ?? 0);
  const discountTotal = Number(order?.discountTotal ?? 0);
  const total = Number(order?.total ?? 0);

  const items = Array.isArray(order?.items) ? order.items : [];

  doc.fontSize(18).text("Amargo y Dulce", { align: "left" });
  doc.moveDown(0.2);
  doc
    .fontSize(12)
    .fillColor("#444")
    .text("Comprobante / Recibo", { align: "left" });
  doc.moveDown(1);

  doc.fillColor("#000");
  doc.fontSize(11).text(`Pedido: ${orderNumber}`);
  doc.text(`Fecha pedido: ${createdAt.toLocaleString("es-AR", dateFmt)}`);
  doc.text(`Fecha emisión: ${issuedAt.toLocaleString("es-AR", dateFmt)}`);
  doc.moveDown(0.6);

  doc.text(`Cliente: ${order?.name ?? "-"}`);
  doc.text(`Email: ${order?.email ?? "-"}`);
  doc.text(`Tel: ${order?.phone ?? "-"}`);
  doc.moveDown(0.6);

  doc.fontSize(11).text(
    `Entrega: ${
      shippingMethod === "pickup"
        ? `Retiro en sucursal${
            pickupPoint ? ` (${pickupPoint})` : ""
          } — GRATIS`
        : `Envío a domicilio — ${moneyARS(shippingCost)}`
    }`
  );

  doc.moveDown(0.8);
  doc.fontSize(12).text("Detalle", { underline: true });
  doc.moveDown(0.4);

  doc.fontSize(10);
  items.forEach((it: any) => {
    const title = String(it?.title ?? "Producto");
    const qty = Number(it?.qty ?? it?.quantity ?? 1);
    const unit = Number(it?.unit_price ?? it?.unitPrice ?? it?.price ?? 0);
    const line = qty * unit;

    doc.text(`${title}`);
    doc
      .fillColor("#444")
      .text(`  ${qty} x ${moneyARS(unit)} = ${moneyARS(line)}`);
    doc.fillColor("#000");
    doc.moveDown(0.2);
  });

  doc.moveDown(0.8);

  doc.fontSize(11).text(`Subtotal: ${moneyARS(subtotal)}`, { align: "right" });
  doc.text(`Descuento: -${moneyARS(discountTotal)}`, { align: "right" });
  doc.text(
    `Envío: ${
      shippingMethod === "pickup" ? moneyARS(0) : moneyARS(shippingCost)
    }`,
    { align: "right" }
  );
  doc.fontSize(13).text(`TOTAL: ${moneyARS(total)}`, { align: "right" });

  doc.moveDown(1.2);
  doc
    .fontSize(9)
    .fillColor("#666")
    .text(
      "Este comprobante no constituye factura fiscal. Conservá este documento como constancia de tu compra.",
      { align: "left" }
    );

  doc.end();
  return done;
}

function pickPdfUrlFromInvoice(inv: any): string | null {
  const node = inv?.pdf?.data ?? inv?.pdf ?? null;
  const row = Array.isArray(node) ? node[0] : node;
  const flat = pickFlat(row);
  const url = flat?.url ?? flat?.attributes?.url ?? null;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

/**
 * ✅ Crear invoice SIN order/orderNumber (Strapi los rechaza en tu caso)
 * Intentamos varias formas de setear el media `pdf`.
 */
async function createInvoiceMinimal(params: {
  strapiBase: string;
  token: string;
  baseInvoiceData: any;
  fileId: number;
}) {
  const { strapiBase, token, baseInvoiceData, fileId } = params;

  const createUrl = `${strapiBase}/api/invoices`;

  const candidates: any[] = [
    { data: { ...baseInvoiceData, pdf: fileId } },
    { data: { ...baseInvoiceData, pdf: { connect: [fileId] } } },
    { data: { ...baseInvoiceData, pdf: { data: fileId } } },
  ];

  let lastErr: any = null;

  for (const payload of candidates) {
    const res = await fetch(createUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const text = await res.text().catch(() => "");
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { _raw: text || null };
    }

    if (res.ok)
      return {
        ok: true as const,
        data: json?.data ?? json,
        payloadUsed: payload,
      };

    lastErr = { status: res.status, details: json, payloadTried: payload };
  }

  return { ok: false as const, ...lastErr };
}

export async function POST(req: Request) {
  const strapiBase = normalizeStrapiBase(
    process.env.STRAPI_URL ||
      process.env.NEXT_PUBLIC_STRAPI_URL ||
      "http://localhost:1337"
  );

  const tokenRaw = process.env.STRAPI_TOKEN || process.env.STRAPI_API_TOKEN;
  const token = tokenRaw ? normalizeBearer(tokenRaw) : "";
  if (!token) {
    return NextResponse.json(
      { error: "Falta STRAPI_TOKEN / STRAPI_API_TOKEN (server)" },
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

  const orderId = String(body?.orderId ?? "").trim();
  if (!orderId) {
    return NextResponse.json(
      { error: "Falta orderId (documentId)" },
      { status: 400 }
    );
  }

  // 1) Traer orden
  let order: any = null;
  try {
    order = await fetchOrderByDocumentId(strapiBase, token, orderId);
  } catch (e: any) {
    return NextResponse.json(
      {
        error: "No se pudo obtener la orden",
        status: e?.status || 500,
        url: e?.url,
        details: e?.details || e?.message,
      },
      { status: e?.status || 500 }
    );
  }

  if (!order) {
    return NextResponse.json(
      { error: "Orden no encontrada", orderId },
      { status: 404 }
    );
  }

  // Solo generar si está paid
  const status = String(order?.orderStatus ?? "").toLowerCase();
  if (status !== "paid") {
    return NextResponse.json(
      {
        error: "La orden todavía no está pagada",
        orderStatus: order?.orderStatus,
      },
      { status: 409 }
    );
  }

  // 2) invoiceNumber + check existe
  const orderNumber = String(order?.orderNumber ?? "AMG-XXXX");
  const invoiceNumber = buildInvoiceNumber(orderNumber);

  try {
    const existing = await findInvoiceByNumber(strapiBase, token, invoiceNumber);
    if (existing) {
      const pdfUrl = pickPdfUrlFromInvoice(existing);
      return NextResponse.json(
        {
          ok: true,
          alreadyExists: true,
          invoiceNumber,
          pdfUrl,
          invoice: existing,
        },
        { status: 200 }
      );
    }
  } catch (e: any) {
    return NextResponse.json(
      {
        error: "Strapi error (find invoice by number)",
        status: e?.status || 500,
        details: e?.details || e?.message,
      },
      { status: 400 }
    );
  }

  // 3) Generar PDF
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderPdfBuffer(order);
  } catch (e: any) {
    return NextResponse.json(
      { error: "No se pudo generar el PDF", details: e?.message || e },
      { status: 500 }
    );
  }

  const filename = `${invoiceNumber}.pdf`;

  // 4) Upload a Strapi
  const uploadUrl = `${strapiBase}/api/upload`;
  const form = new FormData();
  form.append(
    "files",
    new Blob([pdfBuffer], { type: "application/pdf" }),
    filename
  );

  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    cache: "no-store",
  });

  const uploadText = await uploadRes.text().catch(() => "");
  let uploaded: any = null;
  try {
    uploaded = uploadText ? JSON.parse(uploadText) : null;
  } catch {
    uploaded = { _raw: uploadText || null };
  }

  if (!uploadRes.ok || !Array.isArray(uploaded) || !uploaded[0]?.id) {
    return NextResponse.json(
      {
        error: "No se pudo subir el PDF a Strapi",
        status: uploadRes.status,
        details: uploaded,
      },
      { status: 500 }
    );
  }

  const fileId = uploaded[0].id;
  const uploadedPdfUrl = uploaded?.[0]?.url
    ? String(uploaded[0].url).trim()
    : null;

  // 5) Crear Invoice SOLO con campos válidos
  const baseInvoiceData: any = {
    number: invoiceNumber,
    issuedAt: new Date().toISOString(),
    total: Number(order?.total ?? 0),
    currency: "ARS",
  };

  const createdRes = await createInvoiceMinimal({
    strapiBase,
    token,
    baseInvoiceData,
    fileId,
  });

  if (!createdRes.ok) {
    return NextResponse.json(
      {
        error: "No se pudo crear Invoice",
        status: createdRes.status,
        details: createdRes.details,
        payloadTried: createdRes.payloadTried,
        note: "Tu Strapi rechaza order/orderNumber. Creamos invoice solo con pdf + number + totals.",
      },
      { status: 500 }
    );
  }

  // 6) Re-fetch para devolver invoice con pdf (y que el webhook la use)
  let fetched: any = null;
  try {
    fetched = await findInvoiceByNumber(strapiBase, token, invoiceNumber);
  } catch {
    fetched = null;
  }

  const pdfUrl = (fetched ? pickPdfUrlFromInvoice(fetched) : null) || uploadedPdfUrl || null;

  return NextResponse.json(
    {
      ok: true,
      invoiceNumber,
      pdfUrl,
      invoice: createdRes.data,
      fetched,
    },
    { status: 200 }
  );
}
