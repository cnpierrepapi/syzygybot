# Decisions

Short log. Newest at the bottom.

**One side only.** The agents sell to one side of each pair. The other brand is evidence. An earlier design introduced both sides to each other, and it got cut. Nobody wanted a matchmaker. Qloo sells data to the people who'd pay for it, and that's who this talks to.

**Same-type pairs need another signal.** Brand to brand affinity on Qloo comes back the same both ways (A24 and Liquid Death score 0.784 in each direction). Across types it's lopsided, which is useful. So "who gains more" for two brands has to come from somewhere else, like the popularity gap.

**No LinkedIn.** Contacts come from what brands and people publish themselves: press pages, trade press, conference speaker lists, Wikidata. Scraping LinkedIn breaks their terms.

**No @mentions on X until someone opts in.** X's automation rules don't allow unsolicited automated mentions. Posts use brand names without tags. A brand that mentions us has opted in.

**Real mailbox, separate domain.** Transactional senders like Resend ban cold outreach, so email goes out through a normal mailbox on its own sending domain. Until that exists, the sequencer runs dry: messages get written and logged but don't leave.

**Neon over Supabase.** The Supabase free tier was full, and the Vercel Marketplace hooks Neon up to the project directly.
