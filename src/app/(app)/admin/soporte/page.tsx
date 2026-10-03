import Link from 'next/link';
import { Bug, CheckCircle2, CircleDot, ExternalLink, Inbox, Lightbulb, Mail, Paperclip, Search } from 'lucide-react';
import { Prisma, SupportRequestKind, SupportRequestStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requirePagePermission } from '@/server/auth/guard';
import { hasTechnicalAdminAccess } from '@/lib/permissions';
import { Card, EmptyState, StatTile } from '@/components/ui/card';
import { ActionForm } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { updateSupportRequestAction } from '@/server/actions/support';
import { formatDateTime } from '@/lib/format';
import type { RawSearchParams } from '@/lib/search-params';

export const metadata = { title: 'Reportes y solicitudes' };
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<SupportRequestStatus, string> = {
  NUEVA: 'Nueva',
  EN_REVISION: 'En revisión',
  RESUELTA: 'Resuelta',
  DESCARTADA: 'Descartada',
};

const KIND_LABEL: Record<SupportRequestKind, string> = {
  ERROR: 'Problema',
  FUNCION: 'Solicitud de función',
};

const STATUS_CLASS: Record<SupportRequestStatus, string> = {
  NUEVA: 'bg-red-50 text-red-800 ring-red-200',
  EN_REVISION: 'bg-amber-50 text-amber-800 ring-amber-200',
  RESUELTA: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  DESCARTADA: 'bg-slate-100 text-slate-700 ring-slate-200',
};

