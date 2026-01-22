import type { ProductCardItem } from "@/components/products/ProductCard";

const STRAPI_URL = (
  process.env.NEXT_PUBLIC_STRAPI_URL ??
  process.env.STRAPI_URL ??
  "http://localhost:1337"
).replace(/\/$/, "");

function withBase(url?: string) {
  if (!url) return undefined;
  return url.startsWith("http") ? url : `${STRAPI_URL}${url}`;
}

/* ===================== IMAGES ===================== */

/**
 * Soporta:
 * - Strapi v5 "plano": images: [{ url, formats... }]
 * - Strapi v4 "media": images: { data: [{ attributes: { url, formats... } }] }
 * - Tu caso previo: images: [ ... ] (array directo)
 */
export function getStrapiImageUrlFromAttributes(attributes: any): string | undefined {
  const attr = attributes ?? {};

  // v4: images.data[0].attributes
  const v4ImgAttr = attr?.images?.data?.[0]?.attributes;

  // v5 / array directo: images[0] (puede venir con .attributes o plano)
  const img0 = Array.isArray(attr?.images) ? attr.images[0] : attr?.images?.[0];
  const v5ImgAttr = img0?.attributes ?? img0;

  const img = v4ImgAttr || v5ImgAttr;
  if (!img) return undefined;

  const formats = img?.formats;
  const url =
    formats?.medium?.url ||
    formats?.small?.url ||
    formats?.thumbnail?.url ||
    img?.url;

  return withBase(url);
}

/* ===================== PRODUCT MAPPER ===================== */

/**
 * Mapper para cards de producto
 * Soporta Strapi v4 (data: {id, attributes}) y v5 (data: {id, ...campos})
 */
export function toCardItem(product: any): ProductCardItem {
  // v4: product.attributes
  // v5: product ya viene plano
  const attr = product?.attributes ?? product ?? {};

  const documentIdRaw =
    product?.documentId ??
    product?.attributes?.documentId ??
    product?.attributes?.document_id ??
    attr?.documentId ??
    attr?.document_id ??
    null;

  const offRaw = attr?.off;
  const off =
    typeof offRaw === "number"
      ? offRaw
      : offRaw != null && offRaw !== ""
      ? Number(offRaw)
      : undefined;

  return {
    id: Number(product?.id ?? attr?.id), // ✅ id numérico de Strapi
    documentId: documentIdRaw ? String(documentIdRaw) : null, // ✅ documentId v5
    slug: attr?.slug ?? null,
    title: attr?.title ?? "Producto",
    description: attr?.description ?? "",
    price: typeof attr?.price === "number" ? attr.price : Number(attr?.price ?? 0),
    off,
    category: attr?.category ?? null,
    imageUrl: getStrapiImageUrlFromAttributes(attr),
  };
}
