// Encrypts CRM tokens at rest: AES-256-GCM with CRM_TOKEN_KEY (32 bytes, base64).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key() {
  const k = process.env.CRM_TOKEN_KEY;
  if (!k) throw new Error("CRM_TOKEN_KEY is not set");
  const b = Buffer.from(k, "base64");
  if (b.length !== 32) throw new Error("CRM_TOKEN_KEY must be 32 bytes, base64");
  return b;
}

export function seal(plain: string) {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function open(sealed: string) {
  const [v, iv, tag, ct] = sealed.split(":");
  if (v !== "v1") throw new Error("unknown token format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

/** PKCE: a random verifier and its S256 challenge. */
export function pkce() {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}
