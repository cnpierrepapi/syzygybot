// Public, read-only: the constellation every page draws behind its content.
import { graph } from "@/lib/graph";

export const revalidate = 300;

export async function GET() {
  return Response.json(await graph(), { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=600" } });
}
