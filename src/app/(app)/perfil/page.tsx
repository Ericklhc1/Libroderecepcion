import Link from 'next/link';
import { KeyRound, ShieldCheck, UserRound } from 'lucide-react';
import { requirePageUser } from '@/server/auth/guard';
import { prisma } from '@/lib/prisma';
import { Card, CardHeader } from '@/components/ui/card';
import { Chip } from '@/components/ui/badge';
import { PERMISSIONS } from '@/lib/permissions';
import { formatDateTime } from '@/lib/format';

export const metadata = { title: 'Mi perfil' };
export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const user = await requirePageUser();

  const [record, sessions] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { department: { select: { name: true } }, role: true },
    }),
    prisma.session.findMany({
      where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  const groups = new Map<string, string[]>();
  for (const key of user.permissions) {
    const meta = PERMISSIONS[key];
    if (!meta) continue;
    const list = groups.get(meta.group) ?? [];
    list.push(meta.name);
    groups.set(meta.group, list);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-petrol-900">
          <UserRound className="h-5 w-5 text-petrol-600" aria-hidden="true" />
          Mi perfil
        </h1>
      </header>

      <Card>
        <CardHeader title="Datos de la cuenta" />
        <dl className="grid gap-x-6 gap-y-3 px-4 py-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-slate-500">Nombre</dt>
            <dd className="text-petrol-900">{record.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Correo</dt>
            <dd className="text-petrol-900">{record.email}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Rol</dt>
            <dd className="text-petrol-900">{record.role.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Área</dt>
            <dd className="text-petrol-900">{record.department?.name ?? 'Sin área'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Último ingreso</dt>
            <dd className="text-petrol-900">{formatDateTime(record.lastLoginAt)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">
              Participa en turnos
            </dt>
            <dd className="text-petrol-900">
              {record.role.operational
                ? 'Sí'
                : 'No (rol fuera de la operación habitual)'}
            </dd>
          </div>
        </dl>
        <div className="border-t border-slate-200 px-4 py-3">
          <Link
            href="/cambiar-contrasena"
            className="inline-flex items-center gap-2 rounded-lg bg-petrol-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-petrol-800"
          >
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            Cambiar contraseña
          </Link>
        </div>
      </Card>

      <Card>
        <CardHeader title="Permisos de mi rol" count={user.permissions.length} />
        <div className="space-y-3 px-4 py-4">
          {Array.from(groups.entries()).map(([group, names]) => (
            <div key={group}>
              <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                {group}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {names.map((name) => (
                  <Chip key={name}>{name}</Chip>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Sesiones activas" count={sessions.length} />
        <ul className="divide-y divide-slate-100">
          {sessions.map((session) => (
            <li key={session.id} className="px-4 py-2.5 text-sm">
              <p className="text-petrol-900">
                {session.id === user.sessionId ? 'Esta sesión' : 'Otra sesión'} · inició{' '}
                {formatDateTime(session.createdAt)}
              </p>
              <p className="text-xs text-slate-500">
                Expira {formatDateTime(session.expiresAt)}
                {session.ip ? ` · IP ${session.ip}` : ''}
              </p>
            </li>
          ))}
        </ul>
        <p className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
          Al cambiar tu contraseña se cierran todas las demás sesiones.
        </p>
      </Card>
    </div>
  );
}
