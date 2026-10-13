// Starts a CRM connection for a workspace: PKCE + state in a short-lived, encrypted, httpOnly cookie,
// then off to the CRM's own consent screen.
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { sql } from "@/lib/db";
import { pkce, seal } from "@/lib/crypto";
import { PROVIDERS, redirectUri } from "@/lib/crm";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const crm = PROVIDERS[provider];
  const w = new URL(req.url).searchParams.get("w") ?? "";
  if (!crm || !/^[A-Za-z0-9]{8,64}$/.test(w)) return new Response("Not found", { status: 404 });
  if (!crm.configured()) return new Response(`${crm.label} isn't set up on SYZYGY yet.`, { status: 503 });
  const [ws] = (await sql()`select id from workspaces where connect_token = ${w}`) as { id: string }[];
  if (!ws) return new Response("Not found", { status: 404 });
  const { verifier, challenge } = pkce(), state = randomBytes(24).toString("base64url");
  (await cookies()).set("crm_oauth", seal(JSON.stringify({ state, verifier, w, provider })), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/api/crm", maxAge: 600,
  });
  return Response.redirect(crm.authorizeUrl(state, challenge, redirectUri(provider)), 302);
}
