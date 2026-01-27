// src/lib/stock.ts
import { fetcher } from "@/lib/fetcher";

type CartItem = {
  qty: number;
  title?: string;
  productDocumentId?: string | null;
};

type ProductRow = {
  id?: number;
  documentId?: string | null;
  title?: string | null;
  stock?: number | null;
  attributes?: any; // por si llega v4 shape
};

export type StockProblem = {
  documentId: string;
  title: string;
  requested: number;
  available: number; // 0 si no hay / no existe
};

function pickAttr(row: any) {
  return row?.attributes ?? row ?? {};
}

function pickDocumentId(row: any): string | null {
  const attr = pickAttr(row);
  const v =
    row?.documentId ??
    row?.attributes?.documentId ??
    row?.attributes?.document_id ??
    attr?.documentId ??
    attr?.document_id ??
    null;

  const s = v != null ? String(v).trim() : "";
  return s ? s : null;
}

function pickTitle(row: any): string {
  const attr = pickAttr(row);
  const t = attr?.title ?? row?.title ?? "Producto";
  return String(t || "Producto");
}

function pickStock(row: any): number | null {
  const attr = pickAttr(row);
  const raw = attr?.stock ?? row?.stock ?? null;
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Valida stock por documentId (Strapi v5).
 * - stock null/undefined => sin control (ilimitado)
 * - si no existe producto => available 0
 */
export async function validateStockOrThrow(items: CartItem[]) {
  const need = new Map<string, { requested: number; title?: string }>();

  for (const it of Array.isArray(items) ? items : []) {
    const doc = String(it?.productDocumentId ?? "").trim();
    const qty = Number(it?.qty ?? 0);
    if (!doc || !Number.isFinite(qty) || qty <= 0) continue;

    const prev = need.get(doc);
    need.set(doc, {
      requested: (prev?.requested ?? 0) + Math.floor(qty),
      title: it?.title ?? prev?.title,
    });
  }

  const docIds = Array.from(need.keys());
  if (!docIds.length) return;

  // ⚠️ En Strapi, $in no se manda como "a,b,c" en un solo string de forma confiable.
  // Armamos filters[$or][i][documentId][$eq]=... (funciona bien en v4/v5).
  const sp = new URLSearchParams();
  sp.set("pagination[pageSize]", String(Math.min(docIds.length, 100)));
  sp.set("fields[0]", "title");
  sp.set("fields[1]", "stock");
  sp.set("fields[2]", "documentId");

  docIds.forEach((doc, i) => {
    sp.set(`filters[$or][${i}][documentId][$eq]`, doc);
  });

  const res = await fetcher<{ data: ProductRow[] }>(`/api/products?${sp.toString()}`, {
    auth: true,
  });

  const rows = Array.isArray(res?.data) ? res.data : [];

  const byDoc = new Map<string, any>();
  for (const r of rows) {
    const doc = pickDocumentId(r);
    if (doc) byDoc.set(doc, r);
  }

  const problems: StockProblem[] = [];

  for (const doc of docIds) {
    const requested = need.get(doc)!.requested;
    const row = byDoc.get(doc);

    if (!row) {
      problems.push({
        documentId: doc,
        title: need.get(doc)?.title ?? "Producto",
        requested,
        available: 0,
      });
      continue;
    }

    const stock = pickStock(row);
    // stock null => sin control
    if (stock === null) continue;

    if (stock < requested) {
      problems.push({
        documentId: doc,
        title: pickTitle(row) || need.get(doc)?.title || "Producto",
        requested,
        available: stock,
      });
    }
  }

  if (problems.length) {
    const err: any = new Error("OUT_OF_STOCK");
    err.code = "OUT_OF_STOCK";
    err.problems = problems;
    throw err;
  }
}
