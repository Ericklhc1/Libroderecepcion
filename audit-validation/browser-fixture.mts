import './guard.cjs';
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { SignJWT } from 'jose';
import { seedCatalog } from '../src/domain/catalog';
import { ROLE_KEYS } from '../src/lib/permissions';
import { TERMS_DOCUMENT, TERMS_VERSION } from '../src/domain/legal';
const db = new PrismaClient();
await seedCatalog(db);
const users: Record<string, { id: string; token: string }> = {};
for (const [name, roleKey] of Object.entries({ A: ROLE_KEYS.SUPERVISOR, B: ROLE_KEYS.RECEPTIONIST, supervisor: ROLE_KEYS.SUPERVISOR, admin: ROLE_KEYS.SYSTEM_ADMIN })) {
  const role = await db.role.findUniqueOrThrow({ where: { key: roleKey } });
  const user = await db.user.create({ data: { username: `browser_${name}`, name: `Synthetic ${name}`, roleId: role.id, passwordHash: 'synthetic-no-password-login', mustChangePassword: false } });
  await db.legalAcceptance.create({ data: { userId: user.id, document: TERMS_DOCUMENT, version: TERMS_VERSION } });
  const expiresAt = new Date(Date.now() + 3600000);
  const session = await db.session.create({ data: { userId: user.id, expiresAt } });
  const token = await new SignJWT({ sub: user.id, sid: session.id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(Math.floor(expiresAt.getTime()/1000)).sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  users[name] = { id: user.id, token };
}
const entry = await db.operationalEntry.create({ data: { type: 'NOVEDAD', title: 'Synthetic browser parent', description: 'Synthetic context only', createdById: users.B.id } });
const definitions = [
  { action: 'BROWSER_PRIVATE_A', createdById: users.A.id, ownerId: users.B.id, visibility: 'PRIVADO' as const },
  { action: 'BROWSER_PRIVATE_B', createdById: users.B.id, ownerId: users.A.id, visibility: 'PRIVADO' as const },
  { action: 'BROWSER_RESERVED', createdById: users.A.id, ownerId: users.B.id, visibility: 'SUPERVISION' as const },
  { action: 'BROWSER_OPERATIVE', createdById: users.A.id, ownerId: users.B.id, visibility: 'OPERATIVO' as const },
  { action: 'BROWSER_FOREIGN', createdById: users.supervisor.id, ownerId: users.supervisor.id, visibility: 'OPERATIVO' as const },
  { action: 'BROWSER_DELETED', createdById: users.A.id, ownerId: users.A.id, visibility: 'PRIVADO' as const, deletedAt: new Date() },
];
const rows = [];
for (const definition of definitions) rows.push(await db.followUp.create({ data: { ...definition, entryId: entry.id, nextAction: `SUMMARY_${definition.action}` } }));
for (const [name, user] of Object.entries(users)) {
  for (const row of rows) await db.notification.create({ data: { userId: user.id, type: 'MENCION', entity: 'FollowUp', entityId: row.id, title: row.action, body: `SUMMARY_${row.action}` } });
  for (const width of [1280, 390]) await db.pushSubscription.create({ data: { userId: user.id, endpoint: `https://synthetic.invalid/${name}/${width}`, createdAt: new Date(0) } });
}
writeFileSync('/tmp/browser-fixtures.json', JSON.stringify({ users, rows: rows.map(row => ({ id: row.id, action: row.action })), entryId: entry.id }));
await db.$disconnect();
console.log('Synthetic browser fixtures and short-lived sessions prepared; no credentials printed');
