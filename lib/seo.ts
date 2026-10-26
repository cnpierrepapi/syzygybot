// Search and sharing helpers.
import { SITE } from "./slug";

/** Descriptions read best at about 155 characters; cut at a word and never mid-sentence if avoidable. */
export function clip(s: string, max = 155) {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const dot = cut.lastIndexOf(". ");
  return dot > max * 0.6 ? cut.slice(0, dot + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

export const ORG = {
  "@type": "Organization",
  "@id": "https://onenept.com/#org",
  name: "Onenept Studios Inc.",
  url: "https://onenept.com",
  sameAs: ["https://github.com/cnpierrepapi"],
  address: { "@type": "PostalAddress", streetAddress: "611 South Dupont Highway, Suite 102", addressLocality: "Dover", addressRegion: "DE", postalCode: "19901", addressCountry: "US" },
};

/** JSON-LD for the floor: the product and who makes it. */
export const siteJsonLd = () => ({
  "@context": "https://schema.org",
  "@graph": [
    ORG,
    { "@type": "WebSite", "@id": `${SITE}/#site`, url: SITE, name: "SYZYGY", publisher: { "@id": ORG["@id"] } },
    {
      "@type": "SoftwareApplication", name: "SYZYGY", url: SITE, sameAs: ["https://github.com/cnpierrepapi/syzygybot"], applicationCategory: "BusinessApplication", operatingSystem: "Web",
      description: "Taste data that books the deal. Ten AI agents read Qloo's taste data, pick who an audience leans toward, find the person who decides and write the pitch: sponsorships, artist features, room bookings, ambassador deals, co-marketing and podcast ads. A business Qloo doesn't know is read through anchors Qloo does. A clearance agent checks every message and a person approves every send.",
      creator: { "@id": ORG["@id"] },
    },
  ],
});

/** Safe to drop inside a <script>: no closing tag can sneak out of the JSON. */
export const jsonLd = (data: unknown) => ({ __html: JSON.stringify(data).replace(/</g, "\u003c") });
