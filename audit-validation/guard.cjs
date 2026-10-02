const { URL } = require('node:url');
for (const key of ['TEST_DATABASE_URL', 'DATABASE_URL', 'DIRECT_DATABASE_URL']) {
  const url = new URL(process.env[key] || '');
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '5432' || url.pathname !== '/aroh_audit_acceptance' || url.username !== 'audit' || process.env.AUDIT_LOCAL_DB_CONFIRM !== 'synthetic-only') throw new Error(`Unsafe synthetic connection: ${key}`);
}
if (process.env.CI !== 'true') throw new Error('Disposable CI runner required');
console.log('Verified: all connections explicitly point to the synthetic loopback database');
