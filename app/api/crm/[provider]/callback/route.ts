// The CRM sends the brand back here: check state, swap the code for tokens (stored encrypted),
// run the first sync, and return to the brand's connect page.
import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { open } from "@/lib/crypto";
import { PROVIDERS, redirectUri, saveConnection, syncConnection } from "@/lib/crm";
import { SITE } from "@/lib/slug";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const crm = PROVIDERS[provider];
  const url = new URL(req.url), code = url.searchParams.get("code"), state = url.searchParams.get("state");
  const jar = await cookies(), raw = jar.get("crm_oauth")?.value;
  jar.delete("crm_oauth");
  let saved: { state: string; verifier: string; w: string; provider: string } | null = null;
  try { saved = raw ? JSON.parse(open(raw)) : null; } catch { saved = null; }
  if (!crm || !saved || saved.provider !== provider || !state || saved.state !== state) return new Response("This connection link expired. Start again from your SYZYGY page.", { status: 400 });
  const back = (q: string) => Response.redirect(`${SITE}/connect/${saved!.w}?${q}`, 302);
  if (!code) return back(`error=${encodeURIComponent(url.searchParams.get("error_description") ?? url.searchParams.get("error") ?? "cancelled")}`);
  const [ws] = (await sql()`select id from workspaces where connect_token = ${saved.w}`) as { id: string }[];
  if (!ws) return new Response("Not found", { status: 404 });
  try {
    await saveConnection(ws.id, provider, await crm.exchange(code, saved.verifier, redirectUri(provider)));
    const [conn] = (await sql()`select * from crm_connections where workspace_id = ${ws.id} and provider = ${provider}`) as Parameters<typeof syncConnection>[0][];
    await syncConnection(conn).catch(async e => { await sql()`update crm_connections set last_error = ${String((e as Error).message).slice(0, 500)} where id = ${conn.id}`; });
    return back(`connected=${provider}`);
  } catch (e) {
    return back(`error=${encodeURIComponent((e as Error).message.slice(0, 160))}`);
  }
}
