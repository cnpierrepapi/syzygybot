# Decisions

Short log. Newest at the bottom.

**One side only.** The agents sell to one side of each pair. The other brand is evidence. An earlier design introduced both sides to each other, and it got cut. Nobody wanted a matchmaker. Qloo sells data to the people who'd pay for it, and that's who this talks to.

**Same-type pairs need another signal.** Brand to brand affinity on Qloo comes back the same both ways (A24 and Liquid Death score 0.784 in each direction). Across types it's lopsided, which is useful. So "who gains more" for two brands has to come from somewhere else, like the popularity gap.

**No LinkedIn.** Contacts come from what brands and people publish themselves: press pages, trade press, conference speaker lists, Wikidata. Scraping LinkedIn breaks their terms.

**No @mentions on X until someone opts in.** X's automation rules don't allow unsolicited automated mentions. Posts use brand names without tags. A brand that mentions us has opted in.

**Real mailbox, separate domain.** Transactional senders like Resend ban cold outreach, so email goes out through a normal mailbox on its own sending domain, agent@syzygybot.com.

**Neon over Supabase.** The Supabase free tier was full, and the Vercel Marketplace hooks Neon up to the project directly.

**Gemini on Vertex.** It was the provider with quota on the trial account. A bake-off on real inputs picked one model per kind of call.

**Qloo's number leads.** SYZYGY built its own match score while the Qloo quota was spent. Once the quota came back, Qloo's two-way score became the number on every card. Ours stays in small type.

**A desk sends as itself, once its owner proves it.** Approve on a desk sends the card as written, in the desk's name. The condition is a code sent to an email at the desk's own domain. Free mail doesn't count, and neither do majors and big agencies. Without that, anyone could post letters signed as Live Nation.

**Not in Qloo still gets Qloo's numbers.** For a business Qloo doesn't know, the score is Qloo's affinity between the candidates and the business's anchors, both ways. The card and the draft both say it was measured against anchors.

**Models off.** Search grounding alone used EUR 182 of the Google Cloud credit, so billing was switched off on 28 Oct. Desks that have run play back their finished runs, and new desks run on live Qloo with a template writer.

**$5 a send, free for Qloo customers.** A monthly fee charges for cards people rejected, so the price follows messages that really left. The number comes from a rule: the sender keeps at least two thirds of the time saved. Qloo customers already paid for the data. The working is in [PRICING.md](PRICING.md).
