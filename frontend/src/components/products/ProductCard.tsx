// src/components/products/ProductCard.tsx
import Link from "next/link";
import Image from "next/image";

/**
 * Tipo simple para un producto.
 * Compatible con Strapi v5
 */
export type ProductCardItem = {
  id: number; // id numérico interno (v4/v5)
  slug: string;
  title: string;
  description?: string;
  price: number;
  imageUrl?: string;
  off?: number;
  category?: string;

  // ✅ Strapi v5 (estable)
  documentId?: string | null;

  // ✅ para limitar qty en carrito
  stock?: number | null;
};

/**
 * Card reutilizable de producto:
 * - Imagen real de Strapi (si existe)
 * - Badge de descuento (si off existe)
 * - Precio tachado + precio final (si off existe)
 * - Click lleva a /productos/[id] (documentId si existe)
 */
export function ProductCard({ item }: { item: ProductCardItem }) {
  const hasOff = typeof item.off === "number" && item.off > 0;
  const finalPrice = hasOff ? Math.round(item.price * (1 - item.off! / 100)) : item.price;

  // ✅ en v5 es mejor navegar por documentId si lo tenés
  const href = item.documentId ? `/productos/${encodeURIComponent(item.documentId)}` : `/productos/${item.id}`;

  return (
    <Link
      href={href}
      className="group block rounded-lg border border-neutral-200 bg-white p-4 transition hover:shadow-sm"
    >
      {/* Imagen / Placeholder */}
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md bg-neutral-100">
        {/* Badge descuento */}
        {hasOff && (
          <span className="absolute left-2 top-2 z-10 rounded-full bg-red-600 px-2 py-1 text-xs font-bold text-white">
            {item.off}% OFF
          </span>
        )}

        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt={item.title}
            fill
            sizes="(max-width: 768px) 100vw, 33vw"
            className="object-cover transition group-hover:scale-105"
          />
        ) : (
          <div className="text-xs text-neutral-500">Imagen próximamente</div>
        )}
      </div>

      {/* Texto */}
      <div className="mt-3">
        <h3 className="text-sm font-semibold text-neutral-900 group-hover:underline">
          {item.title}
        </h3>

        {item.description ? (
          <p className="mt-1 line-clamp-2 text-xs text-neutral-600">{item.description}</p>
        ) : (
          <p className="mt-1 text-xs text-neutral-400">—</p>
        )}

        {/* Stock (opcional) */}
        {typeof item.stock === "number" && (
          <div className="mt-2 text-xs text-neutral-600">
            Stock: <span className="font-semibold">{item.stock}</span>
          </div>
        )}

        {/* Precio */}
        {hasOff ? (
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-xs font-semibold text-neutral-400 line-through">
              ${item.price.toLocaleString("es-AR")}
            </span>
            <span className="text-sm font-semibold text-neutral-900">
              ${finalPrice.toLocaleString("es-AR")}
            </span>
          </div>
        ) : (
          <div className="mt-3 text-sm font-semibold text-neutral-900">
            ${item.price.toLocaleString("es-AR")}
          </div>
        )}
      </div>
    </Link>
  );
}
