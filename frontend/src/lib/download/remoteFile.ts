import { NextResponse } from "next/server";

type DownloadOptions = {
  filename: string;
  contentTypeFallback?: string;
  cacheSeconds?: number; // default 0 (no-store)
  disposition?: "attachment" | "inline"; // default attachment
  extraHeaders?: Record<string, string>;
};

function sanitizeFilename(name: string) {
  return String(name ?? "archivo").replace(/[\r\n"]/g, "").trim() || "archivo";
}

function pickContentType(res: Response, fallback?: string) {
  const ct = res.headers.get("content-type");
  return ct && ct.trim().length ? ct : fallback ?? "application/octet-stream";
}

export async function downloadRemoteFileAsResponse(
  fileUrl: string,
  opts: DownloadOptions
) {
  const {
    filename,
    contentTypeFallback,
    cacheSeconds = 0,
    disposition = "attachment",
    extraHeaders = {},
  } = opts;

  const url = String(fileUrl ?? "").trim();
  if (!url) {
    return NextResponse.json({ ok: false, error: "Missing fileUrl" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, { cache: "no-store" });
  } catch {
    return NextResponse.json(
      { ok: false, error: "No se pudo conectar al servidor de archivos." },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { ok: false, error: `No se pudo descargar el archivo (status ${upstream.status}).` },
      { status: 502 }
    );
  }

  const safe = sanitizeFilename(filename);
  const contentType = pickContentType(upstream, contentTypeFallback);

  const headers = new Headers({
    "Content-Type": contentType,
    ...extraHeaders,
  });

  headers.set("Content-Disposition", `${disposition}; filename="${safe}"`);

  if (cacheSeconds > 0) {
    headers.set("Cache-Control", `public, max-age=${cacheSeconds}`);
  } else {
    headers.set("Cache-Control", "no-store");
  }

  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);

  return new NextResponse(upstream.body, { status: 200, headers });
}
