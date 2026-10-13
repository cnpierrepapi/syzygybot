// Old message links (/touch/<uuid>) live on in drafted letters; send them to /message/<slug>.
import { notFound, permanentRedirect } from "next/navigation";
import { resolve } from "@/lib/slug";

export default async function OldTouch({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const hit = await resolve("touches", id);
  if (!hit) notFound();
  permanentRedirect(hit.redirect ?? `/message/${id}`);
}
