// src/app/(shop)/carrito/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Container } from "@/components/layout/Container";
import { Minus, Plus, Trash2, ShoppingCart, BadgePercent } from "lucide-react";
import { useCartStore } from "@/store/cart.store";

function formatARS(n: number) {
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}

function priceWithOff(price: number, off?: number) {
  const hasOff = typeof off === "number" && off > 0;
  return hasOff ? Math.round(price * (1 - off / 100)) : price;
}

type Quote = {
  subtotal: number;
  discountTotal: number;
  total: number;
  appliedPromotions: Array<{
    id: number;
    name: string;
    code?: string | null;
    amount: number;
    meta?: any;
  }>;
};

export default function CarritoPage() {
  const items = useCartStore((s) => s.items);
  const inc = useCartStore((s) => s.inc);
  const dec = useCartStore((s) => s.dec);
  const removeItem = useCartStore((s) => s.removeItem);

  // Subtotal UI (respeta off por item) – sirve para mostrar mientras llega el quote
  const uiSubtotal = items.reduce((acc, it: any) => {
    const unit = priceWithOff(it.price, it.off);
    return acc + unit * it.qty;
  }, 0);

  // ✅ Quote desde backend (reglas PRO) — SIN cupón en carrito
  const [quote, setQuote] = useState<Quote>({
    subtotal: 0,
    discountTotal: 0,
    total: 0,
    appliedPromotions: [],
  });
  const [isQuoting, setIsQuoting] = useState(false);

  // Enviamos SOLO id + qty (el backend trae precios reales y calcula promos)
  const payloadItems = useMemo(() => {
    return (items as any[])
      .map((it) => ({
        id: Number(it.id), // IMPORTANTE: tu store debería tener it.id (Strapi numeric id)
        qty: Math.max(1, Math.floor(Number(it.qty) || 1)),
      }))
      .filter((x) => Number.isFinite(x.id) && x.id > 0);
  }, [items]);

  useEffect(() => {
    let alive = true;

    // si no hay items, limpiamos
    if (!payloadItems.length) {
      setQuote({ subtotal: 0, discountTotal: 0, total: 0, appliedPromotions: [] });
      setIsQuoting(false);
      return;
    }

    const t = setTimeout(async () => {
      try {
        setIsQuoting(true);

        const res = await fetch("/api/promotions/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: payloadItems,
            coupon: "", // ✅ NO cupón en carrito
            shipping: 0,
          }),
        });

        const data = (await res.json()) as Quote;
        if (!alive) return;

        // fallback mínimo por si el backend devuelve algo inesperado
        setQuote({
          subtotal: Number(data?.subtotal) || 0,
          discountTotal: Number(data?.discountTotal) || 0,
          total: Number(data?.total) || 0,
          appliedPromotions: Array.isArray(data?.appliedPromotions) ? data.appliedPromotions : [],
        });
      } catch {
        if (!alive) return;
        // si falla el quote, volvemos a “sin promos”
        const s = Math.round(uiSubtotal);
        setQuote({ subtotal: s, discountTotal: 0, total: s, appliedPromotions: [] });
      } finally {
        if (alive) setIsQuoting(false);
      }
    }, 250);

    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [payloadItems, uiSubtotal]);

  // Totales a mostrar: preferimos quote si vino (y si hay items)
  const effectiveSubtotal = payloadItems.length ? (quote.subtotal || Math.round(uiSubtotal)) : 0;
  const effectiveDiscount = payloadItems.length ? quote.discountTotal : 0;
  const effectiveTotal = payloadItems.length
    ? quote.total || Math.max(0, effectiveSubtotal - effectiveDiscount)
    : 0;

  return (
    <main>
      <Container>
        {/* Header */}
        <div className="py-10">
          <div className="flex items-center gap-3">
            <ShoppingCart className="h-6 w-6 text-neutral-900" />
            <h1 className="text-3xl font-extrabold text-neutral-900">Carrito</h1>
          </div>
          <p className="mt-2 text-sm text-neutral-600">
            Revisá tus bombones antes de finalizar la compra.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 pb-14 lg:grid-cols-[1fr_380px]">
          {/* LISTA */}
          <section className="space-y-4">
            {items.length === 0 ? (
              <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
                <p className="text-sm text-neutral-600">Tu carrito está vacío.</p>
                <Link
                  href="/productos#listado"
                  className="mt-4 inline-flex rounded-full bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700"
                >
                  Ver bombones
                </Link>
              </div>
            ) : (
              items.map((it: any) => {
                const unit = priceWithOff(it.price, it.off);
                const hasOff = typeof it.off === "number" && it.off > 0;

                return (
                  <div
                    key={it.slug}
                    className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"
                  >
                    <div className="flex items-start gap-4">
                      {/* Imagen */}
                      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-neutral-100 ring-1 ring-neutral-200">
                        {it.imageUrl ? (
                          <Image
                            src={it.imageUrl}
                            alt={it.title}
                            fill
                            className="object-cover"
                            sizes="80px"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] text-neutral-500">
                            Sin imagen
                          </div>
                        )}
                      </div>

                      <div className="flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-bold text-neutral-900">{it.title}</div>
                            <div className="mt-1 text-sm text-neutral-600">{it.description}</div>

                            {hasOff ? (
                              <div className="mt-2 inline-flex items-center gap-2 text-xs">
                                <span className="rounded-full bg-red-600 px-2 py-1 font-bold text-white">
                                  {it.off}% OFF
                                </span>
                                <span className="text-neutral-500 line-through">
                                  {formatARS(it.price)}
                                </span>
                                <span className="font-semibold text-neutral-900">
                                  {formatARS(unit)}
                                </span>
                              </div>
                            ) : null}
                          </div>

                          <button
                            onClick={() => removeItem(it.slug)}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-neutral-50"
                            aria-label="Eliminar"
                            title="Eliminar"
                            type="button"
                          >
                            <Trash2 className="h-5 w-5 text-neutral-500" />
                          </button>
                        </div>

                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                          {/* Cantidad */}
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => dec(it.slug)}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-neutral-200 bg-white hover:bg-neutral-50"
                              aria-label="Restar"
                              type="button"
                            >
                              <Minus className="h-4 w-4" />
                            </button>

                            <div className="min-w-[34px] text-center text-sm font-semibold">
                              {it.qty}
                            </div>

                            <button
                              onClick={() => inc(it.slug)}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-neutral-200 bg-white hover:bg-neutral-50"
                              aria-label="Sumar"
                              type="button"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>

                          {/* Precio total del item */}
                          <div className="text-sm font-bold text-neutral-900">
                            {formatARS(unit * it.qty)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}

            {/* Botón seguir comprando */}
            {items.length > 0 && (
              <div className="pt-2">
                <Link
                  href="/productos#listado"
                  className="inline-flex rounded-full border border-neutral-300 bg-white px-5 py-2 text-sm font-semibold text-neutral-900 hover:bg-neutral-50"
                >
                  Seguir comprando
                </Link>
              </div>
            )}
          </section>

          {/* RESUMEN */}
          <aside className="h-fit rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-extrabold text-neutral-900">Resumen</h2>

            {/* Totales */}
            <div className="mt-5 space-y-2 text-sm">
              <div className="flex justify-between text-neutral-700">
                <span>Subtotal</span>
                <span className="font-semibold text-neutral-900">
                  {formatARS(effectiveSubtotal)}
                </span>
              </div>


              <div className="my-3 h-px bg-neutral-200" />

              <div className="flex justify-between text-base">
                <span className="font-extrabold text-neutral-900">Total</span>
                <span className="font-extrabold text-neutral-900">
                  {formatARS(effectiveTotal)}
                </span>
              </div>
            </div>

            {/* CTA Checkout */}
            <Link
              href="/checkout"
              aria-disabled={items.length === 0}
              className={[
                "mt-6 block w-full rounded-full bg-red-600 py-3 text-center text-sm font-semibold text-white hover:bg-red-700",
                items.length === 0 ? "pointer-events-none opacity-50" : "",
              ].join(" ")}
            >
              Finalizar compra
            </Link>

            <p className="mt-3 text-center text-xs text-neutral-500">
              El total final se calcula con reglas de promociones en el backend.
            </p>
          </aside>
        </div>
      </Container>
    </main>
  );
}
