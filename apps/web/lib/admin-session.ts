import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
export const adminCookie = "sundown-admin";
export function passwordMatches(value: string, password: string) {
  const hash = (s: string) => createHmac("sha256", password).update(s).digest();
  return timingSafeEqual(hash(value), hash(password));
}
export function createAdminSession(password: string, now = Date.now()) {
  const data = `${now + 8 * 3600000}.${randomBytes(24).toString("hex")}`;
  return `${data}.${createHmac("sha256", password)
    .update("admin:" + data)
    .digest("hex")}`;
}
export function validAdminSession(
  token: string,
  password: string,
  now = Date.now(),
) {
  if (!/^\d{13}\.[a-f0-9]{48}\.[a-f0-9]{64}$/.test(token)) return false;
  const [expires, nonce, signature] = token.split(".");
  if (+expires <= now || +expires > now + 8 * 3600000) return false;
  const expected = createHmac("sha256", password)
    .update(`admin:${expires}.${nonce}`)
    .digest("hex");
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
