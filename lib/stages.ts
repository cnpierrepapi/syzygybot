// One list page per funnel tile (/floor/<stage>). Each stage uses the same filter as its count in
// funnel(), so the number on the tile and the number of rows on the page agree. The privacy rules from
// the detail pages hold here too: no contact emails, no reply wording, nothing that names a claimed
// brand's own outreach, no opt-out addresses, no private handoff links.
import { sql } from "./db";
import { showSimulated } from "./floor";
import { pathFor } from "./slug";

export type StageRow = { key: string; href: string | null; title: string; sub: string; tag?: string; when: string };
export type Stage = { slug: string; label: string; agent: string; blurb: string; rows: () => Promise<StageRow[]>; count?: () => Promise<number> };

const day = (d: string | Date) => new Date(d).toISOString().slice(0, 10);
const LIMIT = 500;
type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const pairRows = async (where: "all" | "theses" | "pitch") => ((await sql()`
  select p.id, p.slug, p.band, p.score, p.called_at, p.deal_status, a.name a_name, b.name b_name, ac.slug ac_slug, ac.id ac_id, ae.name ac_name
  from pairs p join entities a on a.qloo_id = p.a_id join entities b on b.qloo_id = p.b_id
  left join accounts ac on ac.id = p.account_id left join entities ae on ae.qloo_id = ac.entity_id
  where ${where} = 'all' or (${where} = 'theses' and p.band in ('WATCH','PITCH')) or (${where} = 'pitch' and p.band = 'PITCH')
  order by p.called_at desc limit ${LIMIT}`) as R[]).map(r => ({
    key: r.id, href: pathFor("pairs", r.slug, r.id), title: `${r.a_name} × ${r.b_name}`, tag: `${r.band} ${Number(r.score).toFixed(2)}`,
    sub: [r.deal_status === "active" ? "already partners, not pitched" : r.deal_status === "past" ? "partnered before" : null,
      r.ac_name ? `account: ${r.ac_name}` : null].filter(Boolean).join(" · ") || "scored on Qloo taste data",
    when: day(r.called_at),
  }));

const contactRows = async (verifiedOnly: boolean) => ((await sql()`
  select c.id, c.slug, c.name, c.role, c.kind, c.role_status, c.created_at, e.name company
  from contacts c join accounts ac on ac.id = c.account_id join entities e on e.qloo_id = ac.entity_id
  where not ${verifiedOnly} or c.role_status = 'confirmed'
  order by c.created_at desc limit ${LIMIT}`) as R[]).map(r => ({
    key: r.id, href: pathFor("contacts", r.slug, r.id), title: r.name ?? r.role, tag: r.role_status ?? "unchecked",
    sub: [r.name ? r.role : "published inbox", r.company].filter(Boolean).join(" · "), when: day(r.created_at),
  }));

const touchRows = async (scheduledOnly: boolean) => ((await sql()`
  select t.id, t.slug, t.channel, t.step, t.subject, t.status, t.scheduled_for, t.created_at, t.workspace_id is not null inward,
    c.name, c.role, e.name company
  from touches t join contacts c on c.id = t.contact_id join accounts ac on ac.id = c.account_id join entities e on e.qloo_id = ac.entity_id
  where (${scheduledOnly} and t.scheduled_for is not null and t.status <> 'cancelled') or (not ${scheduledOnly} and t.step = 1)
  order by coalesce(t.scheduled_for, t.created_at) desc limit ${LIMIT}`) as R[]).map(r => ({
    key: r.id, href: pathFor("touches", r.slug, r.id),
    // A claimed brand's own messages stay private: no subject, no name of who it went to.
    title: r.inward ? "Message signed by a claimed brand" : `${r.name ?? r.role} at ${r.company}`,
    sub: r.inward ? `${r.channel}, step ${r.step}` : `${r.channel}, step ${r.step}${r.subject ? ` · "${r.subject}"` : ""}`,
    tag: r.status === "dry_run" ? "dry run" : r.status,
    when: scheduledOnly && r.scheduled_for ? `due ${day(r.scheduled_for)}` : day(r.created_at),
  }));

