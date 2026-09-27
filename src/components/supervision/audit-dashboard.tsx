import type { Prisma } from '@prisma/client';
import { AlertTriangle, CheckCircle2, FileBarChart2 } from 'lucide-react';
import { Card, CardHeader, EmptyState, StatTile } from '@/components/ui/card';
import { Badge, Chip } from '@/components/ui/badge';
import { formatCalendarDate, formatDateTime } from '@/lib/format';
import { SupervisionAuditUpload } from './audit-upload';

type AuditImportRow = {
  id: string;
  businessDate: Date;
  reportKinds: string[];
  metrics: Prisma.JsonValue;
  checks: Prisma.JsonValue;
  findings: Prisma.JsonValue;
  warnings: string[];
  sourceFiles?: Prisma.JsonValue;
  updatedAt: Date;
  uploadedBy: { id: string; name: string };
};

type Check = {
  key: string;
  label: string;
  done: boolean | null;
  observation: string | null;
};

type Finding = {
  key: string;
  severity: 'BAJA' | 'MEDIA' | 'ALTA';
  title: string;
  detail: string;
};

function object(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return value && !Array.isArray(value) && typeof value === 'object'
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function section(metrics: Prisma.JsonValue, key: string): Record<string, Prisma.JsonValue> {
  return object(object(metrics)[key] ?? null);
}

function numberValue(value: Prisma.JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function checksOf(value: Prisma.JsonValue): Check[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Check =>
      Boolean(item) &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      typeof (item as Record<string, unknown>).key === 'string' &&
      typeof (item as Record<string, unknown>).label === 'string',
  );
}

function findingsOf(value: Prisma.JsonValue): Finding[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Finding =>
      Boolean(item) &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      typeof (item as Record<string, unknown>).key === 'string' &&
      typeof (item as Record<string, unknown>).title === 'string',
  );
}

function clp(value: number | null): string {
  return value === null ? '—' : `$ ${Math.round(value).toLocaleString('es-CL')}`;
}

function decimal(value: number | null, suffix = ''): string {
  return value === null ? '—' : `${value.toLocaleString('es-CL', { maximumFractionDigits: 2 })}${suffix}`;
}

const KIND_LABEL: Record<string, string> = {
  AUDITORIA_FORMULARIO: 'Formulario',
  COBROS: 'Cobros',
  VENTAS_CANAL: 'Ventas',
  PRODUCCION_HABITACION: 'Producción',
  SALIDAS: 'Salidas',
  REVENUE: 'Revenue',
  IN_HOUSE: 'In house',
  CARGOS_DIARIOS: 'Cargos',
  CIERRE_CAJA: 'Cierre de caja',
  DESCONOCIDO: 'No reconocido',
};

