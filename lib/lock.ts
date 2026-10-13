import { sql } from "./db";

/**
 * Runs `fn` only if no other run holds `name`. The lock expires after `ttlSec`, so a crashed run
 * can't block the queue forever. (Advisory locks don't work here: every Neon HTTP query is its own session.)
 */
export async function withLock<T>(name: string, ttlSec: number, fn: () => Promise<T>): Promise<T | { skipped: string }> {
  const [got] = (await sql()`
    insert into run_locks (name, until) values (${name}, now() + make_interval(secs => ${ttlSec}))
    on conflict (name) do update set until = excluded.until where run_locks.until < now()
    returning name`) as { name: string }[];
  if (!got) return { skipped: `${name} is already running` };
  try { return await fn(); }
  finally { await sql()`delete from run_locks where name = ${name}`; }
}
