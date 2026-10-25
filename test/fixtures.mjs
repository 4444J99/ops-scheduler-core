import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { RunStore } from '../src/run-store.ts';

export const NOW = Date.UTC(2030, 0, 7, 12, 0);
export const SHA = 'a'.repeat(40);
export const zeroCost = () => Object.fromEntries(
  ['kvRead', 'kvWrite', 'kvList', 'kvDelete', 'd1Read', 'd1Write', 'requests', 'cpuMs'].map(k => [k, 0])
);
export function target(name = 'alpha', id = 1) {
  return {
    name, binding: name.toUpperCase(), schedule: '* * * * *', entrypoint: 'Scheduled', active: true,
    ownership: {
      repositoryId: id, repository: `example/${name}`, environment: 'staging',
      accountRef: 'example-account', service: `example-${name}`, capability: 'Scheduled',
      authorization: 'named-entrypoint', contractVersion: 1, maxDurationMs: 1000,
      maxInvocationsPerDay: 10, freshnessMs: 60000,
      resourceBudget: { state: 'bounded', perInvocation: zeroCost(), perDay: zeroCost() },
    },
  };
}
export function fixture(context) {
  const sql = new DatabaseSync(':memory:');
  context.after(() => sql.close());
  const migrations = new URL('../migrations/', import.meta.url);
  for (const name of readdirSync(migrations).sort()) sql.exec(readFileSync(new URL(name, migrations), 'utf8'));
  const db = {
    prepare(query) {
      let values = [];
      return {
        bind(...v) { values = v; return this; },
        async first() { return sql.prepare(query).get(...values) ?? null; },
        async all() { return { results: sql.prepare(query).all(...values), success: true }; },
        async run() { sql.prepare(query).run(...values); return { success: true }; },
        execute() {
          if (/^\s*SELECT/.test(query)) return { results: sql.prepare(query).all(...values), success: true };
          sql.prepare(query).run(...values); return { results: [], success: true };
        },
      };
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try { const results = statements.map(s => s.execute()); sql.exec('COMMIT'); return results; }
      catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  };
  return { sql, db, store: new RunStore(db) };
}
export async function enqueue(store, item, time = NOW, sha = SHA) {
  await store.enqueue([{ target: item, payload: { target: item.name, scheduledTime: time, cron: item.schedule } }], NOW, sha);
}
