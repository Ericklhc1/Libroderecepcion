import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitForNativeShiftReceipt, withDeadline } from './shift-action-observation.mjs';

const attempt = { formId: 'synthetic-form', offset: 0 };
const pageWith = receipts => ({
  waitForFunction: async (_predicate, observedAttempt) => { assert.deepEqual(observedAttempt, attempt); },
  evaluate: async (_predicate, observedAttempt) => { assert.deepEqual(observedAttempt, attempt); return receipts; },
});

test('an unfinished stream blocks the old wait while a decoded native receipt completes the new one', async () => {
  const response = { finished: () => new Promise(() => {}) };
  await assert.rejects(withDeadline(response.finished(), 10, 'old Flight EOF'), /old Flight EOF exceeded/);
  const receipt = { formId: attempt.formId, ok: true };
  assert.equal(await waitForNativeShiftReceipt(pageWith([receipt]), attempt, true), receipt);
});
test('a decoded native rejection remains a rejection', async () => {
  const receipt = { formId: attempt.formId, ok: false };
  assert.equal(await waitForNativeShiftReceipt(pageWith([receipt]), attempt, false), receipt);
  await assert.rejects(waitForNativeShiftReceipt(pageWith([receipt]), attempt, true), /HTTP 200 alone/);
});
test('a missing native receipt cannot be accepted as success', async () => {
  await assert.rejects(waitForNativeShiftReceipt(pageWith([]), attempt, true), /One decoded native outcome/);
});
test('duplicate receipts cannot be accepted as one action', async () => {
  const receipt = { formId: attempt.formId, ok: true };
  await assert.rejects(waitForNativeShiftReceipt(pageWith([receipt, receipt]), attempt, true), /One decoded native outcome/);
});
test('receipt wait failure is preserved', async () => {
  const original = new Error('synthetic receipt timeout');
  await assert.rejects(waitForNativeShiftReceipt({ waitForFunction: async () => { throw original; } }, attempt, true), error => error === original);
});
test('deadline returns success and clears its timer', async () => {
  assert.equal(await withDeadline(Promise.resolve('ready'), 10000, 'unused timeout'), 'ready');
});
test('deadline preserves the original failure', async () => {
  const original = new Error('synthetic failure');
  await assert.rejects(withDeadline(Promise.reject(original), 10000, 'unused timeout'), error => error === original);
});
test('deadline bounds hung diagnostics', async () => {
  await assert.rejects(withDeadline(new Promise(() => {}), 10, 'failure DOM snapshot'), /failure DOM snapshot exceeded 10ms/);
});
