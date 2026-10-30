import type { Metadata } from "next";
import { Logo } from "../components/visuals";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Every SYZYGY desk is free to run as a simulation. Pay when you want Approve to send the real email or letter.",
  alternates: { canonical: "/pricing" },
};

const TALK = "mailto:admin@onenept.com?subject=SYZYGY%20pricing";

const PLANS = [
  {
    name: "Try a desk", price: "$0", per: "", cta: "Open a desk", href: "/desk",
    for: "See what the agents would do for you.",
    has: ["Any brand, artist, show, podcast or website", "Qloo's score on every pair, both ways", "The person who decides and the drafted pitch", "Approve runs as a simulation. Nothing leaves"],
  },
  {
    name: "One desk", price: "$1,500", per: "a month", cta: "Talk to us", href: TALK, lead: true,
    for: "One tour, brand, show or venue, sending for real.",
    has: ["Everything in Try a desk", "Approve sends the real email or letter, once you verify your domain", "Emails wait for the recipient's sending window", "Replies sorted, opt-outs honoured, real replies handed to you", "Swap the anchors your desk reads through"],
  },
  {
    name: "Studio", price: "$4,500", per: "a month", cta: "Talk to us", href: TALK,
    for: "A label, agency or venue group with several rosters.",
    has: ["Up to five desks", "A Clearance desk over everything they write, with your own rules", "One record of every step the agents took"],
  },
];

export default function Pricing() {
  return (
    <main className="wrap" style={{ maxWidth: 1040 }}>
      <nav className="nav">
        <Logo />
        <a className="btn" href="/desk" style={{ padding: "7px 16px", fontSize: 13.5 }}>Open a desk →</a>
      </nav>
      <section style={{ padding: "36px 0 26px" }}>
        <p className="eyebrow">Pricing</p>
        <h1 style={{ fontSize: "clamp(30px, 4vw, 44px)", lineHeight: 1.05 }}>Start free.<br /><span className="grad-text">Pay when it sends.</span></h1>
        <p style={{ color: "var(--dim)", maxWidth: 600, marginTop: 14 }}>
          Every desk runs for free as a simulation. You get the pick, the person and the pitch. Pay when you want Approve to send it for real.
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
      <section className="price-notes">
        <p style={{ margin: 0 }}><b>Letters cost extra</b>Each printed letter is billed at what the print house charges us. Email is included, up to the desk&apos;s daily limit.</p>
        <p style={{ margin: 0 }}><b>Qloo&apos;s data</b>Paid plans need a commercial Qloo licence. We&apos;ll sort that out with you before anything starts.</p>
        <p style={{ margin: 0 }}><b>No checkout yet</b>Paid desks are set up by hand for now. Email us, and bigger teams can ask for a custom plan the same way.</p>
      </section>
    </main>
  );
}
