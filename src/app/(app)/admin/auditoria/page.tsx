import Link from 'next/link';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { AuditAction } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { requirePagePermission } from '@/server/auth/guard';
import { prisma } from '@/lib/prisma';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
import { Chip } from '@/components/ui/badge';
import { AUDIT_ACTION_LABEL } from '@/domain/labels';
import { formatDateTime } from '@/lib/format';
import { pageHref, type RawSearchParams } from '@/lib/search-params';

export const metadata = { title: 'Auditoría' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

const ENTITIES = [
  'OperationalEntry',
  'Task',
  'FollowUp',
  'Alert',
  'Shift',
  'ShiftHandover',
  'User',
  'Role',
  'Department',
  'SystemSetting',
];

function value(input: Prisma.JsonValue | null): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'object') {
    return Object.entries(input as Record<string, unknown>)
      .map(([key, val]) => `${key}: ${val === null ? '—' : String(val)}`)
      .join(' · ');
  }
  return String(input);
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePagePermission('audit.view');
  const params = await searchParams;

  const page = Math.max(1, Number(params.pagina ?? '1') || 1);
  const accion = typeof params.accion === 'string' ? params.accion : undefined;
  const entidad = typeof params.entidad === 'string' ? params.entidad : undefined;
  const usuario = typeof params.usuario === 'string' ? params.usuario : undefined;
  const q = typeof params.q === 'string' ? params.q : undefined;

  const where: Prisma.AuditLogWhereInput = {
    ...(accion && accion in AuditAction ? { action: accion as AuditAction } : {}),
    ...(entidad ? { entity: entidad } : {}),
    ...(usuario ? { userId: usuario } : {}),
    ...(q
      ? {
          OR: [
            { summary: { contains: q, mode: 'insensitive' } },
            { entityId: { contains: q } },
            { reason: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [logs, total, users] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.auditLog.count({ where }),
    prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1 text-sm font-medium text-petrol-600 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Volver a Administración
      </Link>

      <header>
        <h1 className="text-xl font-semibold text-petrol-900">Auditoría</h1>
        <p className="mt-0.5 text-sm text-slate-600">
          Todo cambio relevante queda registrado con entidad, identificador, acción, usuario,
          fecha, valor anterior, valor nuevo y motivo.
        </p>
      </header>

      <form action="/admin/auditoria" className="card px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <label htmlFor="q" className="label-base">
              Buscar
            </label>
            <input id="q" name="q" type="search" defaultValue={q ?? ''} className="input-base" />
          </div>
          <div>
            <label htmlFor="accion" className="label-base">
              Acción
            </label>
            <select id="accion" name="accion" defaultValue={accion ?? ''} className="input-base">
              <option value="">Todas</option>
              {Object.values(AuditAction).map((action) => (
                <option key={action} value={action}>
                  {AUDIT_ACTION_LABEL[action]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="entidad" className="label-base">
              Entidad
            </label>
            <select id="entidad" name="entidad" defaultValue={entidad ?? ''} className="input-base">
              <option value="">Todas</option>
              {ENTITIES.map((entity) => (
                <option key={entity} value={entity}>
                  {entity}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="usuario" className="label-base">
              Usuario
            </label>
            <select id="usuario" name="usuario" defaultValue={usuario ?? ''} className="input-base">
              <option value="">Todos</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-lg bg-petrol-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-petrol-800"
          >
            Filtrar
          </button>
        </div>
      </form>

      <Card>
        <CardHeader title={`${total} evento(s)`} />
        {logs.length === 0 ? (
          <EmptyState message="Sin eventos para estos filtros." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {logs.map((log) => (
              <li key={log.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <time className="text-xs tabular text-slate-400">
                    {formatDateTime(log.createdAt)}
                  </time>
                  <Chip>{AUDIT_ACTION_LABEL[log.action]}</Chip>
                  <Chip>{log.entity}</Chip>
                  <span className="text-xs text-slate-500">{log.user?.name ?? 'Sistema'}</span>
                  {log.isDemo ? <Chip>Demo</Chip> : null}
                </div>
                <p className="mt-1 text-sm text-petrol-900">{log.summary}</p>
                {log.reason ? (
                  <p className="mt-0.5 text-xs text-slate-500">Motivo: {log.reason}</p>
                ) : null}
                {value(log.before) ? (
                  <p className="mt-0.5 text-xs text-slate-500">Antes: {value(log.before)}</p>
                ) : null}
                {value(log.after) ? (
                  <p className="mt-0.5 text-xs text-slate-500">Después: {value(log.after)}</p>
                ) : null}
                <p className="mt-0.5 text-[0.7rem] text-slate-400">
                  {log.entity}#{log.entityId}
                  {log.ip ? ` · IP ${log.ip}` : ''}
                  {log.sessionId ? ` · sesión ${log.sessionId.slice(0, 8)}…` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}

        <nav
          className="flex items-center justify-between border-t border-slate-200 px-4 py-3"
          aria-label="Paginación"
        >
          {page > 1 ? (
            <Link
              href={pageHref('/admin/auditoria', params, page - 1)}
              className="inline-flex items-center gap-1 text-sm font-medium text-petrol-700 hover:underline"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Anterior
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs text-slate-500">
            Página {page} de {pages}
          </span>
          {page < pages ? (
            <Link
              href={pageHref('/admin/auditoria', params, page + 1)}
              className="inline-flex items-center gap-1 text-sm font-medium text-petrol-700 hover:underline"
            >
              Siguiente
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </Card>
    </div>
  );
}
