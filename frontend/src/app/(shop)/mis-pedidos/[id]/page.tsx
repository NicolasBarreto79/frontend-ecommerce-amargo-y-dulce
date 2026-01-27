"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Container } from "@/components/layout/Container";

type Order = {
  documentId?: string | null;
  id?: number | string | null;
  orderNumber?: string | null;
  orderStatus?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  total?: number | string | null;
  items?: any[] | null;
  shippingAddress?: any | null;
  createdAt?: string | null;
};

function formatARS(n: number) {
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}

function normalizeOrderPayload(json: any): Order | null {
  // ✅ Nuevo endpoint devuelve: { data: { ...flat } }
  const data = json?.data ?? null;
  if (!data) return null;

  // ✅ Compat: si viene en formato Strapi v4: { data: { id, attributes } }
  const row =
    data?.attributes
      ? { ...(data.attributes ?? {}), id: data.id, documentId: data.documentId ?? null }
      : data;

  if (!row || typeof row !== "object") return null;

  return {
    documentId: row.documentId ?? null,
    id: row.id ?? null,
    orderNumber: row.orderNumber ?? null,
    orderStatus: row.orderStatus ?? null,
    name: row.name ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    total: row.total ?? null,
    items: Array.isArray(row.items) ? row.items : null,
    shippingAddress: row.shippingAddress ?? null,
    createdAt: row.createdAt ?? null,
  };
}

function normalizeStatus(s?: string | null) {
  const v = String(s || "").toLowerCase();
  if (v === "paid") return "paid";
  if (v === "pending") return "pending";
  if (v === "shipped") return "shipped";
  if (v === "delivered") return "delivered";
  if (v === "failed") return "failed";
  if (v === "cancelled") return "cancelled";
  return "unknown";
}