export function SupervisionAuditDashboard({
  rows,
  defaultBusinessDate,
  canUpload,
}: {
  rows: AuditImportRow[];
  defaultBusinessDate: string;
  canUpload: boolean;
}) {
  return (
    <section id="auditoria-diaria" className="scroll-mt-4 space-y-4">
      <Card>
        <CardHeader
          title="Auditoría diaria · informes PMS"
          action={<span className="text-xs text-slate-500">Los PDF no se conservan</span>}
        />
        <div className="px-4 py-4">
          {canUpload ? (
            <SupervisionAuditUpload defaultBusinessDate={defaultBusinessDate} />
          ) : (
            <p className="text-sm text-slate-600">
              Inicia tu turno de Supervisión para cargar los informes del día.
            </p>
          )}
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <div className="px-4 py-5">
            <EmptyState message="Todavía no hay datos de auditoría cargados en este turno de Supervisión." />
          </div>
        </Card>
      ) : (
        rows.map((row) => {
          const payments = section(row.metrics, 'payments');
          const departures = section(row.metrics, 'departures');
          const production = section(row.metrics, 'roomProduction');
          const sales = section(row.metrics, 'salesChannels');
          const revenue = section(row.metrics, 'revenue');
          const audit = section(row.metrics, 'audit');
          const auditActivity = section(row.metrics, 'auditActivity');
          const charges = section(row.metrics, 'dailyCharges');
          const checks = checksOf(row.checks);
          const findings = findingsOf(row.findings);
          const incomplete = checks.filter((check) => check.done !== true);
          const unknown = checks.filter((check) => check.done === null);
          const pointsToReview = findings.length + unknown.length;
          const sources = Array.isArray(row.sourceFiles) ? row.sourceFiles : [];

          const auditCompleted = numberValue(audit.completed);
          const auditControls = numberValue(audit.controls);
          const departuresPending = numberValue(departures.pending);
          const paymentClp = numberValue(payments.clpAmount);
          const productionRooms = numberValue(production.occupiedRoomsWithCost);
          const salesNet = numberValue(sales.netClp);
          const occupancy = numberValue(revenue.occupancyPct);
          const auditOccupancy = numberValue(auditActivity.occupancyPct);
          const noDailyCharges = charges.noData === true;

          return (
            <Card key={row.id}>
              <CardHeader
                title={`Auditoría · ${formatCalendarDate(row.businessDate)}`}
                action={
                  <span className="text-xs text-slate-500">
                    Actualizada {formatDateTime(row.updatedAt)} · {row.uploadedBy.name}
                  </span>
                }
              />
              <div className="space-y-4 px-4 py-4">
                <div className="flex flex-wrap gap-1.5">
                  {row.reportKinds.map((kind) => (
                    <Chip key={kind}>{KIND_LABEL[kind] ?? kind}</Chip>
                  ))}
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
                  <StatTile
                    label="Controles auditoría"
                    value={auditControls === null ? '—' : `${auditCompleted ?? 0}/${auditControls}`}
                    tone={
                      auditControls !== null &&
                      auditCompleted === auditControls &&
                      incomplete.length === 0
                        ? 'good'
                        : incomplete.length > 0
                          ? 'alert'
                          : 'neutral'
                    }
                  />
                  <StatTile
                    label="Puntos a revisar"
                    value={pointsToReview}
                    tone={pointsToReview > 0 ? 'alert' : checks.length > 0 ? 'good' : 'neutral'}
                  />
                  <StatTile
                    label="Check-out pendientes"
                    value={departuresPending ?? '—'}
                    tone={departuresPending ? 'alert' : departuresPending === 0 ? 'good' : 'neutral'}
                  />
                  <StatTile label="Cobros CLP" value={clp(paymentClp)} tone="neutral" />
                  <StatTile label="Hab. con producción" value={productionRooms ?? '—'} tone="neutral" />
                  <StatTile label="Venta neta canales" value={clp(salesNet)} tone="neutral" />
                  <StatTile label="OCC forecast" value={decimal(occupancy, '%')} tone="neutral" />
                  <StatTile label="OCC actividad" value={decimal(auditOccupancy, '%')} tone="neutral" />
                  <StatTile
                    label="Cargos diarios"
                    value={noDailyCharges ? 'Sin cargos' : charges.noData === false ? 'Con actividad' : '—'}
                    tone={noDailyCharges ? 'good' : 'neutral'}
                  />
                </div>

                {findings.length > 0 ? (
                  <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200">
                    <div className="flex items-center gap-2 border-b border-amber-200 px-3 py-2">
                      <AlertTriangle className="h-4 w-4 text-amber-700" aria-hidden="true" />
                      <p className="text-sm font-semibold text-amber-950">Requiere revisión de Supervisión</p>
                    </div>
                    <ul className="divide-y divide-amber-200/70">
                      {findings.map((finding) => (
                        <li key={finding.key} className="px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={finding.severity === 'ALTA' ? 'critico' : 'pendiente'}>{finding.severity.toLocaleLowerCase('es-CL')}</Badge>
                            <span className="text-sm font-medium text-amber-950">{finding.title}</span>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-amber-900">{finding.detail}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : checks.length > 0 && incomplete.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-3 text-sm text-emerald-900 ring-1 ring-emerald-200">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    Todos los controles reconocidos tienen respuesta y no se detectaron puntos de atención.
                  </div>
                ) : checks.length > 0 ? (
                  <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-3 text-sm text-amber-950 ring-1 ring-amber-200">
                    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    La auditoría todavía tiene controles sin respuesta reconocible. No se considera cerrada ni en verde.
                  </div>
                ) : null}

                {incomplete.length > 0 ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Controles no completados o sin respuesta</p>
                    <div className="grid gap-2 md:grid-cols-2">
                      {incomplete.map((check) => (
                        <div key={check.key} className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                          <p className="text-sm font-medium text-petrol-900">{check.label}</p>
                          <p className="mt-0.5 text-xs text-slate-600">
                            {check.done === false ? 'No realizado' : 'Sin respuesta reconocible'}
                            {check.observation ? ` · ${check.observation}` : ''}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {row.warnings.length > 0 ? (
                  <details className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                    <summary className="cursor-pointer text-sm font-medium text-slate-700">
                      {row.warnings.length} advertencia(s) de lectura
                    </summary>
                    <ul className="mt-2 space-y-1 text-xs text-slate-600">
                      {row.warnings.map((warning) => <li key={warning}>• {warning}</li>)}
                    </ul>
                  </details>
                ) : null}

                {sources.length > 0 ? (
                  <p className="text-xs text-slate-500">
                    Fuentes verificadas: {sources.length} archivo(s). Se conserva sólo su huella técnica,
                    tamaño, versión del lector y completitud; nunca el PDF ni el texto extraído.
                  </p>
                ) : null}

                <p className="flex items-center gap-1.5 text-xs text-slate-500">
                  <FileBarChart2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Sólo se conserva este resumen estructurado. Los PDF y el texto extraído no forman parte del historial.
                </p>
              </div>
            </Card>
          );
        })
      )}
    </section>
  );
}
