import { NextResponse } from "next/server";
import { fetcher } from "@/lib/fetcher";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido (se esperaba JSON)" }, { status: 400 });
  }

  try {
    const data = await fetcher<any>("/promotions/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Error calculando quote" },
      { status: 500 }
    );
  }
}
