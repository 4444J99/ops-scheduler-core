import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTargets, validateNewRegistration, validateAllocation, assertController, logicalRunKey } from '../src/contracts.ts';
import { parseCron, isDue as cronIsDue } from '../src/cron-matcher.ts';
import { getDueTargets } from '../src/scheduler.ts';
import { target, zeroCost, NOW } from './fixtures.mjs';

test('UTC schedules support steps, ranges, lists and Sunday alias', () => {
  assert.equal(cronIsDue(parseCron('*/15 12 1-10 1 *'), NOW), true);
  assert.equal(cronIsDue(parseCron('0 12 * * 1,3'), NOW), true);
  assert.equal(cronIsDue(parseCron('0 12 * * 7'), Date.UTC(2030, 0, 6, 12)), true);
  assert.equal(cronIsDue(parseCron('0 12 * * 1'), NOW + 60000), false);
});
test('invalid cron shapes fail closed', () => {
  for (const expression of ['* * *', '*/0 * * * *', '60 * * * *', '1-0 * * * *', '* * 1 * 1'])
    assert.throws(() => parseCron(expression));
});
test('target lists are explicit and inactive jobs never become due', () => {
  const a = target(), b = target('beta', 2);
  a.schedule = '0 12 * * *'; a.continuationSchedule = '*/5 * * * *'; b.active = false;
  assert.deepEqual(getDueTargets([a, b], NOW).map(x => [x.target.name, x.payload.drainOnly]), [['alpha', undefined]]);
  assert.deepEqual(getDueTargets([a, b], NOW + 300000).map(x => [x.target.name, x.payload.drainOnly]), [['alpha', true]]);
  assert.deepEqual(getDueTargets([], NOW), []);
});
test('admission refuses unknown owners, duplicate bindings and shared resource owners', () => {
  const a = target(); validateNewRegistration(a);
  assert.throws(() => validateTargets([{ ...a, ownership: { ...a.ownership, repositoryId: 0 } }]), /invalid_owner/);
  assert.throws(() => validateTargets([a, { ...target('beta', 2), binding: a.binding }]), /duplicate/);
  const b = target('beta', 2); b.ownership.service = a.ownership.service;
  assert.throws(() => validateTargets([a, b]), /conflicting_resource_owner/);
});
test('admission rejects non-boolean active values and accepts boolean active values', () => {
  const a = target();
  validateTargets([{ ...a, active: true }]);
  validateTargets([{ ...a, active: false }]);
  for (const active of ['false', 'true', 0, 1, null, undefined, {}]) {
    assert.throws(() => validateTargets([{ ...a, active }]), /duplicate_or_invalid_target/);
  }
});
test('new registrations require isolated measured authority', () => {
  const a = target(); a.ownership.authorization = 'legacy-default';
  assert.throws(() => validateNewRegistration(a), /isolated_measured/);
  a.ownership.authorization = 'named-entrypoint';
  a.ownership.resourceBudget = { state: 'unmeasured', issue: 'https://github.com/example/project/issues/1' };
  assert.throws(() => validateNewRegistration(a), /isolated_measured/);
});
test('allocation requires supplied allowance and retains reserve', () => {
  const a = target(), allowance = { ...zeroCost(), requests: 100 };
  a.ownership.resourceBudget.perDay.requests = 81;
  assert.throws(() => validateAllocation([a], allowance, zeroCost()), /allocation_exceeded/);
  a.ownership.resourceBudget.perDay.requests = 80;
  validateAllocation([a], allowance, zeroCost());
});
test('controller cannot cross environment boundaries or run unidentified', () => {
  const prodTarget = target(); prodTarget.ownership.environment = 'production';
  for (const env of ['staging', 'disabled', undefined]) assert.throws(() => assertController(prodTarget, env));
  assertController(prodTarget, 'production');

  const stagingTarget = target(); stagingTarget.ownership.environment = 'staging';
  for (const env of ['production', 'disabled', undefined]) assert.throws(() => assertController(stagingTarget, env));
  assertController(stagingTarget, 'staging');
});
test('logical keys fence environments and modes without binding source or retry', () => {
  const a = target(), key = logicalRunKey(a, NOW, 'scheduled');
  assert.equal(key, logicalRunKey(a, NOW + 999, 'scheduled'));
  assert.notEqual(key, logicalRunKey(a, NOW, 'drain'));
  a.ownership.environment = 'production';
  assert.notEqual(key, logicalRunKey(a, NOW, 'scheduled'));
  for (const time of [NaN, -1, Infinity]) assert.throws(() => logicalRunKey(a, time, 'scheduled'));
});
