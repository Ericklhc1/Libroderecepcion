import type { Prisma } from '@prisma/client';
import { formatDateTime } from '@/lib/format';

const LABELS: Record<string, string> = {
  tasks: 'Tareas', followUps: 'Seguimientos', audits: 'Auditorías', auditImports: 'Auditoría diaria',
  correctiveMeasures: 'Medidas correctivas', decisions: 'Decisiones registradas', work: 'Trabajos', loans: 'Llaves en custodia',
  title: 'Asunto', action: 'Acción', description: 'Descripción', note: 'Comentario', body: 'Texto',
  status: 'Estado', priority: 'Prioridad', resolution: 'Resultado', blockReason: 'Impedimento',
  assignee: 'Responsable', assignedTo: 'Responsable', owner: 'Responsable', name: 'Nombre',
  humanId: 'Folio', dueAt: 'Plazo', scheduledAt: 'Programado', createdAt: 'Registrado', finishedAt: 'Finalizado',
  checks: 'Controles', findings: 'Hallazgos', warnings: 'Observaciones', reviewState: 'Revisión',
  templateName: 'Auditoría', summary: 'Resumen', businessDate: 'Día operativo', reportKinds: 'Informes',
  location: 'Ubicación', collaboratorName: 'Persona a cargo', items: 'Elementos', keyCode: 'Llave', destinationName: 'Destino',
  shift: 'Turno', startedAt: 'Iniciado', supervisor: 'Supervisión', priorities: 'Prioridades', openingCompletedAt: 'Apertura confirmada',
  capturedAt: 'Copia conservada', entity: 'Registro', severity: 'Gravedad', _count: 'Cantidad', metrics: 'Resultados',
  label: 'Control', done: 'Verificado', observation: 'Observación', detail: 'Detalle', result: 'Resultado',
  checkedAt: 'Revisado', reviewedAt: 'Revisado', updatedAt: 'Actualizado', updatedBy: 'Revisado por',
};
const INTERNAL_FIELDS = new Set(['id', 'version', 'entityId', 'taskId', 'entryId', 'supervisionShiftId', 'openingState', 'sourceFiles']);

/** Read-only rendering of the native evidence. Text is never shortened. */
export function ClosureEvidence({ value }: { value: Prisma.JsonValue | Prisma.InputJsonValue }) {
  if (value === null) return <span>Sin dato registrado</span>;
  if (typeof value === 'boolean') return <span>{value ? 'Sí' : 'No'}</span>;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value) && !Number.isNaN(Date.parse(value))) return <span>{formatDateTime(value)}</span>;
  if (typeof value !== 'object') return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
  if (Array.isArray(value)) return value.length ? <ul className="space-y-3">{value.map((item, index) => <li key={index} className="border-l border-slate-200 pl-3"><ClosureEvidence value={item as Prisma.JsonValue} /></li>)}</ul> : <span>Sin registros</span>;
  return <dl className="space-y-2">{Object.entries(value).filter(([key, item]) => !INTERNAL_FIELDS.has(key) && item !== undefined).map(([key, item]) => <div key={key} className="min-w-0">
    <dt className="font-medium text-slate-700">{LABELS[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2')}</dt>
    <dd className="mt-0.5 text-slate-600"><ClosureEvidence value={item as Prisma.JsonValue} /></dd>
  </div>)}</dl>;
}
