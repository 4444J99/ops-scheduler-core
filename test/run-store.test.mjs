import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { MAX_INFLIGHT, MAX_DISPATCHES_PER_TICK } from '../src/run-store.ts';
import { fixture, target, enqueue, NOW, SHA } from './fixtures.mjs';

async function pending(f, item = target(), time = NOW) {
  await enqueue(f.store, item, time);
  return (await f.store.candidates(time, [item]))[0];
}
test('activation binds exact admitted revision and never admits an unknown release', async context => {
  const f = fixture(context);
  assert.equal(await f.store.activation(SHA), null);
  f.sql.prepare("INSERT INTO ops_control VALUES('dispatcher',?,?,1)").run(SHA, NOW);
  assert.equal(await f.store.activation(SHA), NOW);
  assert.equal(await f.store.activation('b'.repeat(40)), null);
  f.sql.exec('UPDATE ops_control SET enabled=0');
  assert.equal(await f.store.activation(SHA), null);
});
test('source changes do not replay an already queued logical slot', async context => {
  const f = fixture(context), item = target();
  await enqueue(f.store, item); await enqueue(f.store, item, NOW, 'b'.repeat(40));
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM ops_runs').get().n, 1);
});
test('simultaneous claims admit one owner and persist start before completion', async context => {
  const f = fixture(context), item = target(), row = await pending(f, item);
  const claims = await Promise.all([f.store.claim(row, item, NOW, SHA), f.store.claim(row, item, NOW, SHA)]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM bookends WHERE phase='start'").get().n, 1);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM bookends WHERE phase='end'").get().n, 0);
});
test('owner, generation and lease fence terminal receipts', async context => {
  const f = fixture(context), item = target();
  const run = await f.store.claim(await pending(f, item), item, NOW, SHA);
  for (const invalid of [{ ...run, owner: 'another-owner' }, { ...run, generation: run.generation + 1 }])
    assert.equal(await f.store.finish(invalid, { ok: true, rid: run.id }, NOW + 1), false);
  assert.equal(await f.store.finish(run, { ok: true, rid: run.id }, run.lease_until + 1), false);
  assert.equal(await f.store.finish(run, { ok: true, rid: run.id }, NOW + 1), true);
  assert.equal(await f.store.finish(run, { ok: true, rid: run.id }, NOW + 2), false);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM bookends WHERE phase='end'").get().n, 1);
});
test('timeout is uncertain and retains per-target exclusion', async context => {
  const f = fixture(context), item = target();
  const run = await f.store.claim(await pending(f, item), item, NOW, SHA);
  await f.store.expire(run.lease_until + 1);
  await enqueue(f.store, item, NOW + 60000);
  assert.equal(f.sql.prepare('SELECT state FROM ops_runs WHERE id=?').get(run.id).state, 'uncertain');
  assert.deepEqual(await f.store.candidates(NOW + 60000, [item]), []);
  assert.equal(await f.store.finish(run, { ok: true, rid: run.id }, NOW + 1), false);
});
test('accepted is not completed and cannot release the target lock', async context => {
  const f = fixture(context), item = target();
  const run = await f.store.claim(await pending(f, item), item, NOW, SHA);
  assert.equal(await f.store.finish(run, { ok: true, rid: run.id, outcome: 'accepted' }, NOW + 1), true);
  await enqueue(f.store, item, NOW + 60000);
  assert.deepEqual(await f.store.candidates(NOW + 60000, [item]), []);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM bookends WHERE phase='end'").get().n, 0);
});
test('queued scope cannot be reassigned to a different owner or capability', async context => {
  const f = fixture(context), item = target(), row = await pending(f, item);
  for (const patch of [{ repositoryId: 9 }, { capability: 'Other' }, { environment: 'production' }, { accountRef: 'other-account' }])
    await assert.rejects(f.store.claim(row, { ...item, ownership: { ...item.ownership, ...patch } }, NOW, SHA), /claim_scope_mismatch/);
  assert.equal(f.sql.prepare('SELECT state FROM ops_runs').get().state, 'pending');
});
test('fleet concurrency remains bounded under competing claimers', async context => {
  const f = fixture(context), targets = Array.from({ length: MAX_INFLIGHT + 2 }, (_, i) => target(`job-${i}`, i + 1));
  for (const item of targets) await enqueue(f.store, item);
  const rows = f.sql.prepare('SELECT * FROM ops_runs').all();
  const claims = await Promise.all(rows.map(row => f.store.claim(row, targets.find(t => t.name === row.target), NOW, SHA)));
  assert.equal(claims.filter(Boolean).length, MAX_INFLIGHT);
});
test('daily target exhaustion preserves pending work and another target allocation', async context => {
  const f = fixture(context), item = target(); item.ownership.maxInvocationsPerDay = 1;
  const run = await f.store.claim(await pending(f, item), item, NOW, SHA);
  await f.store.finish(run, { ok: true, rid: run.id }, NOW + 1);
  await enqueue(f.store, item, NOW + 60000);
  const next = f.sql.prepare("SELECT * FROM ops_runs WHERE state='pending'").get();
  assert.equal(await f.store.claim(next, item, NOW + 60000, SHA), null);
  const other = target('beta', 2), otherRun = await pending(f, other);
  assert.ok(await f.store.claim(otherRun, other, NOW, SHA));
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM ops_runs WHERE state='pending'").get().n, 1);
});
test('fleet budget rejection rolls back earlier target reservation', async context => {
  const f = fixture(context), item = target(), row = await pending(f, item);
  f.sql.prepare("INSERT INTO ops_daily_dispatch VALUES('2030-01-07','*',2000)").run();
  assert.equal(await f.store.claim(row, item, NOW, SHA), null);
  assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM ops_daily_dispatch WHERE scope='alpha'").get().n, 0);
  assert.equal(f.sql.prepare('SELECT state FROM ops_runs').get().state, 'pending');
});
test('selection is bounded to admitted targets and uses the pending ordering index', async context => {
  const f = fixture(context), targets = Array.from({ length: MAX_DISPATCHES_PER_TICK + 2 }, (_, i) => target(`job-${i}`, i + 1));
  for (const item of targets) await enqueue(f.store, item);
  assert.deepEqual((await f.store.candidates(NOW, [targets[0]])).map(row => row.target), [targets[0].name]);
  assert.equal((await f.store.candidates(NOW, targets)).length, MAX_DISPATCHES_PER_TICK);
  assert.deepEqual(await f.store.candidates(NOW, []), []);
  const plan = f.sql.prepare("EXPLAIN QUERY PLAN SELECT id FROM ops_runs WHERE target=? AND state='pending' ORDER BY scheduled_at,id LIMIT 1").all('job-0');
  assert.ok(plan.some(row => row.detail.includes('ops_pending_target_order')));
});
test('reapplying additive migrations preserves historical evidence and queued rows', async context => {
  const f = fixture(context), item = target(); await pending(f, item);
  f.sql.prepare('INSERT INTO bookends VALUES(?,?,?,?,?,?,?)').run('historical', '2029-01-01', 'retired-example', 'end', 'success', '2029-01-01T00:00:00Z', 1);
  const migrations = new URL('../migrations/', import.meta.url);
  for (const name of readdirSync(migrations).sort()) f.sql.exec(readFileSync(new URL(name, migrations), 'utf8'));
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM ops_runs').get().n, 1);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM bookends').get().n, 1);
});
