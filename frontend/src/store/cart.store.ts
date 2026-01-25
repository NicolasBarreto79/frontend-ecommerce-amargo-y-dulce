import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ProductCardItem } from "@/components/products/ProductCard";

export type CartItem = ProductCardItem & {
  qty: number;
};

type CartState = {
  items: CartItem[];

  addItem: (product: ProductCardItem, qty?: number) => void;
  removeItem: (slug: string) => void;
  inc: (slug: string) => void;
  dec: (slug: string) => void;
  clear: () => void;

  totalItems: () => number;
  totalPrice: () => number;
};

function normalizeQty(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.floor(n));
}

function normalizeIdToNumberOrZero(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function normStrOrNull(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

/**
 * ✅ Normaliza el item para:
 * - asegurar qty válido
 * - asegurar id numérico (Strapi id)
 * - asegurar documentId (Strapi v5) si existe
 * - asegurar slug usable (fallback)
 */
function normalizeCartItem(product: any, qty: number): CartItem {
  const idNum = normalizeIdToNumberOrZero(product?.id);
  const documentId =
    normStrOrNull(product?.documentId) ??
    normStrOrNull(product?.attributes?.documentId) ??
    normStrOrNull(product?.attributes?.document_id) ??
    null;

  const slug = normStrOrNull(product?.slug) ?? (idNum ? String(idNum) : documentId ?? "item");

  const price = Number(product?.price) || 0;
  const offRaw = product?.off;
  const off =
    offRaw == null || offRaw === "" ? undefined : Number.isFinite(Number(offRaw)) ? Number(offRaw) : undefined;

  return {
    ...(product as any),
    id: idNum as any, // tu ProductCardItem tipa id como number; mantenemos number
    documentId,
    slug,
    price,
    off,
    qty: normalizeQty(qty),
  } as CartItem;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (product, qty = 1) => {
        const addQty = normalizeQty(qty);

        set((state) => {
          const normalized = normalizeCartItem(product, addQty);

          // ✅ clave de identidad:
          // - si hay documentId (v5), usamos eso
          // - sino, fallback a slug
          const key = normalized.documentId ?? normalized.slug;

          const existing = state.items.find((i: any) => (i.documentId ?? i.slug) === key);

          if (existing) {
            return {
              items: state.items.map((i: any) =>
                (i.documentId ?? i.slug) === key
                  ? { ...i, qty: normalizeQty(i.qty) + addQty }
                  : i
              ),
            };
          }

          return { items: [...state.items, normalized] };
        });
      },

      removeItem: (slug) =>
        set((state) => ({
          items: state.items.filter((i) => i.slug !== slug),
        })),

      inc: (slug) =>
        set((state) => ({
          items: state.items.map((i) =>
            i.slug === slug ? { ...i, qty: normalizeQty(i.qty) + 1 } : i
          ),
        })),

      dec: (slug) =>
        set((state) => ({
          items: state.items
            .map((i) => (i.slug === slug ? { ...i, qty: normalizeQty(i.qty) - 1 } : i))
            .filter((i) => normalizeQty(i.qty) > 0),
        })),

      clear: () => set({ items: [] }),

      totalItems: () => get().items.reduce((acc, i) => acc + normalizeQty(i.qty), 0),

      totalPrice: () =>
        get().items.reduce((acc, i: any) => {
          const qty = normalizeQty(i.qty);
          const price = Number(i.price) || 0;
          const off = Number(i.off) || 0;
          const hasOff = Number.isFinite(off) && off > 0;

          const finalPrice = hasOff ? Math.round(price * (1 - off / 100)) : price;
          return acc + finalPrice * qty;
        }, 0),
    }),
    {
      name: "amargo-dulce-cart",
      version: 3,
      migrate: (persisted: any) => {
        // zustand persist guarda { state, version }
        const state = persisted?.state ?? persisted ?? {};
        const items = Array.isArray(state?.items) ? state.items : [];

        const fixed = items.map((it: any) => {
          // si ya viene con shape de CartItem, lo normalizamos igual
          const normalized = normalizeCartItem(it, normalizeQty(it?.qty ?? 1));
          // preserva fields extra (title, imageUrl, etc.)
          return { ...(it as any), ...normalized };
        });

        return { ...persisted, state: { ...state, items: fixed } };
      },
    }
  )
);
