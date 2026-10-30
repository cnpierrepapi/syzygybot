import type { Metadata } from "next";
import { Logo } from "../components/visuals";

export const metadata: Metadata = {
  title: "Pricing",
  description: "SYZYGY is free to try and $5 for each message that actually sends. No monthly fee and no cut of your deals. Free for Qloo customers.",
  alternates: { canonical: "/pricing" },
};

const talk = (subject: string) => `mailto:admin@onenept.com?subject=${encodeURIComponent(subject)}`;
const METHOD = "https://github.com/cnpierrepapi/syzygybot/blob/main/docs/PRICING.md";

const PLANS = [
  {
    name: "Try it", price: "$0", per: "", cta: "Open a desk", href: "/desk",
    for: "See what the agents would do for you.",
    has: ["Any brand, artist, show, podcast or website", "Qloo's score on every pair, both ways", "The person who decides and the drafted pitch", "Approve runs as a simulation. Nothing leaves"],
  },
  {
    name: "Send for real", price: "$5", per: "per message sent", cta: "Talk to us", href: talk("SYZYGY: sending for real"),
    for: "You only pay when a message you approved leaves.",
    has: ["No monthly fee, no seats, no cut of your deals", "Drafts, rejects, holds and bounces cost nothing", "Replies sorted, opt-outs honoured, real replies handed to you", "Letters add printing and postage at cost, from $1.06"],
  },
  {
    name: "Qloo customers", price: "Free", per: "", cta: "Claim it", href: talk("SYZYGY: we're a Qloo customer"), lead: true,
    for: "You already pay for the data. The agents are on us.",
    has: ["Everything in Send for real, at no charge", "As many desks as you've got rosters", "Runs on your own Qloo key", "Only letters cost anything: printing and postage at cost"],
  },
];

const VALUE: [string, string, string][] = [["Low estimate", "$16", "69%"], ["Middle", "$30", "83%"], ["High estimate", "$55", "91%"]];

export default function Pricing() {
  return (
    <main className="wrap" style={{ maxWidth: 1040 }}>
      <nav className="nav">
        <Logo />
        <a className="btn" href="/desk" style={{ padding: "7px 16px", fontSize: 13.5 }}>Open a desk →</a>
      </nav>
      <section style={{ padding: "36px 0 26px" }}>
        <p className="eyebrow">Pricing</p>
        <h1 style={{ fontSize: "clamp(30px, 4vw, 44px)", lineHeight: 1.05 }}>Free to try.<br /><span className="grad-text">$5 when it sends.</span></h1>
        <p style={{ color: "var(--dim)", maxWidth: 600, marginTop: 14 }}>
          Most cards shouldn&apos;t go out, and that&apos;s what the approval step is for. So you pay for the messages you sent, not for a seat or a month.
        </p>
      </section>
      <section className="price-grid" aria-label="Plans">
        {PLANS.map(p => (
          <article key={p.name} className={`panel price-card${p.lead ? " lead" : ""}`}>
            <h2>{p.name}</h2>
            <div className="price-tag">{p.price}{p.per && <small>{p.per}</small>}</div>
            <p style={{ margin: 0, fontSize: 14.5 }}>{p.for}</p>
            <ul>{p.has.map(x => <li key={x}>{x}</li>)}</ul>
            <a className={`btn${p.lead ? "" : " quiet"}`} href={p.href}>{p.cta}</a>
          </article>
        ))}
      </section>
      <section className="price-why">
        <div>
          <h2 style={{ fontSize: 20 }}>Why $5</h2>
          <p>
            Finding the partner and the person, then writing and checking the pitch, takes a rep 20 to 45 minutes an account. Take off
            two minutes for you to read the card, and each send saves you $16 to $55 of someone&apos;s time.
          </p>
          <p>
            We set one rule first: you keep at least two thirds, even on the low estimate. That comes to $5. A card has cost us under $1 in models.
          </p>
          <p>
            We don&apos;t know our reply rate yet, because almost nothing has gone out for real. We&apos;ll look at this price again after the first 200 sends.
            {" "}<a href={METHOD}>Read the method and sources →</a>
          </p>
        </div>
        <table className="price-math">
          <thead><tr><th scope="col"></th><th scope="col">Worth per send</th><th scope="col">You keep at $5</th></tr></thead>
          <tbody>{VALUE.map(([k, a, b]) => <tr key={k}><th scope="row">{k}</th><td>{a}</td><td>{b}</td></tr>)}</tbody>
        </table>
      </section>
      <p className="hint" style={{ marginTop: 26 }}>No checkout yet. Paid and Qloo desks are set up by hand, so email us. Customers who aren&apos;t on Qloo also need a Qloo data licence, and we&apos;ll sort that out with you first.</p>
    </main>
  );
}
