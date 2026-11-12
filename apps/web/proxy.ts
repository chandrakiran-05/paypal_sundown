import { NextResponse } from "next/server";
import { checkAccess } from "./lib/access";
import { sharedAccessEnabled, workspacePassword } from "./lib/workspace-access";
import { adminCookie, createAdminSession } from "./lib/admin-session";
export function proxy(request: Request) {
  const denied = checkAccess(request);
  // Automatically enter the public showcase on browser navigation only.
  // API requests still require the issued session and same-origin mutation checks.
  if (
    sharedAccessEnabled() &&
    ["GET", "HEAD"].includes(request.method) &&
    request.headers.get("accept")?.includes("text/html") &&
    !new URL(request.url).pathname.startsWith("/api/") &&
    (!denied || denied.status === 303)
  ) {
    const response = NextResponse.next();
    response.cookies.set(adminCookie, createAdminSession(workspacePassword), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 28800,
      secure: new URL(request.url).protocol === "https:",
    });
    return response;
  }
  return denied || NextResponse.next();
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico).*)"],
};
