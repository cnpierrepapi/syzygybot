import type { MetadataRoute } from "next";
import { SITE } from "@/lib/slug";

// Theses, accounts and the floor are public work worth finding. Pages about individual people
// (contacts, messages, replies) and plans carry a noindex tag instead of a Disallow here: a crawler
// blocked by robots.txt never sees the tag and can still list the bare URL.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/optout/"] }],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
