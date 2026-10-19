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
  address: { "@type": "PostalAddress", streetAddress: "611 South Dupont Highway, Suite 102", addressLocality: "Dover", addressRegion: "DE", postalCode: "19901", addressCountry: "US" },
};

/** JSON-LD for the floor: the product and who makes it. */
export const siteJsonLd = () => ({
  "@context": "https://schema.org",
  "@graph": [
    ORG,
    { "@type": "WebSite", "@id": `${SITE}/#site`, url: SITE, name: "SYZYGY", publisher: { "@id": ORG["@id"] } },
    {
      "@type": "SoftwareApplication", name: "SYZYGY", url: SITE, applicationCategory: "BusinessApplication", operatingSystem: "Web",
      description: "A complete, fully automated commercial team for entertainment. 17 AI agents turn audience data into tour routes, venue holds, sponsorship and ambassador pitches, ad sales and sales pipeline, with a compliance agent and a person approving every send. Built on Qloo's taste data plus its own match score.",
      creator: { "@id": ORG["@id"] },
    },
  ],
});

/** Safe to drop inside a <script>: no closing tag can sneak out of the JSON. */
export const jsonLd = (data: unknown) => ({ __html: JSON.stringify(data).replace(/</g, "\u003c") });
