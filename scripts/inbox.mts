// npm run inbox -- <touch id> "reply text" [--real]  -> the Inbox agent handles one reply (simulated unless --real)
import { handleReply } from "../lib/inbox";
const [touch, text, flag] = process.argv.slice(2);
if (!touch || !text) { console.error('usage: npm run inbox -- <touch id> "reply text" [--real]'); process.exit(1); }
console.log(JSON.stringify(await handleReply(touch, text, flag !== "--real"), null, 2));
