# Architecture

Next.js 16 on Vercel, Postgres on Neon. The diagram is in the [README](../README.md#how-it-works).

## A desk run

`lib/live/run.ts`. Opening a desk joins the run in progress or starts one. The desk's plan (`lib/live/plans.ts`) says whose audience to read and what each lane pitches. Cards then move through the agents in order, and each step is logged as it happens. A card ends as a permission request waiting for a person.

A desk with a finished run plays that run back, step by step, at most four minutes long. Its drafts land on the desk as their cards reach Your approval. A desk that has never run gets a new run.

## Models

`lib/llm.ts`. Off since 28 Oct: every call throws unless it's inside `withGemini()`, and nothing opens that. New runs use the template writer in `lib/desks/housewriter.ts`, and website desks pick anchors by theme from the site's own words (`readSite` in `lib/live/anchors.ts`).

When on, the picks from a bake-off on real inputs (`scripts/model-bakeoff.mts`) were 3.5 Flash-Lite for sorting, 3.5 Flash for research and Gemini 4 Argon for drafts.

## Businesses Qloo doesn't know

`lib/live/anchors.ts`. Qloo can't score a name it has never seen, so a run reads a business's anchors together as the signal. The return direction is measured kind by kind, since Qloo filters one entity type per call. Both numbers stay Qloo's.

## Real sends

`lib/owners.ts` decides who may send. `lib/outbound.ts` runs the gates (do-not-contact, role still held, Clearance, footer) and the caps. Email goes through the mailbox, letters through PostGrid. Approved messages wait in `outbound` until the mail cron finds them due. The desk's owner sees them under Queued to send and can take one back before it leaves.

## Qloo

`lib/qloo.ts` for the client, `lib/live/qx.ts` for what runs use. Every answer is cached by its exact question in `qloo_cache`.

## Crons

One, in `vercel.json`: `/api/mail` every 15 minutes.

## Older code

The first version was a pipeline with no desks: theses, accounts and a message queue. It stopped on 23 Oct. Its pages (`/thesis`, `/account`, `/floor`) stay up because they hold real research. Its cron routes return `{off: true}`, and most scripts in `scripts/` belong to it. The HubSpot and Salesforce connectors were built and never connected.

Schema is in `db/schema.sql`. `npm run db:migrate` applies it, and every statement is safe to run twice.
