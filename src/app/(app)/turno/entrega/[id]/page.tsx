import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CashCountKind, HandoverLevel, HandoverStatus, ShiftStatus } from '@prisma/client';
import { ArrowLeft, CheckCircle2, Clock, User } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { requirePageUser } from '@/server/auth/guard';
import { getHistory } from '@/server/services/history';
import { Badge, Chip } from '@/components/ui/badge';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
import { CashBox } from '@/components/operational/cash-box';
import { getHandoverCashState, listDenominations } from '@/server/services/cash';
import { getShiftCashClosure } from '@/server/services/cash-closure';
import { Comments } from '@/components/operational/comments';
import { HistoryTimeline } from '@/components/operational/history-timeline';
import {
  CancelPreparationForm,
  CloseShiftForm,
  ConfirmHandoverReviewStepForm,
  ReceiveHandoverForm,
  SendHandoverForm,
} from '@/components/operational/shift-actions';
import {
  AddHandoverNoteForm,
  PrintButton,
  RegenerateSummaryForm,
  RemoveHandoverNoteForm,
} from '@/components/operational/handover-notes';
import {
  HANDOVER_LEVEL_LABEL,
  HANDOVER_LEVEL_TONE,
  HANDOVER_STATUS_LABEL,
  HANDOVER_STATUS_TONE,
} from '@/domain/labels';
import { SHIFT_TYPE_LABEL } from '@/domain/shift';
import { addCalendarDateDays } from '@/domain/time';
import { formatCalendarDate, formatDateTime, relativeTime } from '@/lib/format';
import { isReceptionDeskRole } from '@/lib/permissions';

export const metadata = { title: 'Entrega de turno' };
export const dynamic = 'force-dynamic';

const LEVEL_ORDER: HandoverLevel[] = [
  HandoverLevel.URGENTE,
  HandoverLevel.IMPORTANTE,
  HandoverLevel.INFORMATIVO,
];

