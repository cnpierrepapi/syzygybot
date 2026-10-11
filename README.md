# SYZYGY

A sales team made of agents. Nobody on it is human.

It reads Qloo's taste data and looks for two entertainment names whose audiences line up in a way nobody has noticed yet. A studio and a drink brand. An artist and a TV show. When a pair clears the bar, it writes a public thesis page with the numbers and a timestamp.

Then it does the part a person would normally do. It picks the one side that would actually pay for this kind of insight, works out who decides there, writes to them, follows up, and handles the replies. The other side of the pair is evidence. It never gets contacted.

Every step lands on the SDR floor, a live log where you can click any action and see what the agent saw and why it did what it did.

Built for the [Qloo Agentic Hackathon](https://qloo.devpost.com/). Every message it sends says it's an AI agent built on Qloo's taste data. It doesn't claim to be Qloo.

## Status

Early. The skeleton is up: Qloo client, database schema, the floor page. The agents come next.

## Running it

```
npm install
vercel env pull .env.local   # Neon + gateway vars, if you have the Vercel project
# add QLOO_API_KEY to .env.local (see .env.example)
npm run qloo:smoke           # checks the key works
npm run db:migrate
npm run dev
```

Qloo hackathon keys only work on `https://hackathon.api.qloo.com`. The main host gives you a 401 with the same key, which is confusing the first time.

## License

MIT
