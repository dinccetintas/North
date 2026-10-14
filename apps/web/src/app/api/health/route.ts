import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ ok: true, app: "north-web", time: new Date().toISOString() });
}
