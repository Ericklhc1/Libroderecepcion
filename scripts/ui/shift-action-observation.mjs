import assert from 'node:assert/strict';

export async function withDeadline(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// ActionForm emits this receipt from its async action wrapper after decoding
// the native ActionState. The surrounding Flight tree can keep streaming;
// response.finished() is not the boundary for the completed server action.
export async function waitForNativeShiftReceipt(page, attempt, expectedOk) {
  await withDeadline(page.waitForFunction(({ formId, offset }) => window.__shiftUxActionResults.slice(offset).some(receipt => receipt.formId === formId), attempt), 12000, 'native action receipt');
  const receipts = await withDeadline(page.evaluate(({ formId, offset }) => window.__shiftUxActionResults.slice(offset).filter(receipt => receipt.formId === formId), attempt), 2000, 'read native action receipt');
  assert.equal(receipts.length, 1, 'One decoded native outcome belongs to this exact form attempt');
  assert.equal(receipts[0].ok, expectedOk, 'HTTP 200 alone is not a successful action');
  return receipts[0];
}
