import { NextResponse, type NextRequest } from "next/server";
import { DESK_COOKIE, openDesk } from "@/lib/desk";
import { persona } from "@/lib/personas";

// A shared link to a desk lands here first: it opens a throwaway demo workspace for the visitor and sends them on.
export async function GET(req: NextRequest) {
  const p = persona(req.nextUrl.searchParams.get("persona") ?? "");
  if (!p) return NextResponse.redirect(new URL("/desk", req.url));
  const r = await openDesk(p, req.cookies.get(DESK_COOKIE)?.value);
  if (!r.ok) return NextResponse.redirect(new URL("/desk?full=1", req.url));
  const res = NextResponse.redirect(new URL(`/desk/${p.id}`, req.url));
  res.cookies.set(DESK_COOKIE, r.id, { httpOnly: true, sameSite: "lax", secure: true, maxAge: 7 * 86400, path: "/" });
  return res;
}
