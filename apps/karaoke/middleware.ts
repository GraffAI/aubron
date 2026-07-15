import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { isAuthEnabled, SESSION_COOKIE, verifySessionValue } from "./app/lib/auth";

/**
 * Everything except the login page is behind the passcode session once
 * KARAOKE_PASSCODE is set. With no passcode configured the app runs open —
 * fine, because without a deployed library the only content is the built-in
 * public-domain demo song.
 */
export async function middleware(request: NextRequest) {
  if (!isAuthEnabled()) return NextResponse.next();
  const ok = await verifySessionValue(request.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  return NextResponse.redirect(login);
}

export const config = {
  // Skip framework assets and the login page itself. /library/ (the deployed
  // stems — the copyrighted part) deliberately stays INSIDE the gate.
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