export default async function HandoverPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ paso?: string; recepcion?: string }>;
}) {
  const user = await requirePageUser();
  const { id } = await params;
  const query = await searchParams;

  const handover = await prisma.shiftHandover.findUnique({
    where: { id },
    include: {
      issuedBy: { select: { id: true, name: true } },
      receivedBy: { select: { id: true, name: true } },
      fromShift: {
        include: { assignments: { include: { user: { select: { id: true, name: true } } } } },
      },
      toShift: {
        include: { assignments: { include: { user: { select: { id: true, name: true } } } } },
      },
      items: { orderBy: [{ level: 'asc' }, { order: 'asc' }] },
      _count: { select: { comments: true } },
    },
  });
  if (!handover) notFound();

  const [history, cashState, denominations, formalCashClosure, closureValidation] = await Promise.all([
    getHistory({ entity: 'ShiftHandover', entityId: handover.id }),
    getHandoverCashState(handover.id),
    listDenominations(),
    getShiftCashClosure(handover.fromShiftId),
    prisma.alert.findUnique({
      where: { dedupeKey: `shift-validation:${handover.fromShiftId}` },
      select: {
        status: true,
        resolvedAt: true,
        resolvedBy: { select: { name: true } },
      },
    }),
  ]);

  const isIssuer = handover.fromShift.assignments.some((a) => a.userId === user.id);
  const linkedReceiver = handover.toShift?.assignments.some((a) => a.userId === user.id) ?? false;
  const emergencyReceiver =
    !handover.toShiftId && handover.status === HandoverStatus.ENVIADA
      ? await prisma.shift.findFirst({
          where: {
            archivedAt: null,
            emergency: true,
            emergencySourceShiftId: handover.fromShiftId,
            status: { in: [ShiftStatus.INICIADO, ShiftStatus.ACTIVO] },
            assignments: {
              some: {
                userId: user.id,
                activatedAt: { not: null },
                leftAt: null,
              },
            },
          },
          select: { id: true },
          orderBy: { actualStart: 'desc' },
        })
      : null;
  const canReceive = Boolean(
    handover.status === HandoverStatus.ENVIADA &&
      handover.fromShift.status === ShiftStatus.CERRADO &&
      !isIssuer &&
      user.permissions.includes('shift.receive') &&
      (linkedReceiver || emergencyReceiver),
  );
  const isReceiver =
    linkedReceiver ||
    handover.receivedBy?.id === user.id ||
    Boolean(emergencyReceiver);
  const isDraft = handover.status === HandoverStatus.BORRADOR;
  const canEdit = isDraft && isIssuer && user.permissions.includes('shift.handover');
  const canFinalizeClose = Boolean(
    isIssuer &&
      handover.status === HandoverStatus.ENVIADA &&
      handover.fromShift.status === ShiftStatus.ENTREGA_ENVIADA,
  );
  const requestedCloseStep = Number(query.paso ?? '1');

  /*
    Recepción guiada: el turno entrante ya existe en INICIADO y esta entrega
    está vinculada a él. Los pasos de revisión son navegación; las barreras
    reales siguen en servidor: arqueo confirmado + custodia física confirmada
    antes de receiveHandover(), que activa el turno atómicamente.
  */
  const cashRole: 'emisor' | 'receptor' | 'lector' = canEdit
    ? 'emisor'
    : canReceive
      ? 'receptor'
      : 'lector';
  const cashReady = !cashState.enabled || Boolean(cashState.confirmed);
  const custodyPending = cashState.elements.filter(
    (element) => element.declared && !element.confirmed,
  );
  const custodyReady = custodyPending.length === 0;
  const requestedReceptionStep = Number(query.recepcion ?? '1');
  const validReceptionStep =
    Number.isInteger(requestedReceptionStep) &&
    requestedReceptionStep >= 1 &&
    requestedReceptionStep <= 5
      ? requestedReceptionStep
      : 1;
  const maxReceptionStep = !cashReady ? 2 : !custodyReady ? 3 : 5;
  const receptionStep = canReceive
    ? Math.min(validReceptionStep, maxReceptionStep)
    : null;

  // Rellena el formulario con lo que ya contó este rol, para no empezar de cero.
  const ownCount =
    cashRole === 'lector'
      ? null
      : await prisma.cashCount.findUnique({
          where: {
            handoverId_kind: {
              handoverId: handover.id,
              kind: cashRole === 'emisor' ? CashCountKind.DECLARADO : CashCountKind.CONFIRMADO,
            },
          },
          include: { lines: { select: { denominationId: true, quantity: true } } },
        });
  const previousQuantities = Object.fromEntries(
    (ownCount?.lines ?? []).map((line) => [line.denominationId, line.quantity]),
  );

  const grouped = LEVEL_ORDER.map((level) => ({
    level,
    items: handover.items.filter((item) => item.level === level),
  })).filter((group) => group.items.length > 0);

  const counts = {
    urgente: handover.items.filter((i) => i.level === HandoverLevel.URGENTE).length,
    importante: handover.items.filter((i) => i.level === HandoverLevel.IMPORTANTE).length,
    informativo: handover.items.filter((i) => i.level === HandoverLevel.INFORMATIVO).length,
  };

  const cashClosed = Boolean(formalCashClosure && !formalCashClosure.reopenedAt);
  const requiredElementsMissing = cashState.elements.filter(
    (element) => element.required && !element.declared && !element.notes?.trim(),
  );
  const closeStepOneReady =
    !cashState.enabled || (cashClosed && requiredElementsMissing.length === 0);
  const requestedValidStep =
    Number.isInteger(requestedCloseStep) && requestedCloseStep >= 1 && requestedCloseStep <= 4
      ? requestedCloseStep
      : 1;
  const maxAllowedCloseStep = !closeStepOneReady
    ? 1
    : !handover.pendingsReviewedAt
      ? 2
      : !handover.finalReviewAt
        ? 3
        : 4;
  // La URL sólo permite volver a pasos ya alcanzados; nunca adelantar el cierre.
  const closeStep = Math.min(requestedValidStep, maxAllowedCloseStep);
  const closeSteps = [
    { number: 1, label: 'Caja y custodia' },
    { number: 2, label: 'Pendientes' },
    { number: 3, label: 'Revisión final' },
    { number: 4, label: 'Enviar entrega' },
  ] as const;
  const closeStepDone = (step: number) =>
    step === 1
      ? closeStepOneReady
      : step === 2
        ? Boolean(handover.pendingsReviewedAt)
        : step === 3
          ? Boolean(handover.finalReviewAt)
          : handover.status !== HandoverStatus.BORRADOR;


  /*
    `Shift.date` es una fecha calendario (`@db.Date`). No se debe formatear
    con la zona horaria del hotel porque eso la desplaza al día anterior en
    Santiago. Para NOCHE, la entrega explicita además la transición al día
    siguiente: 22/09/2026 al 23/09/2026.
  */
  const shiftStartDate = handover.fromShift.date;
  const shiftPeriod =
    handover.fromShift.type === 'NOCHE'
      ? `${formatCalendarDate(shiftStartDate)} al ${formatCalendarDate(addCalendarDateDays(shiftStartDate, 1))}`
      : formatCalendarDate(shiftStartDate);
  const shiftParticipants =
    new Intl.ListFormat('es-CL', { style: 'long', type: 'conjunction' }).format(
      handover.fromShift.assignments.map((assignment) => assignment.user.name),
    ) || handover.issuedBy.name;
  const shiftTypeTitle = SHIFT_TYPE_LABEL[handover.fromShift.type].toUpperCase();

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 no-print">
        <Link
          href="/turno"
          className="inline-flex items-center gap-1 text-sm font-medium text-petrol-600 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Volver al turno
        </Link>
        {handover.status === HandoverStatus.RECIBIDA ? (
          <PrintButton label="Imprimir informe Caja entrega/recepción" />
        ) : (
          <span className="text-xs font-medium text-slate-500">
            El acta final se imprime después de que el entrante recuente Caja y confirme la recepción.
          </span>
        )}
      </div>

      <Card>
        <div className="px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={HANDOVER_STATUS_TONE[handover.status]}>
                  {HANDOVER_STATUS_LABEL[handover.status]}
                </Badge>
                {handover.toShift ? (
                  <Chip>
                    → Turno {SHIFT_TYPE_LABEL[handover.toShift.type]} ·{' '}
                    {formatCalendarDate(handover.toShift.date)}
                  </Chip>
                ) : handover.status === HandoverStatus.RECIBIDA ? (
                  <Chip>Recibida · pendiente de enlazar al siguiente turno</Chip>
                ) : (
                  <Chip>En bandeja · sin receptor confirmado</Chip>
                )}
              </div>
              <h1 className="mt-2 text-xl font-semibold text-petrol-900">
                Entrega de turno {shiftTypeTitle} · {shiftPeriod} · por {shiftParticipants}
              </h1>
              <dl className="mt-2 space-y-1 text-sm text-slate-600">
                <div className="flex items-center gap-2">
                  <User className="h-3.5 w-3.5" aria-hidden="true" />
                  <dt className="sr-only">Emitida por</dt>
                  <dd>
                    Emitida por {handover.issuedBy.name}
                    {handover.issuedAt ? ` · ${formatDateTime(handover.issuedAt)}` : ' · sin enviar'}
                  </dd>
                </div>
                {handover.receivedBy ? (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                    <dt className="sr-only">Recibida por</dt>
                    <dd>
                      Recibida por {handover.receivedBy.name} ·{' '}
                      {formatDateTime(handover.receivedAt)}
                    </dd>
                  </div>
                ) : handover.status === HandoverStatus.ENVIADA ? (
                  <div className="flex items-center gap-2 text-orange-700">
                    <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    <dd>
                      Pendiente de confirmación
                      {handover.issuedAt ? ` desde ${relativeTime(handover.issuedAt)}` : ''}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>

            <div className="flex flex-wrap gap-2 text-center">
              <div className="rounded-lg bg-red-50 px-3 py-2 ring-1 ring-red-200">
                <p className="text-lg font-semibold tabular text-red-700">{counts.urgente}</p>
                <p className="text-[0.65rem] font-medium text-red-700">Urgente</p>
              </div>
              <div className="rounded-lg bg-orange-50 px-3 py-2 ring-1 ring-orange-200">
                <p className="text-lg font-semibold tabular text-orange-700">{counts.importante}</p>
                <p className="text-[0.65rem] font-medium text-orange-700">Importante</p>
              </div>
              <div className="rounded-lg bg-slate-100 px-3 py-2 ring-1 ring-slate-200">
                <p className="text-lg font-semibold tabular text-slate-700">{counts.informativo}</p>
                <p className="text-[0.65rem] font-medium text-slate-600">Informativo</p>
              </div>
            </div>
          </div>

          {handover.notes ? (
            <div className="mt-4 rounded-lg bg-gold-50 px-3 py-3 ring-1 ring-gold-200">
              <p className="text-xs font-semibold text-gold-800">
                Nota del turno saliente
              </p>
              <p className="mt-1 whitespace-pre-line text-sm text-petrol-900">{handover.notes}</p>
            </div>
          ) : null}

          {handover.receiverObservations ? (
            <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-3 ring-1 ring-emerald-200">
              <p className="text-xs font-semibold text-emerald-800">
                Observaciones de recepción
              </p>
              <p className="mt-1 whitespace-pre-line text-sm text-petrol-900">
                {handover.receiverObservations}
              </p>
            </div>
          ) : null}
        </div>

        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-3 no-print">
            <RegenerateSummaryForm shiftId={handover.fromShiftId} />
            <span className="text-xs text-slate-500">
              El resumen se regenera con el estado actual; tus notas manuales se conservan.
            </span>
          </div>
        ) : null}
      </Card>

      {canEdit ? (
        <Card className="no-print">
          <CardHeader
            title={`Cierre guiado · paso ${closeStep} de 4`}
            action={<CancelPreparationForm shiftId={handover.fromShiftId} />}
          />
          <div className="space-y-4 px-4 py-4">
            <div className="grid gap-2 sm:grid-cols-4">
              {closeSteps.map((step) => {
                const done = closeStepDone(step.number);
                const current = step.number === closeStep;
                const reachable = step.number <= maxAllowedCloseStep;
                const className = `rounded-lg px-3 py-2 text-xs ring-1 transition-colors ${
                  current
                    ? 'bg-gold-50 font-semibold text-petrol-950 ring-gold-300'
                    : done
                      ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                      : 'bg-slate-50 text-slate-500 ring-slate-200'
                }`;
                return reachable ? (
                  <Link
                    key={step.number}
                    href={`/turno/entrega/${handover.id}?paso=${step.number}`}
                    className={`${className} hover:bg-slate-100`}
                  >
                    {done ? '✓' : step.number} · {step.label}
                  </Link>
                ) : (
                  <div key={step.number} className={className} aria-disabled="true">
                    {step.number} · {step.label}
                  </div>
                );
              })}
            </div>
            <div>
              <p className="font-semibold text-petrol-950">
                {closeStep === 1
                  ? 'Caja, garantías y elementos bajo custodia'
                  : closeStep === 2
                    ? 'Novedades y pendientes que continúan'
                    : closeStep === 3
                      ? 'Revisa exactamente qué vas a entregar'
                      : 'Confirma el envío de la entrega'}
              </p>
              <p className="mt-1 text-sm leading-5 text-slate-600">
                {closeStep === 1
                  ? 'Arquea el fondo fijo, valida físicamente las garantías y declara los elementos que viajan con la Caja. Cierra Caja antes de continuar.'
                  : closeStep === 2
                    ? 'El Libro ya reunió los asuntos vigentes. Revisa, abre el registro original si hace falta y agrega sólo una nota manual que realmente deba viajar.'
                    : closeStep === 3
                      ? 'Comprueba Caja, custodia y el resumen operativo. Todavía puedes volver a cualquier paso o cancelar el cierre.'
                      : 'Éste es el punto de no retorno del cierre normal. El sistema volverá a pedir una confirmación explícita antes de enviar.'}
              </p>
            </div>
            {closeStep === 1 && !closeStepOneReady ? (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
                Completa el arqueo, valida las garantías, resuelve los elementos obligatorios y deja Caja formalmente cerrada para continuar.
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                {closeStep > 1 ? (
                  <Link
                    href={`/turno/entrega/${handover.id}?paso=${closeStep - 1}`}
                    className="inline-flex min-h-10 items-center rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-petrol-700 ring-1 ring-slate-300 hover:bg-slate-50"
                  >
                    ← ANTERIOR
                  </Link>
                ) : null}
              </div>
              {closeStep === 1 ? (
                !closeStepOneReady ? (
                  <span className="inline-flex min-h-10 items-center rounded-lg bg-slate-100 px-3.5 py-2 text-sm font-semibold text-slate-400">
                    SIGUIENTE →
                  </span>
                ) : (
                  <Link
                    href={`/turno/entrega/${handover.id}?paso=2`}
                    className="inline-flex min-h-10 items-center rounded-lg bg-gold-500 px-3.5 py-2 text-sm font-semibold text-petrol-950 hover:bg-gold-400"
                  >
                    SIGUIENTE →
                  </Link>
                )
              ) : null}
            </div>
          </div>
        </Card>
      ) : canFinalizeClose ? (
        <Card className="no-print">
          <CardHeader title="Cierre guiado · paso 5 de 5" />
          <div className="space-y-3 px-4 py-4">
            <div className="grid gap-2 sm:grid-cols-5">
              {['Caja y custodia', 'Pendientes', 'Revisión final', 'Entrega enviada'].map((label, index) => (
                <div key={label} className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200">
                  ✓ {index + 1} · {label}
                </div>
              ))}
              <div className="rounded-lg bg-gold-50 px-3 py-2 text-xs font-semibold text-petrol-950 ring-1 ring-gold-300">
                5 · Cerrar turno
              </div>
            </div>
            <div>
              <p className="font-semibold text-petrol-950">La entrega ya fue enviada</p>
              <p className="mt-1 text-sm text-slate-600">
                Ya no puedes cancelar el cierre. Sólo falta cerrar formalmente tu turno para terminar tu responsabilidad operativa.
              </p>
            </div>
            <CloseShiftForm shiftId={handover.fromShiftId} />
          </div>
        </Card>
      ) : null}

      {receptionStep ? (
        <Card className="no-print">
          <CardHeader title={`Recepción guiada · paso ${receptionStep} de 5`} />
          <div className="space-y-4 px-4 py-4">
            <div className="grid gap-2 sm:grid-cols-5">
              {[
                ['1', 'Revisar entrega'],
                ['2', 'Recontar Caja'],
                ['3', 'Recibir custodia'],
                ['4', 'Revisión final'],
                ['5', 'Abrir turno'],
              ].map(([step, label]) => {
                const numericStep = Number(step);
                const done =
                  numericStep === 1
                    ? receptionStep > 1
                    : numericStep === 2
                      ? cashReady && receptionStep > 2
                      : numericStep === 3
                        ? custodyReady && receptionStep > 3
                        : numericStep < receptionStep;
                const current = numericStep === receptionStep;
                return (
                  <div
                    key={step}
                    className={`rounded-lg px-3 py-2 text-xs ring-1 ${
                      current
                        ? 'bg-gold-50 font-semibold text-petrol-950 ring-gold-300'
                        : done
                          ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                          : 'bg-slate-50 text-slate-500 ring-slate-200'
                    }`}
                  >
                    {done ? '✓' : step} · {label}
                  </div>
                );
              })}
            </div>

            <div>
              <p className="font-semibold text-petrol-950">
                {receptionStep === 1
                  ? 'Revisa qué te está entregando el turno saliente'
                  : receptionStep === 2
                    ? 'Recuenta físicamente Caja y garantías'
                    : receptionStep === 3
                      ? 'Confirma la custodia física'
                      : receptionStep === 4
                        ? 'Comprueba lo que vas a recibir'
                        : 'Confirma la recepción y activa tu turno'}
              </p>
              <p className="mt-1 text-sm leading-5 text-slate-600">
                {receptionStep === 1
                  ? 'Lee los puntos urgentes, importantes e informativos. Los pendientes siguen vivos en el Libro; aquí sólo confirmas el relevo.'
                  : receptionStep === 2
                    ? 'Cuenta el fondo fijo por denominación y valida una a una las garantías en efectivo. No uses Caja general para este recuento.'
                    : receptionStep === 3
                      ? 'Toma físicamente los elementos declarados por quien entrega y confírmalos aquí.'
                      : receptionStep === 4
                        ? 'Revisa Caja, diferencias, garantías, custodia y puntos de entrega antes de abrir la operación.'
                        : 'Esta acción registra la entrega a tu nombre y cambia tu turno de INICIADO a ACTIVO en la misma operación.'}
              </p>
            </div>

            {receptionStep === 2 && !cashReady ? (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
                Falta completar el recuento de Caja y garantías.
              </div>
            ) : null}
            {receptionStep === 3 && !custodyReady ? (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
                Falta confirmar físicamente: {custodyPending.map((element) => element.name).join(', ')}.
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                {receptionStep > 1 ? (
                  <Link
                    href={`/turno/entrega/${handover.id}?recepcion=${receptionStep - 1}`}
                    className="inline-flex min-h-10 items-center rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-petrol-700 ring-1 ring-slate-300 hover:bg-slate-50"
                  >
                    ← ANTERIOR
                  </Link>
                ) : null}
              </div>
              {receptionStep === 1 ? (
                <Link
                  href={`/turno/entrega/${handover.id}?recepcion=2`}
                  className="inline-flex min-h-10 items-center rounded-lg bg-gold-500 px-3.5 py-2 text-sm font-semibold text-petrol-950 hover:bg-gold-400"
                >
                  SIGUIENTE · RECONTAR CAJA →
                </Link>
              ) : receptionStep === 2 ? (
                cashReady ? (
                  <Link
                    href={`/turno/entrega/${handover.id}?recepcion=3`}
                    className="inline-flex min-h-10 items-center rounded-lg bg-gold-500 px-3.5 py-2 text-sm font-semibold text-petrol-950 hover:bg-gold-400"
                  >
                    SIGUIENTE · RECIBIR CUSTODIA →
                  </Link>
                ) : (
                  <span className="inline-flex min-h-10 items-center rounded-lg bg-slate-100 px-3.5 py-2 text-sm font-semibold text-slate-400">
                    COMPLETA EL RECUENTO PARA CONTINUAR
                  </span>
                )
              ) : receptionStep === 3 ? (
                custodyReady ? (
                  <Link
                    href={`/turno/entrega/${handover.id}?recepcion=4`}
                    className="inline-flex min-h-10 items-center rounded-lg bg-gold-500 px-3.5 py-2 text-sm font-semibold text-petrol-950 hover:bg-gold-400"
                  >
                    SIGUIENTE · REVISIÓN FINAL →
                  </Link>
                ) : (
                  <span className="inline-flex min-h-10 items-center rounded-lg bg-slate-100 px-3.5 py-2 text-sm font-semibold text-slate-400">
                    CONFIRMA LA CUSTODIA PARA CONTINUAR
                  </span>
                )
              ) : receptionStep === 4 ? (
                <Link
                  href={`/turno/entrega/${handover.id}?recepcion=5`}
                  className="inline-flex min-h-10 items-center rounded-lg bg-gold-500 px-3.5 py-2 text-sm font-semibold text-petrol-950 hover:bg-gold-400"
                >
                  SIGUIENTE · CONFIRMAR Y ABRIR →
                </Link>
              ) : null}
            </div>

            {receptionStep === 5 ? (
              <div id="confirmar-recepcion" className="scroll-mt-32 rounded-xl bg-gold-50 p-3 ring-1 ring-gold-200">
                <ReceiveHandoverForm handoverId={handover.id} finalActivation />
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/*
        Caja y custodia viven dentro del flujo de Turno. El componente se enfoca
        por paso para que quien recibe no tenga que interpretar una pantalla
        completa de Caja ni saltar a /caja.
      */}
      {(canEdit && closeStep === 1) ||
      (receptionStep && [2, 3, 4].includes(receptionStep)) ||
      (!canEdit && !receptionStep) ? (
        <CashBox
          handoverId={handover.id}
          shiftId={handover.fromShiftId}
          state={cashState}
          formalClosure={formalCashClosure ? {
            humanId: formalCashClosure.humanId,
            closedAt: formalCashClosure.closedAt.toISOString(),
            closedByName: formalCashClosure.closedByName,
            reopenedAt: formalCashClosure.reopenedAt?.toISOString() ?? null,
          } : null}
          denominations={denominations.map((denomination) => ({
            id: denomination.id,
            currency: denomination.currency,
            value: Number(denomination.value),
            medium: denomination.medium,
          }))}
          previous={previousQuantities}
          role={cashRole}
          view={
            receptionStep === 2
              ? 'count'
              : receptionStep === 3
                ? 'custody'
                : receptionStep === 4
                  ? 'summary'
                  : 'all'
          }
          canReopen={user.permissions.includes('cash.reopen')}
        />
      ) : null}

      {(canEdit
        ? closeStep === 2 || closeStep === 3
        : receptionStep
          ? receptionStep === 1 || receptionStep === 4
          : true) ? (
        <>
        {grouped.length === 0 ? (
          <Card>
            <EmptyState
              message="La entrega no tiene puntos registrados."
              hint="Genera el resumen automático o agrega notas manuales."
            />
          </Card>
        ) : (
          grouped.map((group) => (
            <Card key={group.level}>
              <CardHeader
                title={`${HANDOVER_LEVEL_LABEL[group.level]} · ${group.items.length}`}
              />
              <ul className="divide-y divide-slate-100">
                {group.items.map((item) => (
                  <li key={item.id} className="flex gap-3 px-4 py-3">
                    <span
                      className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                        group.level === HandoverLevel.URGENTE
                          ? 'bg-red-600'
                          : group.level === HandoverLevel.IMPORTANTE
                            ? 'bg-orange-500'
                            : 'bg-slate-400'
                      }`}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip>{item.section}</Chip>
                        <Badge tone={HANDOVER_LEVEL_TONE[item.level]}>
                          {HANDOVER_LEVEL_LABEL[item.level]}
                        </Badge>
                        {item.manual ? <Chip>Nota manual</Chip> : null}
                      </div>
                      <p className="mt-1 text-sm font-medium text-petrol-900">{item.title}</p>
                      {item.detail ? (
                        <p className="mt-0.5 text-sm text-slate-600">{item.detail}</p>
                      ) : null}
                      {item.refType === 'entry' && item.refId ? (
                        <Link
                          href={`/libro/${item.refId}`}
                          className="mt-1 inline-flex text-xs font-medium text-petrol-600 hover:underline no-print"
                        >
                          Abrir registro
                        </Link>
                      ) : null}
                      {item.refType === 'task' && item.refId ? (
                        <Link
                          href={`/tareas/${item.refId}`}
                          className="mt-1 inline-flex text-xs font-medium text-petrol-600 hover:underline no-print"
                        >
                          Abrir tarea
                        </Link>
                      ) : null}
                    </div>
                    {canEdit && item.manual ? (
                      <div className="no-print">
                        <RemoveHandoverNoteForm itemId={item.id} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ))
        )}
        </>
      ) : null}

      {canEdit && closeStep === 2 ? (
        <>
          <Card className="no-print">
            <CardHeader title="Agregar nota manual" />
            <div className="px-4 py-4">
              <AddHandoverNoteForm handoverId={handover.id} />
            </div>
          </Card>
          <Card className="no-print">
            <CardHeader title="Confirmar revisión de pendientes" />
            <div className="space-y-3 px-4 py-4">
              <p className="text-sm text-slate-600">
                Confirma sólo después de revisar los asuntos que continuarán al siguiente turno.
                Esta confirmación queda registrada y se invalida si actualizas el resumen o cambias
                la nota de entrega.
              </p>
              <ConfirmHandoverReviewStepForm handoverId={handover.id} step="PENDINGS" />
            </div>
          </Card>
        </>
      ) : null}

      {canEdit && closeStep === 3 ? (
        <Card className="no-print">
          <CardHeader title="Resumen final antes del envío" />
          <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg bg-slate-50 px-3 py-3 ring-1 ring-slate-200">
              <p className="text-xs text-slate-500">Caja</p>
              <p className="mt-1 font-semibold text-petrol-900">
                {!cashState.enabled ? 'No configurada' : cashClosed ? 'Cerrada' : 'Pendiente'}
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-3 ring-1 ring-slate-200">
              <p className="text-xs text-slate-500">Garantías en efectivo</p>
              <p className="mt-1 font-semibold text-petrol-900">{cashState.cashGuarantees.length}</p>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-3 ring-1 ring-slate-200">
              <p className="text-xs text-slate-500">Elementos declarados</p>
              <p className="mt-1 font-semibold text-petrol-900">
                {cashState.elements.filter((element) => element.declared).length} / {cashState.elements.length}
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-3 ring-1 ring-slate-200">
              <p className="text-xs text-slate-500">Puntos de entrega</p>
              <p className="mt-1 font-semibold text-petrol-900">
                {counts.urgente + counts.importante + counts.informativo}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {counts.urgente} urgente · {counts.importante} importante · {counts.informativo} informativo
              </p>
            </div>
          </div>
          {requiredElementsMissing.length > 0 ? (
            <p className="border-t border-slate-100 px-4 py-3 text-sm text-amber-800">
              Faltan elementos obligatorios por declarar o justificar: {requiredElementsMissing.map((element) => element.name).join(', ')}.
            </p>
          ) : null}
          <div className="border-t border-slate-100 px-4 py-4">
            <ConfirmHandoverReviewStepForm
              handoverId={handover.id}
              step="FINAL"
              urgentCount={counts.urgente}
            />
          </div>
        </Card>
      ) : null}

      {canEdit && closeStep === 4 ? (
        <Card className="no-print">
          <CardHeader title="Enviar la entrega" />
          <div className="px-4 py-4">
            <p className="mb-3 text-sm text-slate-600">
              Al enviarla queda registrada de forma permanente y disponible para quien reciba el relevo.
              {handover.toShift
                ? ` Destinatario: turno ${SHIFT_TYPE_LABEL[handover.toShift.type]} (${handover.toShift.assignments.map((a) => a.user.name).join(', ') || 'sin personal asignado'}).`
                : ' Quedará en la bandeja para que el próximo turno la revise y la reciba.'}
            </p>
            <SendHandoverForm shiftId={handover.fromShiftId} />
          </div>
        </Card>
      ) : null}

      {!canReceive && handover.status === HandoverStatus.ENVIADA && isReceiver ? (
        <Card className="no-print">
          <div className="px-4 py-4 text-sm text-slate-600">
            Esta entrega sigue pendiente de recepción, pero primero debe quedar vinculada a tu turno desde Mi turno.
          </div>
        </Card>
      ) : null}

      {(!canEdit || closeStep === 3) ? (
      <Card className="print:break-inside-avoid">
        <CardHeader title="Informe de Caja · entrega/recepción" />
        <div className="px-4 py-5">
          <p className="text-sm text-slate-700">
            Este informe acredita el cierre del turno saliente, el recuento de Caja por quien
            recibe la entrega y la recepción del relevo. Debe imprimirse y firmarse por ambas
            personas. La validación posterior queda reservada a Supervisión o al auditor designado.
          </p>

          <div className="mt-8 grid gap-8 sm:grid-cols-3">
            <div className="pt-8">
              <div className="border-t border-slate-500 pt-2">
                <p className="text-xs font-semibold text-petrol-900">Recepcionista saliente</p>
                <p className="mt-1 text-xs text-slate-600">{handover.issuedBy.name}</p>
                <p className="mt-4 text-[0.7rem] text-slate-500">Firma</p>
              </div>
            </div>

            <div className="pt-8">
              <div className="border-t border-slate-500 pt-2">
                <p className="text-xs font-semibold text-petrol-900">Receptor de la entrega</p>
                <p className="mt-1 text-xs text-slate-600">
                  {handover.receivedBy?.name ?? 'Pendiente de recepción'}
                </p>
                <p className="mt-4 text-[0.7rem] text-slate-500">Firma</p>
              </div>
            </div>

            <div className="pt-8">
              <div className="border-t border-slate-500 pt-2">
                <p className="text-xs font-semibold text-petrol-900">
                  Validación / auditoría de cierre
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {closureValidation?.resolvedBy?.name
                    ? `Validado por ${closureValidation.resolvedBy.name}`
                    : 'Erick Herrera o auditor designado'}
                </p>
                <p className="mt-1 text-[0.7rem] text-slate-500">
                  {closureValidation?.resolvedAt
                    ? formatDateTime(closureValidation.resolvedAt)
                    : 'Pendiente de validación'}
                </p>
                <p className="mt-4 text-[0.7rem] text-slate-500">Firma y fecha</p>
              </div>
            </div>
          </div>
        </div>
      </Card>
      ) : null}

      {(!canEdit || closeStep === 3) ? (
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Comentarios" count={handover._count.comments} />
          <Comments
            target={{ handoverId: handover.id }}
            readOnly={isReceptionDeskRole(user.roleKey)}
          />
        </Card>
        <Card>
          <CardHeader title="Historial" count={history.length} />
          <HistoryTimeline events={history} />
        </Card>
      </div>
      ) : null}
    </div>
  );
}
