import assert from 'node:assert/strict';

/** This destructive QA harness is restricted to its disposable loopback database. */
export function assertClosureQaEnvironment() {
  assert.equal(process.env.CLOSURE_QA, 'synthetic', 'Explicit synthetic closure QA opt-in required');
  const urls = Object.fromEntries(['DATABASE_URL', 'DIRECT_DATABASE_URL', 'TEST_DATABASE_URL'].map(key => {
    const url = new URL(process.env[key] || '');
    assert.equal(url.protocol, 'postgresql:', `${key} must use PostgreSQL`);
    assert.equal(url.hostname, '127.0.0.1', `${key} must use loopback`);
    assert.equal(url.port, '55432', `${key} must use the disposable QA container`);
    assert.equal(url.username, 'libro', `${key} must use the synthetic account`);
    return [key, url];
  }));
  assert.equal(urls.DATABASE_URL.pathname, '/libro_dev');
  assert.equal(urls.DIRECT_DATABASE_URL.pathname, '/libro_dev');
  assert.equal(urls.TEST_DATABASE_URL.pathname, '/libro_test');
  assert.notEqual(urls.DATABASE_URL.pathname, urls.TEST_DATABASE_URL.pathname, 'Browser data must be separate from Vitest');
  assert.ok((process.env.AUTH_SECRET || '').length >= 32, 'Synthetic session key required');
  for (const key of ['SMTP_HOST', 'RESEND_API_KEY', 'SENDGRID_API_KEY']) assert.equal(Boolean(process.env[key]), false, 'External mail transport forbidden');
}