function StatusPill({ status }: { status: string }) {
  const s = normalizeStatus(status);
  const cls =
    s === "paid"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : s === "pending"
      ? "bg-amber-50 text-amber-700 ring-amber-200"
      : s === "shipped"
      ? "bg-blue-50 text-blue-700 ring-blue-200"
      : s === "delivered"
      ? "bg-violet-50 text-violet-700 ring-violet-200"
      : s === "failed" || s === "cancelled"
      ? "bg-red-50 text-red-700 ring-red-200"
      : "bg-neutral-50 text-neutral-700 ring-neutral-200";

  const label =
    s === "paid"
      ? "Pagado"
      : s === "pending"
      ? "Pendiente"
      : s === "shipped"
      ? "Enviado"
      : s === "delivered"
      ? "Entregado"
      : s === "failed"
      ? "Fallido"
      : s === "cancelled"
      ? "Cancelado"
      : "—";

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${cls}`}>
      {label}
    </span>
  );
}

function Tracking({ status }: { status: string }) {
  const s = normalizeStatus(status);

  const steps = [
    { key: "pending", label: "Pendiente" },
    { key: "paid", label: "Pagado" },
    { key: "shipped", label: "Enviado" },
    { key: "delivered", label: "Entregado" },
  ] as const;

  const activeIndex = useMemo(() => {
    const idx = steps.findIndex((x) => x.key === s);
    return idx >= 0 ? idx : 0;
  }, [s]);

  const isBad = s === "failed" || s === "cancelled";

  return (
    <div className="rounded-2xl border bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-extrabold text-neutral-900">Tracking</div>
          <div className="mt-1 text-sm text-neutral-600">
            {isBad ? "Este pedido no pudo completarse." : "Seguimiento simple del estado del pedido."}
          </div>
        </div>
        <StatusPill status={status} />
      </div>

      <div className="mt-5 grid grid-cols-4 gap-2">
        {steps.map((step, i) => {
          const done = !isBad && i <= activeIndex;
          const ring = done ? "ring-neutral-900" : "ring-neutral-200";
          const bg = done ? "bg-neutral-900 text-white" : "bg-white text-neutral-700";

          return (
            <div key={step.key} className="text-center">
              <div className={`mx-auto grid h-8 w-8 place-items-center rounded-full ring-2 ${ring} ${bg}`}>
                {i + 1}
              </div>
              <div className="mt-2 text-xs font-semibold text-neutral-700">{step.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ================== LINKS a productos ================== */

function getProductHrefFromItem(it: any) {
  // 1) documentId (si existiera en tu item)
  const docId = it?.productDocumentId ?? it?.product_documentId ?? it?.documentId ?? null;
  const doc = String(docId ?? "").trim();
  if (doc && doc !== "null" && doc !== "undefined") return `/productos/${encodeURIComponent(doc)}`;

  // 2) id numérico (muy común)
  const idNum = Number(it?.productId ?? it?.product_id ?? it?.id ?? null);
  if (Number.isFinite(idNum) && idNum > 0) return `/productos/${idNum}`;

  // 3) búsqueda por título
  const title = String(it?.title ?? "").trim();
  if (title) return `/productos?q=${encodeURIComponent(title)}`;

  return "/productos";
}

export default function PedidoDetallePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ? String(params.id) : "";

  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<Order | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<"unauth" | "forbidden" | null>(null);

  useEffect(() => {
    if (!id) return;

    let alive = true;

    async function run() {
      setLoading(true);
      setError(null);
      setAuthError(null);

      try {
        const r = await fetch(`/api/orders/${encodeURIComponent(id)}`, { cache: "no-store" });
        const json = await r.json().catch(() => null);

        if (!r.ok) {
          if (r.status === 401) {
            if (!alive) return;
            setOrder(null);
            setAuthError("unauth");
            return;
          }
          if (r.status === 403) {
            if (!alive) return;
            setOrder(null);
            setAuthError("forbidden");
            return;
          }
          throw new Error(json?.error || `HTTP ${r.status}`);
        }

        const o = normalizeOrderPayload(json);
        if (!o) throw new Error("Pedido no encontrado");

        if (!alive) return;
        setOrder(o);
      } catch (err: any) {
        if (!alive) return;
        setOrder(null);
        setError(err?.message || "No se pudo cargar el pedido.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [id]);

  const totalNum = useMemo(() => {
    if (!order) return 0;
    return typeof order.total === "number" ? order.total : Number(order.total || 0);
  }, [order]);

  const createdLabel = useMemo(() => {
    if (!order?.createdAt) return "";
    const d = new Date(order.createdAt);
    return d.toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" });
  }, [order?.createdAt]);

  return (
    <main>
      <Container>
        <div className="py-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-extrabold text-neutral-900">Detalle de pedido</h1>
              <p className="mt-2 text-sm text-neutral-600">
                {loading ? "Cargando..." : "Información del pedido."}
              </p>
            </div>

            <Link
              href="/mis-pedidos"
              className="rounded-full border px-5 py-2.5 text-sm font-semibold text-neutral-900 hover:bg-neutral-50"
            >
              ← Volver a Mis pedidos
            </Link>
          </div>

          {authError === "unauth" && (
            <div className="mt-6 rounded-2xl border bg-white p-6 text-sm text-neutral-800">
              Tenés que <b>iniciar sesión</b> para ver este pedido.
              <div className="mt-4">
                <Link href="/" className="text-sm font-semibold text-red-700 hover:underline">
                  Ir a la tienda →
                </Link>
              </div>
            </div>
          )}

          {authError === "forbidden" && (
            <div className="mt-6 rounded-2xl border bg-white p-6 text-sm text-neutral-800">
              No tenés permiso para ver este pedido.
              <div className="mt-4">
                <Link href="/mis-pedidos" className="text-sm font-semibold text-red-700 hover:underline">
                  Volver a Mis pedidos →
                </Link>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-6 rounded-2xl border bg-white p-6 text-sm text-red-700">{error}</div>
          )}

          {!error && !loading && order && (
            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              <Tracking status={String(order.orderStatus || "")} />

              <div className="rounded-2xl border bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm text-neutral-600">Pedido</div>
                    <div className="text-xl font-extrabold text-neutral-900">
                      {order.orderNumber || String(order.documentId || order.id || id)}
                    </div>
                    {createdLabel && <div className="mt-1 text-sm text-neutral-600">{createdLabel}</div>}
                  </div>
                  <StatusPill status={String(order.orderStatus || "")} />
                </div>

                <div className="mt-5 space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-neutral-600">Total</span>
                    <span className="font-extrabold text-neutral-900">{formatARS(totalNum)}</span>
                  </div>

                  {order.shippingAddress?.text && (
                    <div>
                      <div className="text-neutral-600">Dirección</div>
                      <div className="mt-1 font-semibold text-neutral-900">
                        {String(order.shippingAddress.text)}
                      </div>
                    </div>
                  )}

                  {(order.name || order.email) && (
                    <div>
                      <div className="text-neutral-600">Cliente</div>
                      <div className="mt-1 font-semibold text-neutral-900">
                        {[order.name, order.email].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border bg-white p-5 lg:col-span-2">
                <h2 className="text-lg font-extrabold text-neutral-900">Items</h2>

                <div className="mt-4 divide-y">
                  {(order.items || []).map((it: any, idx: number) => {
                    const title = String(it?.title ?? "Producto");
                    const qty = Number(it?.qty ?? 1);
                    const unit = Number(it?.unit_price ?? it?.unitPrice ?? it?.price ?? 0);
                    const line = qty * unit;

                    const href = getProductHrefFromItem(it);

                    return (
                      <div key={idx} className="flex items-start justify-between gap-4 py-3">
                        <div className="min-w-0">
                          <Link
                            href={href}
                            className="font-semibold text-neutral-900 truncate hover:underline"
                            title="Ver producto"
                          >
                            {title}
                          </Link>

                          <div className="mt-1 text-sm text-neutral-600">
                            {qty} × {formatARS(unit)}
                            <span className="mx-2 text-neutral-300">•</span>
                            <Link href={href} className="text-sm font-semibold text-red-700 hover:underline">
                              Ver producto →
                            </Link>
                          </div>
                        </div>

                        <div className="shrink-0 text-sm font-extrabold text-neutral-900">
                          {formatARS(line)}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-5 flex items-center justify-between rounded-xl bg-neutral-50 p-4">
                  <span className="text-sm font-semibold text-neutral-700">Total</span>
                  <span className="text-base font-extrabold text-neutral-900">{formatARS(totalNum)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </Container>
    </main>
  );
}
