import { NextResponse, type NextRequest } from "next/server";

// A backslash in the path ("/desk\") makes Next look for a page file that can't exist and answer 500. Send a 404 instead.
export function proxy(req: NextRequest) {
  if (/%5c|\\/i.test(req.nextUrl.pathname)) return new NextResponse("Not found", { status: 404 });
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|icon.svg|opengraph-image|robots.txt|sitemap.xml).*)"],
};
