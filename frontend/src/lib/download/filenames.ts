export function ensureExt(name: string, ext: string) {
  const base = String(name ?? "documento").trim() || "documento";
  const e = ext.startsWith(".") ? ext : `.${ext}`;
  return base.toLowerCase().endsWith(e) ? base : `${base}${e}`;
}
