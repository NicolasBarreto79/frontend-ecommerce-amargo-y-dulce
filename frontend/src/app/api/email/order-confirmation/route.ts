import { NextResponse } from "next/server";
import { Resend } from "resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const resend = new Resend(process.env.RESEND_API_KEY);

// Dedupe best-effort en memoria (sirve si llegan 2 hits al mismo runtime)
const recentSends = new Map<string, number>();
const DEDUPE_WINDOW_MS = 10_000;

// Límite razonable para adjuntos (Resend suele aceptar, pero el límite real depende del plan/infra)
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB

function formatARS(n: number) {
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}

function escapeHtml(s: string) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function looksRateLimitError(e: any) {
  const msg = String(e?.message || e?.error?.message || "").toLowerCase();
  return (
    msg.includes("too many requests") ||
    msg.includes("rate limit") ||
    e?.statusCode === 429 ||
    e?.status === 429
  );
}

async function fetchWithTimeout(input: string, init: RequestInit, ms = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal, cache: "no-store" });
  } finally {
    clearTimeout(t);
  }
}

async function fetchPdfAsBase64(url: string) {
  const r = await fetchWithTimeout(
    url,
    {
      headers: {
        // Resend/Cloudinary normalmente no lo requiere, pero ayuda a “servir” como pdf
        Accept: "application/pdf,*/*",
      },
    },
    25000
  );

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`PDF fetch failed (${r.status}) ${t?.slice?.(0, 200) || ""}`);
  }

  const ab = await r.arrayBuffer();
  const buf = Buffer.from(ab);

  if (buf.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(`PDF too large (${buf.byteLength} bytes)`);
  }

  return buf.toString("base64");
}

function safeFilename(name: any) {
  const s = String(name ?? "factura.pdf").trim() || "factura.pdf";
  const clean = s.replace(/[\r\n"]/g, "");
  return clean.toLowerCase().endsWith(".pdf") ? clean : `${clean}.pdf`;
}

export async function POST(req: Request) {
  try {
    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: "Falta RESEND_API_KEY" }, { status: 500 });
    }

    const from = process.env.EMAIL_FROM;
    if (!from) {
      return NextResponse.json({ error: "Falta EMAIL_FROM" }, { status: 500 });
    }

    const body = await req.json().catch(() => null);
    const {
      email,
      name,
      orderNumber,
      total,
      items,
      phone,
      shippingAddress,
      // opcional: si lo mandás desde el webhook, mejor aún:
      mpPaymentId,

      // ✅ NUEVO: viene del webhook (si lo implementaste como te pasé)
      invoiceNumber,
      invoicePdfUrl,
      invoiceFilename,
    } = body || {};

    if (!email || !orderNumber) {
      return NextResponse.json({ error: "Faltan email u orderNumber" }, { status: 400 });
    }

    // ✅ idempotency key: un mail por pedido (o por pedido+payment)
    const idempotencyKey = `order-confirmation/${String(orderNumber)}${
      mpPaymentId ? `/${String(mpPaymentId)}` : ""
    }`;

    // ✅ dedupe best-effort local
    const now = Date.now();
    const last = recentSends.get(idempotencyKey);
    if (last && now - last < DEDUPE_WINDOW_MS) {
      return NextResponse.json({ ok: true, deduped: true, to: process.env.TEST_EMAIL_TO || email });
    }
    recentSends.set(idempotencyKey, now);

    const addressText =
      shippingAddress?.text ||
      shippingAddress?.address ||
      (shippingAddress ? JSON.stringify(shippingAddress) : "");

    const itemsHtml = Array.isArray(items)
      ? items
          .map((it: any) => {
            const qty = Number(it?.qty ?? 1);
            const title = escapeHtml(it?.title ?? "Item");
            const unit = Number(it?.unit_price ?? it?.price ?? 0);
            return `<li>${qty} x ${title} — ${escapeHtml(formatARS(unit))}</li>`;
          })
          .join("")
      : "";

    // ✅ armamos HTML y, si no se puede adjuntar, al menos incluimos el link
    const invoiceLine =
      invoiceNumber || invoicePdfUrl
        ? `
          <h3>Factura</h3>
          <p>
            ${invoiceNumber ? `N° <b>${escapeHtml(String(invoiceNumber))}</b><br/>` : ""}
            ${invoicePdfUrl ? `Descarga: <a href="${escapeHtml(String(invoicePdfUrl))}">PDF</a>` : ""}
          </p>
        `
        : "";

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.5">
        <h2>¡Gracias por tu compra${name ? `, ${escapeHtml(name)}` : ""}!</h2>
        <p>Confirmamos tu pedido <b>${escapeHtml(String(orderNumber))}</b>.</p>

        ${invoiceLine}

        <h3>Dirección de envío</h3>
        <p>${escapeHtml(addressText || "-")}</p>

        <h3>Teléfono</h3>
        <p>${escapeHtml(phone || "-")}</p>

        <h3>Items</h3>
        <ul>${itemsHtml || "<li>-</li>"}</ul>

        <h3>Total</h3>
        <p><b>${escapeHtml(formatARS(Number(total ?? 0)))}</b></p>

        <p style="margin-top:24px;color:#666">
          Si tenés dudas, respondé este email.
        </p>
      </div>
    `;

    // ✅ Modo testing (sin dominio): fuerza destinatario a tu email verificado
    const to = process.env.TEST_EMAIL_TO || String(email);

    console.log("[email] sending confirmation", {
      orderNumber,
      to,
      forced: Boolean(process.env.TEST_EMAIL_TO),
      idempotencyKey,
      hasInvoicePdfUrl: Boolean(invoicePdfUrl),
    });

    // ✅ Intento de adjuntar PDF (si viene invoicePdfUrl)
    let attachments: Array<{ filename: string; content: string }> | undefined;

    if (invoicePdfUrl && typeof invoicePdfUrl === "string") {
      try {
        const base64 = await fetchPdfAsBase64(invoicePdfUrl);
        attachments = [
          {
            filename: safeFilename(invoiceFilename || invoiceNumber || "factura.pdf"),
            content: base64, // Resend espera base64
          },
        ];
      } catch (e: any) {
        // No cortamos el email si falla el adjunto; dejamos link en el body
        console.error("[email] failed to attach pdf, sending without attachment:", e?.message || e);
      }
    }

    // ✅ Resend idempotency (Node SDK)
    const result = await resend.emails.send(
      {
        from,
        to,
        subject: `Confirmación de pedido ${String(orderNumber)}`,
        html,
        ...(attachments ? { attachments } : {}),
      },
      { idempotencyKey }
    );

    // SDK puede devolver { error } en vez de throw
    if ((result as any)?.error) {
      const err = (result as any).error;
      const msg = err?.message || "Resend error";

      // Si es rate limit, devolvemos 202 (no “romper” el flujo del webhook)
      if (looksRateLimitError(err) || String(msg).toLowerCase().includes("too many requests")) {
        return NextResponse.json(
          { ok: false, queued: false, error: msg, rateLimited: true, to },
          { status: 202 }
        );
      }

      return NextResponse.json({ error: msg }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      to,
      idempotencyKey,
      attachedPdf: Boolean(attachments?.length),
    });
  } catch (e: any) {
    // Si Resend throwea por rate limit u otro error
    if (looksRateLimitError(e)) {
      return NextResponse.json(
        {
          ok: false,
          error: e?.message || "Too many requests",
          rateLimited: true,
        },
        { status: 202 }
      );
    }

    return NextResponse.json(
      { error: e?.message || "Error enviando email" },
      { status: 500 }
    );
  }
}
