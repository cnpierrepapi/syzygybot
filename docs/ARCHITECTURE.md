# Architecture

Next.js 16 on Vercel, Postgres on Neon, Gemini on Vertex AI. The diagram is in the [README](../README.md#how-it-fits-together).

## A desk run

Opening a desk starts a live run, or joins the one already going (`lib/live/run.ts`). The desk's plan (`lib/live/plans.ts`) says whose audience to read and what each lane pitches. Then ten agents carry each card across the board:

scout → numbers → deal check → rival check → contact finder → verifier → writer → clearance → (you) → sequencer → inbox

Scout pulls candidates out of Qloo. Numbers measures each one both ways and keeps the weaker number. Deal check and Rival check drop the talent's current partners and their competitors. Contact finder and Verifier only keep people and addresses found on a page the agent read itself. Writer drafts. Clearance runs the rules (`lib/clearance.ts`). The card waits for a person. After an approval, Sequencer sends in the recipient's window and Inbox sorts the replies.

Two cards are in flight at a time, so a run takes a few minutes and stays inside the model quotas.

## Models

`lib/llm.ts`. Picked by a bake-off on real inputs (`scripts/model-bakeoff.mts`): 3.5 Flash-Lite sorts and judges, 3.5 Flash researches with Google Search grounding, Gemini 4 Argon writes the drafts with 3.1 Pro behind it. Each tier falls through to the next model when one is busy or hangs.

## Businesses Qloo doesn't know

`lib/live/anchors.ts`. Qloo can't score a name it has never seen. So the agents read the business's site and pick anchors, things Qloo does know whose audience is that business's. The run reads the anchors together as the signal, and the return direction is measured kind by kind (Qloo filters one entity type per call). Both numbers stay Qloo's. The anchors live on the desk row, so an owner's swap counts on the next run.

## Real sends

`lib/owners.ts` decides who may send: a six-digit code to an email at the desk's own domain. `lib/outbound.ts` runs the gates (do-not-contact, role still held, Clearance, footer) and the caps. Email goes through the mailbox, letters through PostGrid. Unverified visitors get simulations.

## The action log

Every agent step writes one row to `actions`. The front page is a view over that table, and so is most of `/admin` (`lib/ops.ts`). If an agent did something, it's there.

## Qloo

`lib/qloo.ts` for the client, `lib/live/qx.ts` for what runs use. All GETs against the hackathon host. Every answer is cached by its exact question in `qloo_cache`, so a run never pays twice. Qloo quietly ignores parameters it doesn't know (an empty 200, not an error), so the client refuses anything off its whitelist.

## Crons

`vercel.json`. Desks every 30 minutes, mail every 15, the older outreach queue every 3 hours.

Schema lives in `db/schema.sql`. `npm run db:migrate` applies it; every statement is safe to run twice.
