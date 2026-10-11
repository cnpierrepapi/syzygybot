# Architecture

Next.js on Vercel. Postgres on Neon. Models through Vercel AI Gateway: Haiku for the cheap sorting work, Sonnet when something has to be written well.

## The pipeline

Ten agents, one after another. Each one reads what the last one left in the database and writes its own rows.

scout → qualifier → numbers → contact finder → verifier → strategist → writer → sequencer → inbox → booker

The scout finds the pair and publishes the thesis. The qualifier picks the side worth selling to and says why it passed on the other. Numbers builds the evidence pack, plus three more partners Qloo finds for the same brand. Contact finder and verifier work out who to write to, using public sources only. Strategist, writer and sequencer turn that into actual messages on a schedule. Inbox sorts replies and answers questions with fresh Qloo queries. Booker writes the handoff if someone wants a call.

## The action log

Every agent step writes one row to `actions`. That's the whole trick behind the floor. The page is a view over one table, so if an agent did something, it's there, and if it isn't there, it didn't happen.

## Qloo

`lib/qloo.ts`. All calls are GETs against the hackathon host. Qloo quietly ignores parameters it doesn't know (you get an empty 200, not an error), so the client refuses any parameter that isn't on its whitelist.

Schema lives in `db/schema.sql`.
