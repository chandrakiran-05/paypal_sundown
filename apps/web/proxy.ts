import { NextResponse } from "next/server";
import { checkAccess } from "./lib/access";
export function proxy(request: Request) {
  return checkAccess(request) || NextResponse.next();
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico).*)"],
};
