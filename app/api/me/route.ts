import { NextRequest, NextResponse } from "next/server";
import { getRequestPrincipal } from "@/lib/auth/permissions";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const principal = await getRequestPrincipal(req);
    return NextResponse.json(principal);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Authentication failed" },
      { status: 401 }
    );
  }
}
