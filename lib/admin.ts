// The operator's sign-in. One key (ADMIN_KEY), held only by the person who approves real sends. The cookie carries a hash
// of the key, never the key, and every check compares in constant time. Without it, every page stays read-only.
import { cookies } from "next/headers";
import { createHash, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "syz_admin";
const hash = (s: string) => createHash("sha256").update(`syzygy-admin:${s}`).digest();

export function keyMatches(given: string) {
  const key = process.env.ADMIN_KEY;
  if (!key || key.length < 24 || !given) return false;
  return timingSafeEqual(hash(given), hash(key));
}

export async function isAdmin() {
  const key = process.env.ADMIN_KEY, v = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!key || key.length < 24 || !v || !/^[0-9a-f]{64}$/.test(v)) return false;
  return timingSafeEqual(Buffer.from(v, "hex"), hash(key));
}

export async function signIn(given: string) {
  if (!keyMatches(given)) return false;
  (await cookies()).set(ADMIN_COOKIE, hash(given).toString("hex"), { httpOnly: true, secure: true, sameSite: "strict", maxAge: 30 * 86400, path: "/" });
  return true;
}
