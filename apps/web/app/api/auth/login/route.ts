import path from "node:path";
import { openDatabase, initializeSchema } from "../../../../lib/database";
import { root } from "../../../../lib/store";
import {
  adminCookie,
  createAdminSession,
  passwordMatches,
} from "../../../../lib/admin-session";
const db = openDatabase(path.join(root, "workspace/sundown.sqlite"));
initializeSchema(
  db,
  "CREATE TABLE IF NOT EXISTS admin_login_attempts(id INTEGER PRIMARY KEY CHECK(id=1), attempts INTEGER NOT NULL, until INTEGER NOT NULL)",
);
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (
    origin &&
    origin !== new URL(process.env.SUNDOWN_APP_URL || request.url).origin
  )
    return Response.json(
      { error: "Cross-origin login denied" },
      { status: 403 },
    );
  const secret = process.env.SUNDOWN_ADMIN_PASSWORD;
  if (!secret || secret.length < 16)
    return Response.json(
      {
        error: "Admin login is not configured. Judges can use the public demo.",
      },
      { status: 503 },
    );
  try {
    const reader = request.body?.getReader();
    if (!reader)
      return Response.json({ error: "Invalid login" }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > 4096) {
        await reader.cancel();
        return Response.json({ error: "Invalid login" }, { status: 413 });
      }
      chunks.push(result.value);
    }
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks),
    );
    const data: unknown = JSON.parse(raw);
    if (
      !data ||
      typeof data !== "object" ||
      !("password" in data) ||
      typeof data.password !== "string" ||
      data.password.length > 1024
    )
      return Response.json({ error: "Invalid login" }, { status: 400 });
    const now = Date.now();
    db.prepare(
      "INSERT INTO admin_login_attempts VALUES(1,0,?) ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN until<=? THEN 0 ELSE attempts END,until=CASE WHEN until<=? THEN ? ELSE until END",
    ).run(now + 60000, now, now, now + 60000);
    const claimed = db
      .prepare(
        "UPDATE admin_login_attempts SET attempts=attempts+1 WHERE id=1 AND attempts<10",
      )
      .run().changes;
    if (!claimed)
      return Response.json(
        { error: "Too many attempts. Try again in one minute." },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    if (!passwordMatches(data.password, secret))
      return Response.json({ error: "Incorrect password" }, { status: 401 });
    db.prepare("UPDATE admin_login_attempts SET attempts=0 WHERE id=1").run();
    return Response.json(
      { ok: true },
      {
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": `${adminCookie}=${createAdminSession(secret)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
        },
      },
    );
  } catch {
    return Response.json(
      { error: "Login unavailable. Please try again." },
      { status: 400 },
    );
  }
}
export function DELETE(request: Request) {
  const origin = request.headers.get("origin");
  if (
    origin &&
    origin !== new URL(process.env.SUNDOWN_APP_URL || request.url).origin
  )
    return Response.json(
      { error: "Cross-origin logout denied" },
      { status: 403 },
    );
  return Response.json(
    { ok: true },
    {
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": `${adminCookie}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
      },
    },
  );
}