function contextValue(context: Prisma.JsonValue, key: string): string | null {
  if (!context || Array.isArray(context) || typeof context !== 'object') return null;
  const value = (context as Record<string, Prisma.JsonValue>)[key];
  return typeof value === 'string' ? value : null;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function SupportInboxPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requirePagePermission('support.view');
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.trim() : '';
  const statusRaw = typeof params.estado === 'string' ? params.estado : '';
  const kindRaw = typeof params.tipo === 'string' ? params.tipo : '';

  const status = Object.values(SupportRequestStatus).includes(statusRaw as SupportRequestStatus)
    ? (statusRaw as SupportRequestStatus)
    : null;
  const kind = Object.values(SupportRequestKind).includes(kindRaw as SupportRequestKind)
    ? (kindRaw as SupportRequestKind)
    : null;

  const where = {
    ...(status ? { status } : {}),
    ...(kind ? { kind } : {}),
    ...(q
      ? {
          OR: [
            { subject: { contains: q, mode: Prisma.QueryMode.insensitive } },
            { description: { contains: q, mode: Prisma.QueryMode.insensitive } },
            { requesterName: { contains: q, mode: Prisma.QueryMode.insensitive } },
            { requesterUser: { contains: q, mode: Prisma.QueryMode.insensitive } },
            { correlationId: { contains: q, mode: Prisma.QueryMode.insensitive } },
          ],
        }
      : {}),
  } satisfies Prisma.SupportRequestWhereInput;

  const [rows, total, newCount, reviewCount] = await Promise.all([
    prisma.supportRequest.findMany({
      where,
      include: {
        requestedBy: { select: { id: true, active: true } },
        resolvedBy: { select: { name: true, username: true } },
        attachments: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 150,
    }),
    prisma.supportRequest.count(),
    prisma.supportRequest.count({ where: { status: SupportRequestStatus.NUEVA } }),
    prisma.supportRequest.count({ where: { status: SupportRequestStatus.EN_REVISION } }),
  ]);

  const canManage = user.permissions.includes('support.manage');
  const backHref = hasTechnicalAdminAccess(user.permissions) ? '/admin' : '/';

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-sm font-medium text-petrol-600 hover:underline"
      >
        ← {backHref === '/admin' ? 'Volver a Administración' : 'Volver al Inicio'}
      </Link>

      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-petrol-900">
          <Inbox className="h-5 w-5 text-petrol-600" aria-hidden="true" />
          Reportes y solicitudes
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Bandeja interna de AROH. Los envíos quedan registrados aquí aunque falle el correo de aviso.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Total" value={total} />
        <StatTile label="Nuevas" value={newCount} tone={newCount > 0 ? 'alert' : 'neutral'} />
        <StatTile label="En revisión" value={reviewCount} />
      </div>

      <Card collapsible>
        <form method="get" className="flex flex-wrap items-end gap-3 p-4">
          <label className="min-w-[16rem] flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-500">Buscar</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
              <input
                name="q"
                defaultValue={q}
                placeholder="Asunto, descripción, usuario o referencia…"
                className="input-base pl-9"
              />
            </div>
          </label>
          <label className="min-w-[10rem]">
            <span className="mb-1 block text-xs font-medium text-slate-500">Estado</span>
            <select name="estado" defaultValue={status ?? ''} className="input-base">
              <option value="">Todos</option>
              {Object.values(SupportRequestStatus).map((value) => (
                <option key={value} value={value}>{STATUS_LABEL[value]}</option>
              ))}
            </select>
          </label>
          <label className="min-w-[11rem]">
            <span className="mb-1 block text-xs font-medium text-slate-500">Tipo</span>
            <select name="tipo" defaultValue={kind ?? ''} className="input-base">
              <option value="">Todos</option>
              <option value={SupportRequestKind.ERROR}>Problemas</option>
              <option value={SupportRequestKind.FUNCION}>Solicitudes de función</option>
            </select>
          </label>
          <button className="rounded-lg bg-petrol-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-petrol-800">
            Filtrar
          </button>
          {(q || status || kind) ? (
            <Link href="/admin/soporte" className="rounded-lg px-3 py-2 text-sm font-medium text-petrol-700 hover:bg-petrol-50">
              Limpiar
            </Link>
          ) : null}
        </form>
      </Card>

      {rows.length === 0 ? (
        <Card collapsible>
          <EmptyState message="No hay reportes o solicitudes con estos filtros." />
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const route = contextValue(row.context, 'route');
            const hotelName = contextValue(row.context, 'hotelName');
            const version = contextValue(row.context, 'version');
            const viewport = contextValue(row.context, 'viewport');
            const userAgent = contextValue(row.context, 'userAgent');
            const archivedAttachmentNames = new Set(
              row.attachments.map((item) => item.fileName),
            );
            const fallbackAttachmentNames = row.attachmentNames.filter(
              (name) => !archivedAttachmentNames.has(name),
            );

            return (
              <Card collapsible key={row.id}>
                <div className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {row.kind === SupportRequestKind.ERROR ? (
                          <Bug className="h-4 w-4 text-red-600" aria-hidden="true" />
                        ) : (
                          <Lightbulb className="h-4 w-4 text-gold-600" aria-hidden="true" />
                        )}
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {KIND_LABEL[row.kind]}
                        </span>
                        <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ring-1 ${STATUS_CLASS[row.status]}`}>
                          {STATUS_LABEL[row.status]}
                        </span>
                      </div>
                      <h2 className="mt-1 text-base font-semibold text-petrol-900">{row.subject}</h2>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-slate-700">{row.description}</p>
                    </div>
                    <div className="shrink-0 text-right text-xs text-slate-500">
                      <p>{formatDateTime(row.createdAt)}</p>
                      <p className="mt-0.5 font-mono">{row.correlationId}</p>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 ring-1 ring-slate-200 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <p className="font-semibold text-slate-500">Solicitante</p>
                      <p className="mt-0.5 text-petrol-900">{row.requesterName}</p>
                      <p>@{row.requesterUser.replace(/^@/, '')} · {row.requesterRole}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-500">Contexto</p>
                      <p className="mt-0.5">{hotelName ?? 'Alojamiento no indicado'}</p>
                      <p>{route ?? 'Ruta no disponible'}{version ? ` · v${version}` : ''}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-500">Aviso por correo</p>
                      <p className="mt-0.5 flex items-center gap-1">
                        <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                        {row.emailSent ? 'Enviado' : 'No enviado'}
                      </p>
                      <p>{row.emailRecipient ?? 'Sin destinatario configurado'}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-500">Adjuntos</p>
                      {row.attachments.length > 0 ? (
                        <div className="mt-1 space-y-1">
                          {row.attachments.map((item) => (
                            <a
                              key={item.id}
                              href={`/api/soporte/adjuntos/${item.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="flex min-w-0 items-center gap-1.5 rounded-md bg-white px-2 py-1 text-petrol-700 ring-1 ring-slate-200 hover:bg-petrol-50"
                            >
                              <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              <span className="min-w-0 flex-1 truncate">
                                {item.kind === 'CAPTURA' ? 'Captura · ' : 'Archivo · '}
                                {item.fileName}
                              </span>
                              <span className="shrink-0 text-[10px] text-slate-500">{formatBytes(item.size)}</span>
                              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                            </a>
                          ))}
                          {fallbackAttachmentNames.length > 0 ? (
                            <p className="px-1 text-[10px] leading-4 text-amber-700">
                              Respaldo sólo por correo: {fallbackAttachmentNames.join(', ')}
                            </p>
                          ) : null}
                        </div>
                      ) : row.attachmentNames.length > 0 ? (
                        <p className="mt-0.5">
                          {row.attachmentNames.join(', ')}
                          <span className="block text-[10px] text-slate-400">Referencia histórica o respaldo por correo; archivo no archivado internamente.</span>
                        </p>
                      ) : (
                        <p className="mt-0.5">Sin adjuntos</p>
                      )}
                    </div>
                  </div>

                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-medium text-petrol-700">
                      Ver contexto técnico
                    </summary>
                    <div className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                      <p><strong>Ventana:</strong> {viewport ?? '—'}</p>
                      <p className="break-all"><strong>Navegador:</strong> {userAgent ?? '—'}</p>
                      {row.emailError ? (
                        <p className="sm:col-span-2 text-red-700"><strong>Error de correo:</strong> {row.emailError}</p>
                      ) : null}
                    </div>
                  </details>

                  {row.resolution ? (
                    <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900 ring-1 ring-emerald-200">
                      <p className="flex items-center gap-1.5 font-semibold">
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        Resolución
                      </p>
                      <p className="mt-1 whitespace-pre-wrap">{row.resolution}</p>
                      {row.resolvedAt ? (
                        <p className="mt-1 text-xs text-emerald-700">
                          {formatDateTime(row.resolvedAt)}
                          {row.resolvedBy ? ` · ${row.resolvedBy.name}` : ''}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {canManage ? (
                    <ActionForm
                      action={updateSupportRequestAction}
                      className="mt-3 grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end"
                      refreshOnSuccess
                    >
                      <input type="hidden" name="supportRequestId" value={row.id} />
                      <label>
                        <span className="mb-1 block text-xs font-medium text-slate-500">Estado</span>
                        <select name="status" defaultValue={row.status} className="input-base">
                          {Object.values(SupportRequestStatus).map((value) => (
                            <option key={value} value={value}>{STATUS_LABEL[value]}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className="mb-1 block text-xs font-medium text-slate-500">Resolución / nota</span>
                        <input
                          name="resolution"
                          defaultValue={row.resolution ?? ''}
                          maxLength={4000}
                          placeholder="Qué se hizo o por qué se descarta…"
                          className="input-base"
                        />
                      </label>
                      <SubmitButton pendingLabel="Guardando…">Guardar</SubmitButton>
                    </ActionForm>
                  ) : (
                    <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
                      <CircleDot className="h-3.5 w-3.5" aria-hidden="true" />
                      Acceso de solo lectura.
                    </p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