export const STAGES: Stage[] = [
  {
    slug: "queue", label: "Pairs in queue", agent: "scout",
    // Same number as the tile: pairs still waiting. The list also shows the latest picks on top.
    count: async () => ((await sql()`select count(*)::int n from pair_queue where status = 'queued'`) as { n: number }[])[0].n,
    blurb: "Every pair the intake has pre-scored from Qloo, best first. Scout takes the top one each hour whose brand hasn't been pitched; picked pairs open their thesis.",
    rows: async () => {
      const picked = (await sql()`
        select q.id, q.score, q.band, q.picked_at, q.a->>'name' a, q.b->>'name' b, p.slug, p.id pair_id
        from pair_queue q left join pairs p on p.id = q.pair_id where q.status = 'picked' order by q.picked_at desc limit 50`) as R[];
      const waiting = (await sql()`
        select id, score, band, scored_at, a->>'name' a, b->>'name' b from pair_queue
        where status = 'queued' order by (band = 'PITCH') desc, score desc limit 3000`) as R[];
      return [
        ...picked.map(r => ({
          key: r.id, href: r.pair_id ? pathFor("pairs", r.slug, r.pair_id) : null, title: `${r.a} × ${r.b}`,
          tag: `${r.band} ${Number(r.score).toFixed(2)}`, sub: "Picked by Scout and sent down the chain", when: day(r.picked_at),
        })),
        ...waiting.map((r, i) => ({
          key: r.id, href: null, title: `${r.a} × ${r.b}`, tag: `${r.band} ${Number(r.score).toFixed(2)}`,
          sub: `#${i + 1} in the queue`, when: day(r.scored_at),
        })),
      ];
    },
  },
  { slug: "pairs", label: "Pairs researched", agent: "scout", blurb: "Every pair Scout has scored on Qloo taste data, kept or passed.", rows: () => pairRows("all") },
  { slug: "theses", label: "Theses published", agent: "scout", blurb: "Pairs that cleared WATCH and got a written thesis.", rows: () => pairRows("theses") },
  { slug: "pitch", label: "PITCH grade", agent: "scout", blurb: "The strongest theses: PITCH band on the rubric.", rows: () => pairRows("pitch") },
  {
    slug: "accounts", label: "Accounts qualified", agent: "qualifier", blurb: "The side of each pair the Qualifier picked as the buyer, with the Numbers pack.",
    rows: async () => ((await sql()`
      select ac.id, ac.slug, ac.reason, ac.created_at, e.name, pe.name passed
      from accounts ac join entities e on e.qloo_id = ac.entity_id left join entities pe on pe.qloo_id = ac.passed_on
      order by ac.created_at desc limit ${LIMIT}`) as R[]).map(r => ({
        key: r.id, href: pathFor("accounts", r.slug, r.id), title: r.name, tag: r.passed ? `over ${r.passed}` : undefined,
        sub: r.reason, when: day(r.created_at),
      })),
  },
  { slug: "contacts", label: "Contacts found", agent: "contact_finder", blurb: "Named buyers and published inboxes from public sources. Never LinkedIn, never a guessed email.", rows: () => contactRows(false) },
  { slug: "verified", label: "Verified", agent: "verifier", blurb: "Contacts the Verifier confirmed on a page it read itself.", rows: () => contactRows(true) },
  { slug: "messages", label: "Messages drafted", agent: "writer", blurb: "First messages the Writer drafted, one per verified contact. Held as dry runs until a person approves each one.", rows: () => touchRows(false) },
  { slug: "scheduled", label: "Steps scheduled", agent: "sequencer", blurb: "Every step the Sequencer has timed, follow-ups included, in the recipient's working hours.", rows: () => touchRows(true) },
  {
    slug: "replies", label: "Replies", agent: "inbox", blurb: "Replies the Inbox agent sorted and answered. The wording stays private; this shows the class only.",
    rows: async () => ((await sql()`
      select r.id, r.slug, r.class, r.simulated, r.created_at, e.name company
      from replies r join touches t on t.id = r.touch_id join contacts c on c.id = t.contact_id
      join accounts ac on ac.id = c.account_id join entities e on e.qloo_id = ac.entity_id
      where ${showSimulated()} or not r.simulated order by r.created_at desc limit ${LIMIT}`) as R[]).map(r => ({
        key: r.id, href: pathFor("replies", r.slug, r.id), title: `Reply from ${r.company}`,
        tag: `${r.class.replace("_", " ")}${r.simulated ? " (simulated)" : ""}`, sub: "Sorted and answered by the Inbox agent", when: day(r.created_at),
      })),
  },
  {
    slug: "opt-outs", label: "Opt-outs honoured", agent: "inbox", blurb: "Addresses and domains that asked not to hear from SYZYGY again. The addresses themselves are never shown.",
    rows: async () => ((await sql()`select value, reason, created_at from do_not_contact order by created_at desc limit ${LIMIT}`) as R[]).map((r, i) => ({
      key: `${i}`, href: null, title: r.value.includes("@") ? "An email address" : "A whole domain", sub: r.reason, when: day(r.created_at),
    })),
  },
  {
    slug: "handoffs", label: "Handed to a person", agent: "inbox", blurb: "Interested replies passed to a person. The handoff packet is private; each row links to the reply.",
    rows: async () => ((await sql()`
      select h.id, h.status, h.simulated, h.created_at, h.workspace_id is not null to_brand, r.id reply_id, r.slug reply_slug, e.name company
      from handoffs h join replies r on r.id = h.reply_id join touches t on t.id = r.touch_id join contacts c on c.id = t.contact_id
      join accounts ac on ac.id = c.account_id join entities e on e.qloo_id = ac.entity_id
      where ${showSimulated()} or not h.simulated order by h.created_at desc limit ${LIMIT}`) as R[]).map(r => ({
        key: r.id, href: pathFor("replies", r.reply_slug, r.reply_id), title: r.to_brand ? "Interested reply, handed to the brand" : `Interested reply from ${r.company}`,
        tag: `${r.status}${r.simulated ? " (simulated)" : ""}`, sub: r.to_brand ? "Went to the claimed brand's own desk" : "Went to SYZYGY's desk to refer on to Qloo", when: day(r.created_at),
      })),
  },
  {
    slug: "claimed", label: "Brands claimed", agent: "verifier", blurb: "Brands that proved they own their handle and took over their own outreach.",
    rows: async () => ((await sql()`
      select w.id, w.name, w.claimed_at, (select ac.slug from accounts ac where ac.entity_id = w.entity_id limit 1) ac_slug,
        (select ac.id from accounts ac where ac.entity_id = w.entity_id limit 1) ac_id
      from workspaces w where w.claimed_at is not null and not w.demo order by w.claimed_at desc limit ${LIMIT}`) as R[]).map(r => ({
        key: r.id, href: r.ac_id ? pathFor("accounts", r.ac_slug, r.ac_id) : null, title: r.name, sub: "Claimed through a post from its own handle", when: day(r.claimed_at),
      })),
  },
];

export const stage = (slug: string) => STAGES.find(s => s.slug === slug);
