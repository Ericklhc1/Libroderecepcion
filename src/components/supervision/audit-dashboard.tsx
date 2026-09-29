import type { Prisma } from '@prisma/client';
import { AlertTriangle, CheckCircle2, FileBarChart2 } from 'lucide-react';
import { Card, CardHeader, EmptyState, StatTile } from '@/components/ui/card';
import { Badge, Chip } from '@/components/ui/badge';
import { formatCalendarDate, formatDateTime } from '@/lib/format';
import {
  effectiveDeparturePending,
  parseSupervisionAuditReviewState,
  sourceDeparturePending,
  sourceDepartureTotal,
  unresolvedAuditChecks,
  unresolvedAuditFindings,
} from '@/domain/supervision-audit-review';
import { SupervisionAuditUpload } from './audit-upload';
import {
  AuditDeparturesDialog,
  AuditItemReviewDialog,
  ReopenAuditReviewForm,
  ResetAuditDeparturesForm,
} from './audit-review-actions';

type AuditImportRow = {
  id: string;
  businessDate: Date;
  reportKinds: string[];
  metrics: Prisma.JsonValue;
  checks: Prisma.JsonValue;
  findings: Prisma.JsonValue;
  warnings: string[];
  reviewState: Prisma.JsonValue;
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
  ACTIVIDAD: 'Actividad',
  ENTRADAS: 'Entradas',
  COBROS: 'Cobros',
  VENTAS_CANAL: 'Ventas canal · legado',
  VENTAS_PERIODO: 'Ventas período',
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
  canManage,
}: {
  rows: AuditImportRow[];
  defaultBusinessDate: string;
  canUpload: boolean;
  canManage: boolean;
}) {
  return (
    <section id="auditoria-diaria" className="scroll-mt-4 space-y-4">
      <Card>
        <CardHeader
          title="Auditoría diaria · informes PMS"
          action={<span className="text-xs text-slate-500">Evidencia fija · revisión operativa actualizable</span>}
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
          const production = section(row.metrics, 'roomProduction');
          const sales = section(row.metrics, 'salesChannels');
          const salesPeriod = section(row.metrics, 'salesPeriod');
          const salesPeriodTotals = object(salesPeriod.totals ?? null);
          const salesCostCenters = object(salesPeriodTotals.costCentersClp ?? null);
          const revenue = section(row.metrics, 'revenue');
          const audit = section(row.metrics, 'audit');
          const auditActivity = section(row.metrics, 'auditActivity');
          const charges = section(row.metrics, 'dailyCharges');
          const checks = checksOf(row.checks);
          const findings = findingsOf(row.findings);
          const review = parseSupervisionAuditReviewState(row.reviewState);
          const activeChecks = unresolvedAuditChecks(checks, review);
          const activeFindings = unresolvedAuditFindings(findings, checks, review);
          const activeStandaloneFindings = activeFindings.filter(
            (finding) => !finding.key.startsWith('check:'),
          );
          const reviewedChecks = checks.filter(
            (check) => check.done !== true && Boolean(review.checks[check.key]),
          );
          const reviewedFindings = findings.filter(
            (finding) =>
              !finding.key.startsWith('check:') &&
              Boolean(review.findings[finding.key]),
          );
          const sources = Array.isArray(row.sourceFiles) ? row.sourceFiles : [];

          const auditCompleted = numberValue(audit.completed);
          const auditControls = numberValue(audit.controls);
          const importedDeparturesPending = sourceDeparturePending(row.metrics);
          const currentDeparturesPending = effectiveDeparturePending(row.metrics, review);
          const departuresTotal = sourceDepartureTotal(row.metrics);
          const paymentClp = numberValue(payments.clpAmount);
          const productionRooms = numberValue(production.occupiedRoomsWithCost);
          const salesNet = numberValue(sales.netClp);
          const salesPeriodVisibleDays = numberValue(salesPeriod.visibleDays);
          const salesPeriodExpectedDays = numberValue(salesPeriod.expectedVisibleDays);
          const salesPeriodCourtesy = numberValue(salesPeriodTotals.courtesyRooms);
          const salesPeriodTruncated = salesPeriod.truncated === true;
          const occupancy = numberValue(revenue.occupancyPct);
          const auditOccupancy = numberValue(auditActivity.occupancyPct);
          const noDailyCharges = charges.noData === true;
          const operationalPending =
            activeChecks.length +
            activeStandaloneFindings.length +
            (currentDeparturesPending && currentDeparturesPending > 0 ? 1 : 0);
          const hasDepartureOverride = Boolean(review.metrics.departuresPending);

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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {row.reportKinds.map((kind) => (
                      <Chip key={kind}>{KIND_LABEL[kind] ?? kind}</Chip>
                    ))}
                  </div>
                  <Badge tone={operationalPending > 0 ? 'pendiente' : 'resuelto'}>
                    {operationalPending > 0
                      ? `${operationalPending} frente(s) activo(s)`
                      : 'Revisión operativa al día'}
                  </Badge>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
                  <StatTile
                    label="Controles del informe"
                    value={auditControls === null ? '—' : `${auditCompleted ?? 0}/${auditControls}`}
                    tone={activeChecks.length > 0 ? 'alert' : auditControls ? 'good' : 'neutral'}
                    hint={activeChecks.length > 0 ? `${activeChecks.length} aún requieren gestión` : undefined}
                  />
                  <StatTile
                    label="Frentes activos"
                    value={operationalPending}
                    tone={operationalPending > 0 ? 'alert' : 'good'}
                    hint="Lo que aún afecta tu cierre de Supervisión"
                  />
                  <StatTile
                    label="Check-out pendientes"
                    value={currentDeparturesPending ?? '—'}
                    tone={
                      currentDeparturesPending
                        ? 'alert'
                        : currentDeparturesPending === 0
                          ? 'good'
                          : 'neutral'
                    }
                    hint={
                      hasDepartureOverride && importedDeparturesPending !== null
                        ? `Informe original: ${importedDeparturesPending}`
                        : undefined
                    }
                  />
                  <StatTile label="Cobros CLP" value={clp(paymentClp)} tone="neutral" />
                  <StatTile label="Hab. con producción" value={productionRooms ?? '—'} tone="neutral" />
                  {salesPeriodVisibleDays !== null ? (
                    <>
                      <StatTile
                        label="Cortesías período"
                        value={salesPeriodCourtesy ?? 0}
                        tone={(salesPeriodCourtesy ?? 0) > 0 ? 'alert' : 'good'}
                        hint={(salesPeriodCourtesy ?? 0) > 0 ? 'Requiere autorización y revisión' : 'Sin cortesías detectadas'}
                      />
                      <StatTile
                        label="Cobertura ventas"
                        value={salesPeriodExpectedDays === null ? salesPeriodVisibleDays : `${salesPeriodVisibleDays}/${salesPeriodExpectedDays}`}
                        tone={salesPeriodTruncated ? 'alert' : 'good'}
                        hint={salesPeriodTruncated ? 'El PDF no contiene todos los días esperados' : 'Cobertura disponible'}
                      />
                    </>
                  ) : salesNet !== null ? (
                    <StatTile label="Venta neta canales · legado" value={clp(salesNet)} tone="neutral" />
                  ) : null}
                  <StatTile label="OCC forecast" value={decimal(occupancy, '%')} tone="neutral" />
                  <StatTile label="OCC actividad" value={decimal(auditOccupancy, '%')} tone="neutral" />
                  <StatTile
                    label="Cargos diarios"
                    value={noDailyCharges ? 'Sin cargos' : charges.noData === false ? 'Con actividad' : '—'}
                    tone={noDailyCharges ? 'good' : 'neutral'}
                  />
                </div>

                {salesPeriodVisibleDays !== null ? (
                  <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-petrol-900">Ventas por período · mes en curso</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          ${salesPeriodVisibleDays} día(s) legibles
                          {salesPeriodExpectedDays !== null ? ` de ${salesPeriodExpectedDays} esperados` : ''}
                          {typeof salesPeriod.visibleThrough === 'string' ? ` · hasta ${salesPeriod.visibleThrough}` : ''}.
                        </p>
                      </div>
                      <Badge tone={(salesPeriodCourtesy ?? 0) > 0 ? 'critico' : salesPeriodTruncated ? 'pendiente' : 'resuelto'}>
                        {(salesPeriodCourtesy ?? 0) > 0
                          ? `${salesPeriodCourtesy} cortesía(s)`
                          : salesPeriodTruncated
                            ? 'Cobertura parcial'
                            : 'Sin cortesías'}
                      </Badge>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {[
                        ['Alojamiento', salesCostCenters.alojamiento],
                        ['Spa', salesCostCenters.spa],
                        ['Multas', salesCostCenters.multas],
                        ['Multas fumar', salesCostCenters.multasFumar],
                        ['Multas blancos', salesCostCenters.multasBlancos],
                        ['Eventos', salesCostCenters.eventos],
                        ['Varios', salesCostCenters.varios],
                        ['Tasas', salesCostCenters.tasas],
                      ].map(([label, value]) => (
                        <div key={String(label)} className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
                          <p className="text-xs text-slate-500">{label}</p>
                          <p className="mt-0.5 text-sm font-semibold text-petrol-900">
                            {clp(numberValue(value as Prisma.JsonValue))}
                          </p>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      El Libro cruza estas cifras con inventario activo, auditoría, producción por habitación,
                      movimientos PMS, In House y multas por blancos registradas.
                    </p>
                  </div>
                ) : null}

                {importedDeparturesPending !== null ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-3 ring-1 ring-slate-200">
                    <div>
                      <p className="text-sm font-medium text-petrol-900">
                        Avance de check-outs · {currentDeparturesPending ?? importedDeparturesPending} pendiente(s)
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        El informe registró {importedDeparturesPending}
                        {departuresTotal !== null ? ` de ${departuresTotal} salidas` : ''}.
                        {review.metrics.departuresPending
                          ? ` Última actualización operativa: ${review.metrics.departuresPending.byName} · ${review.metrics.departuresPending.note}`
                          : ' Aún no hay ajuste operativo manual.'}
                      </p>
                    </div>
                    {canManage ? (
                      <div className="flex flex-wrap gap-2 no-print">
                        <AuditDeparturesDialog
                          auditImportId={row.id}
                          sourcePending={importedDeparturesPending}
                          currentPending={currentDeparturesPending ?? importedDeparturesPending}
                          total={departuresTotal}
                        />
                        {hasDepartureOverride ? <ResetAuditDeparturesForm auditImportId={row.id} /> : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {activeStandaloneFindings.length > 0 ? (
                  <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200">
                    <div className="flex items-center gap-2 border-b border-amber-200 px-3 py-2">
                      <AlertTriangle className="h-4 w-4 text-amber-700" aria-hidden="true" />
                      <p className="text-sm font-semibold text-amber-950">Hallazgos que aún requieren decisión</p>
                    </div>
                    <ul className="divide-y divide-amber-200/70">
                      {activeStandaloneFindings.map((finding) => (
                        <li key={finding.key} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge tone={finding.severity === 'ALTA' ? 'critico' : 'pendiente'}>
                                {finding.severity.toLocaleLowerCase('es-CL')}
                              </Badge>
                              <span className="text-sm font-medium text-amber-950">{finding.title}</span>
                            </div>
                            <p className="mt-1 text-xs leading-5 text-amber-900">{finding.detail}</p>
                          </div>
                          {canManage ? (
                            <AuditItemReviewDialog
                              auditImportId={row.id}
                              target="FINDING"
                              itemKey={finding.key}
                              label={finding.title}
                            />
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {activeChecks.length > 0 ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Controles pendientes de gestión
                    </p>
                    <div className="grid gap-2 md:grid-cols-2">
                      {activeChecks.map((check) => (
                        <div key={check.key} className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-petrol-900">{check.label}</p>
                              <p className="mt-0.5 text-xs text-slate-600">
                                {check.done === false ? 'No realizado en el informe' : 'Sin respuesta reconocible'}
                                {check.observation ? ` · ${check.observation}` : ''}
                              </p>
                            </div>
                            {canManage ? (
                              <AuditItemReviewDialog
                                auditImportId={row.id}
                                target="CHECK"
                                itemKey={check.key}
                                label={check.label}
                              />
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : checks.length > 0 ? (
                  <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-3 text-sm text-emerald-900 ring-1 ring-emerald-200">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    No quedan controles del formulario pendientes de gestión.
                  </div>
                ) : null}

                {reviewedChecks.length + reviewedFindings.length > 0 ? (
                  <details className="rounded-lg bg-emerald-50/60 px-3 py-2 ring-1 ring-emerald-200">
                    <summary className="cursor-pointer text-sm font-medium text-emerald-900">
                      {reviewedChecks.length + reviewedFindings.length} punto(s) resuelto(s) o retirado(s)
                    </summary>
                    <ul className="mt-2 divide-y divide-emerald-200/70">
                      {reviewedChecks.map((check) => {
                        const decision = review.checks[check.key]!;
                        return (
                          <li key={`check-${check.key}`} className="flex flex-wrap items-center justify-between gap-3 py-2">
                            <div>
                              <p className="text-sm font-medium text-emerald-950">{check.label}</p>
                              <p className="text-xs text-emerald-800">
                                {decision.status === 'NO_APLICA' ? 'No aplica' : 'Resuelto'} · {decision.byName}
                                {decision.note ? ` · ${decision.note}` : ''}
                              </p>
                            </div>
                            {canManage ? (
                              <ReopenAuditReviewForm
                                auditImportId={row.id}
                                target="CHECK"
                                itemKey={check.key}
                              />
                            ) : null}
                          </li>
                        );
                      })}
                      {reviewedFindings.map((finding) => {
                        const decision = review.findings[finding.key]!;
                        return (
                          <li key={`finding-${finding.key}`} className="flex flex-wrap items-center justify-between gap-3 py-2">
                            <div>
                              <p className="text-sm font-medium text-emerald-950">{finding.title}</p>
                              <p className="text-xs text-emerald-800">
                                {decision.status === 'NO_APLICA' ? 'No aplica' : 'Resuelto'} · {decision.byName}
                                {decision.note ? ` · ${decision.note}` : ''}
                              </p>
                            </div>
                            {canManage ? (
                              <ReopenAuditReviewForm
                                auditImportId={row.id}
                                target="FINDING"
                                itemKey={finding.key}
                              />
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </details>
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
                  El informe importado queda como evidencia; resolver, retirar o ajustar un punto sólo actualiza el estado operativo auditado del turno.
                </p>
              </div>
            </Card>
          );
        })
      )}
    </section>
  );
}
