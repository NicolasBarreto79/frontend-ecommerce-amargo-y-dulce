// src/lib/strapi-mappers.ts
import type { ProductCardItem } from "@/components/products/ProductCard";

const STRAPI_URL = (
  process.env.NEXT_PUBLIC_STRAPI_URL ??
  process.env.STRAPI_URL ??
  "http://localhost:1337"
).replace(/\/$/, "");

function withBase(url?: string | null) {
  if (!url) return undefined;
  const u = String(url).trim();
  if (!u) return undefined;
  return /^https?:\/\//i.test(u)
    ? u
    : `${STRAPI_URL}${u.startsWith("/") ? "" : "/"}${u}`;
}

/* ===================== IMAGES ===================== */

/**
 * Soporta:
 * - Strapi v5 "plano": images: [{ url, formats... }]  o images: { ... } o images: { data: [...] }
 * - Strapi v4 "media": images: { data: [{ attributes: { url, formats... } }] }
 * - Array directo: images: [ ... ]
 */
export function getStrapiImageUrlFromAttributes(attributes: any): string | undefined {
  const attr = attributes ?? {};

  // v4: images.data[0].attributes
  const v4ImgAttr = attr?.images?.data?.[0]?.attributes;

  // v5 puede venir:
  // - images: [{...}]
  // - images: { data: [{...}] }
  // - images: { ... } (single media)
  const v5Arr0 = Array.isArray(attr?.images)
    ? attr.images?.[0]
    : Array.isArray(attr?.images?.data)
    ? attr.images.data?.[0]
    : attr?.images;

  // puede venir con .attributes o plano
  const v5ImgAttr = (v5Arr0 as any)?.attributes ?? v5Arr0;

  const img = v4ImgAttr || v5ImgAttr;
  if (!img) return undefined;

  const formats = (img as any)?.formats;
  const url =
    formats?.medium?.url ||
    formats?.small?.url ||
    formats?.thumbnail?.url ||
    (img as any)?.url;

  return withBase(url);
}

/* ===================== PRODUCT MAPPER ===================== */

function toNum(v: any, def = 0) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : def;
}

function toIntOrNull(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toStrOrNull(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

/**
 * Lee stock de manera tolerante:
 * - attr.stock (tu campo en Strapi)
 * - attr.qty / quantity (si lo llamaste distinto)
 * Devuelve number | null (si no existe).
 */
function pickStock(attr: any): number | null {
  const raw =
    attr?.stock ??
    attr?.qty ??
    attr?.quantity ??
    null;

  if (raw === null || raw === undefined || raw === "") return null;

  const n = Number(raw);
  if (!Number.isFinite(n)) return null;

  // stock nunca negativo
  return Math.max(0, Math.trunc(n));
}

/**
 * Mapper para cards de producto
 * Soporta Strapi v4 (data: {id, attributes}) y v5 (data: {id, documentId, ...attributes?})
 *
 * CLAVE: documentId en v5 viene al NIVEL RAÍZ del item, NO dentro de attributes.
 */
export function toCardItem(product: any): ProductCardItem {
  const attr = product?.attributes ?? product ?? {};

  // ✅ Strapi v5: documentId está en product.documentId (root)
  // fallback por si te llega un objeto ya "plano" o custom
  const documentId =
    toStrOrNull(product?.documentId) ??
    toStrOrNull(attr?.documentId) ??
    toStrOrNull(attr?.document_id) ??
    null;

  const id = toIntOrNull(product?.id ?? attr?.id) ?? 0;

  const offRaw = attr?.off;
  const off =
    offRaw == null || offRaw === ""
      ? undefined
      : Number.isFinite(Number(offRaw))
      ? Number(offRaw)
      : undefined;

  const stock = pickStock(attr);

  return {
    id, // ✅ id numérico (puede repetirse por draft/published en v5)
    documentId, // ✅ estable en v5
    slug: toStrOrNull(attr?.slug) ?? String(id), // fallback seguro
    title: toStrOrNull(attr?.title) ?? "Producto",
    description: String(attr?.description ?? ""),
    price: toNum(attr?.price, 0),
    off,

    // ✅ stock: lo agregamos para que el carrito pueda limitar cantidades
    // Si tu ProductCardItem NO tiene stock tipado, esto igual funciona en runtime.
    // Ideal: agregalo al type ProductCardItem como `stock?: number | null`.
    ...(stock !== null ? { stock } : {}),

    // en tu schema Product.category es TEXT (no relación), así que lo dejamos string/null
    category: toStrOrNull(attr?.category),
    imageUrl: getStrapiImageUrlFromAttributes(attr),
  } as ProductCardItem;
}
