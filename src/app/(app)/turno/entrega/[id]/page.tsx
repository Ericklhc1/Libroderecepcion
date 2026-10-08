import { simpleNoveltiesEnabled } from '@/server/services/simple-novelties';
import { legacyClosureAlertWhere } from '@/server/services/closure-review';
import { closurePrintValidation } from '@/domain/handover-print';
import { HandoverPrint } from '@/components/operational/handover-print';
import { ClosureReviewLink } from '@/components/supervision/closure-review-form';
import { ClearHandoverDrafts } from '@/components/operational/form-draft-session';
import {canReadReceptionHandover,visibleHandover} from '@/server/services/handover-snapshot';
import { handoverElementPending } from '@/domain/handover-custody';
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
  ConfirmReceptionReviewStepForm,
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
  searchParams: Promise<{ paso?: string }>;
}) {
  const user = await requirePageUser();
  const simpleNovelties = await simpleNoveltiesEnabled();
  if (!canReadReceptionHandover(user)) notFound();
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
  Object.assign(handover,await visibleHandover(user,handover));

  const [history, cashState, denominations, formalCashClosure, legacyValidation, closureReviewer] = await Promise.all([
    getHistory({ entity: 'ShiftHandover', entityId: handover.id },user),
    getHandoverCashState(handover.id),
    listDenominations(),
    getShiftCashClosure(handover.fromShiftId),
    prisma.alert.findFirst({
      where: { ...legacyClosureAlertWhere(handover.fromShiftId), status:'RESUELTA' },
      select: {
        status: true,
        resolvedAt: true,
        resolvedBy: { select: { name: true } },
      },
    }),
    handover.fromShift.closureReviewedById ? prisma.user.findUnique({where:{id:handover.fromShift.closureReviewedById},select:{name:true}}) : Promise.resolve(null),
  ]);
  const closureValidation = closurePrintValidation(handover.fromShift.closureReviewDecision,{status:'RESUELTA' as const,resolvedBy:closureReviewer,resolvedAt:handover.fromShift.closureReviewedAt},legacyValidation);

  const isIssuer = handover.fromShift.assignments.some((a) => a.userId === user.id);
  const linkedReceiver = handover.toShift?.assignments.some((a) => a.userId === user.id) ?? false;
  const receptionInProgress = Boolean(
    handover.status === HandoverStatus.ENVIADA &&
      handover.fromShift.status === ShiftStatus.CERRADO &&
      handover.toShift &&
      linkedReceiver &&
      user.permissions.includes('shift.receive') &&
      (handover.toShift.status === ShiftStatus.INICIADO || handover.toShift.status === ShiftStatus.ACTIVO),
  );
  const canReceive = receptionInProgress;
  const isReceiver =
    linkedReceiver ||
    handover.receivedBy?.id === user.id;
  const isDraft = handover.status === HandoverStatus.BORRADOR;
  const canPrint = handover.status === HandoverStatus.ENVIADA || handover.status === HandoverStatus.RECIBIDA;
  const canEdit = isDraft && isIssuer && user.permissions.includes('shift.handover');
  const canFinalizeClose = Boolean(
    isIssuer &&
      handover.status === HandoverStatus.ENVIADA &&
      handover.fromShift.status === ShiftStatus.ENTREGA_ENVIADA,
  );
  const requestedCloseStep = Number(query.paso ?? '1');

  const cashReadyForReception = !cashState.enabled || Boolean(cashState.confirmed);
  const pendingReceptionElements = cashState.elements.filter(
    handoverElementPending,
  );
  const receptionStep = !receptionInProgress
    ? null
    : !handover.receiverBriefingReviewedAt
      ? 1
      : !cashReadyForReception
        ? 2
        : !handover.receiverCustodyReviewedAt
          ? 3
          : !handover.receiverFinalReviewAt
            ? 4
            : 5;
  const receptionStepTitle =
    receptionStep === 1
      ? 'Revisar la entrega'
      : receptionStep === 2
        ? 'Recontar Caja y validar garantías'
        : receptionStep === 3
          ? 'Recibir la custodia'
          : receptionStep === 4
            ? 'Revisión final'
            : receptionStep === 5
              ? 'Confirmar recepción y activar turno'
              : null;
  const receptionStepBody =
    receptionStep === 1
      ? 'Lee los pendientes, prioridades y puntos urgentes del turno saliente antes de tocar Caja.'
      : receptionStep === 2
        ? 'Cuenta físicamente CLP/USD y valida cada garantía en efectivo. La Caja general permanece bloqueada.'
        : receptionStep === 3
          ? 'Confirma llaves, teléfono y demás elementos físicos que el saliente declaró entregar.'
          : receptionStep === 4
            ? 'Compara lo declarado con lo recibido y confirma que comprendes los puntos que continúan vigentes.'
            : receptionStep === 5
              ? 'Este último paso registra la recepción y cambia tu turno de INICIADO a ACTIVO. En emergencia, regulariza el relevo sin crear otro turno.'
              : null;

  const cashRole: 'emisor' | 'receptor' | 'lector' = canEdit || canFinalizeClose
    ? 'emisor'
    : receptionInProgress
      ? 'receptor'
      : 'lector';

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
    : !handover.pendingsReviewedAt && !simpleNovelties
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
      handover.fromShift.assignments.filter(assignment=>!assignment.removedExplicitly).map((assignment) => assignment.user.name),
    ) || handover.issuedBy.name;
  const shiftTypeTitle = SHIFT_TYPE_LABEL[handover.fromShift.type].toUpperCase();

  return (
    <>
      {canPrint && <HandoverPrint handoverStatus={handover.status} title={`Entrega de turno ${shiftTypeTitle} · ${shiftPeriod}`} participants={shiftParticipants} issuer={handover.issuedBy.name}
        issuedAt={handover.issuedAt ? formatDateTime(handover.issuedAt) : 'Sin enviar'} status={HANDOVER_STATUS_LABEL[handover.status]}
        receiver={handover.receivedBy?.name ?? null} receivedAt={handover.receivedAt ? formatDateTime(handover.receivedAt) : null}
        supervisor={closureValidation?.resolvedBy?.name ?? null} items={handover.items} cash={cashState}
        notes={handover.notes} receiverObservations={handover.receiverObservations} />}
      <div className="print-report handover-screen mx-auto max-w-5xl space-y-4">
      {handover.status !== HandoverStatus.BORRADOR && !receptionInProgress && <ClearHandoverDrafts handoverId={handover.id} />}
      <div className="flex flex-wrap items-center justify-between gap-2 no-print">
        <Link
          href="/turno"
          className="inline-flex items-center gap-1 text-sm font-medium text-petrol-600 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Volver al turno
        </Link>
        {canPrint ? (
          <PrintButton label="Imprimir informe de turno" />
        ) : (
          <span className="text-xs font-medium text-slate-500">
            Impresión disponible para entregas enviadas o recibidas.
          </span>
        )}
      </div>

      {user.permissions.includes('shift.manage') && (user.isSystemAdmin || user.roleKey === 'SUPERVISOR') && handover.fromShift.status === ShiftStatus.CERRADO ? <ClosureReviewLink shiftId={handover.fromShiftId} /> : null}
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
          <CardHeader
            title={
              closeStepOneReady
                ? 'Cierre de turno · paso final'
                : 'Cierre excepcional · completar Caja y custodia'
            }
          />
          <div className="space-y-3 px-4 py-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <div
                className={`rounded-lg px-3 py-2 text-xs ring-1 ${
                  closeStepOneReady
                    ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                    : 'bg-gold-50 font-semibold text-petrol-950 ring-gold-300'
                }`}
              >
                {closeStepOneReady ? '✓' : '1'} · Caja y custodia
              </div>
              <div
                className={`rounded-lg px-3 py-2 text-xs ring-1 ${
                  closeStepOneReady
                    ? 'bg-gold-50 font-semibold text-petrol-950 ring-gold-300'
                    : 'bg-slate-50 text-slate-500 ring-slate-200'
                }`}
              >
                2 · Cerrar turno
              </div>
            </div>
            {closeStepOneReady ? (
              <>
                <div>
                  <p className="font-semibold text-petrol-950">La entrega ya fue enviada</p>
                  <p className="mt-1 text-sm leading-5 text-slate-600">
                    Caja y custodia ya están formalizadas. Cierra tu turno para terminar tu
                    responsabilidad. La revisión de Supervisión será posterior y no bloquea el relevo.
                  </p>
                </div>
                <CloseShiftForm shiftId={handover.fromShiftId} />
              </>
            ) : (
              <div>
                <p className="font-semibold text-petrol-950">
                  La continuidad comenzó antes de terminar este cierre
                </p>
                <p className="mt-1 text-sm leading-5 text-slate-600">
                  Completa ahora el arqueo, valida las garantías y declara la custodia real del
                  turno saliente. El Libro no reconstruirá esos valores automáticamente.
                </p>
              </div>
            )}
          </div>
        </Card>
      ) : null}

      {receptionStep && receptionStepTitle && receptionStepBody ? (
        <Card className="no-print">
          <CardHeader title={`Recepción de turno · paso ${receptionStep} de 5`} />
          <div className="space-y-3 px-4 py-4">
            <div className="grid gap-2 sm:grid-cols-5">
              {[
                ['1', 'Entrega'],
                ['2', 'Caja'],
                ['3', 'Custodia'],
                ['4', 'Revisión'],
                ['5', 'Activar'],
              ].map(([step, label]) => {
                const numericStep = Number(step);
                const done = numericStep < receptionStep;
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
              <p className="font-semibold text-petrol-950">{receptionStepTitle}</p>
              <p className="mt-1 text-sm leading-5 text-slate-600">{receptionStepBody}</p>
            </div>
            {receptionStep === 1 ? (
              <p className="text-xs text-slate-500">
                Revisa los puntos de entrega que aparecen a continuación y confirma al final del bloque.
              </p>
            ) : receptionStep === 2 ? (
              <Link
                href="#recuento-caja"
                className="inline-flex rounded-lg bg-gold-500 px-3.5 py-2 text-sm font-semibold text-petrol-950 hover:bg-gold-400"
              >
                IR AL RECUENTO DE CAJA
              </Link>
            ) : receptionStep === 3 ? (
              <Link
                href="#custodia-recepcion"
                className="inline-flex rounded-lg bg-gold-500 px-3.5 py-2 text-sm font-semibold text-petrol-950 hover:bg-gold-400"
              >
                IR A CUSTODIA
              </Link>
            ) : receptionStep === 5 ? (
              <Link
                href="#confirmar-recepcion"
                className="inline-flex rounded-lg bg-gold-500 px-3.5 py-2 text-sm font-semibold text-petrol-950 hover:bg-gold-400"
              >
                IR A CONFIRMACIÓN FINAL
              </Link>
            ) : null}
          </div>
        </Card>
      ) : null}

      {(canEdit && closeStep === 1) || (canFinalizeClose && !closeStepOneReady) ? (
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
          reviewerId={user.id}
          role="emisor"
          canReturnGuaranteeDuringClosing={canEdit && user.permissions.includes('cash.guarantee_out')}
          canReopen={user.permissions.includes('cash.reopen')}
        />
      ) : null}

      {receptionStep === 2 ? (
        <CashBox
          handoverId={handover.id}
          shiftId={handover.toShiftId ?? handover.fromShiftId}
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
          reviewerId={user.id}
          role="receptor"
          receiverStage="CASH"
        />
      ) : null}

      {receptionStep === 3 ? (
        <div id="custodia-recepcion" className="scroll-mt-32 space-y-4">
          <CashBox
            handoverId={handover.id}
            shiftId={handover.toShiftId ?? handover.fromShiftId}
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
            role="receptor"
            canApproveMissing={user.permissions.includes('shift.manage')}
            reviewerId={user.id}
            receiverStage="CUSTODY"
          />
          <Card className="no-print">
            <CardHeader title="Confirmar custodia recibida" />
            <div className="space-y-3 px-4 py-4">
              {pendingReceptionElements.length > 0 ? (
                <p className="text-sm text-amber-900">
                  Aún falta recibir o revisar la diferencia: {pendingReceptionElements.map((element) => element.name).join(', ')}.
                </p>
              ) : (
                <p className="text-sm text-slate-600">
                  Caja, garantías y elementos declarados ya están revisados. Confirma para continuar.
                </p>
              )}
              <ConfirmReceptionReviewStepForm handoverId={handover.id} step="CUSTODY" />
            </div>
          </Card>
        </div>
      ) : null}

      {!canEdit && !canFinalizeClose && !receptionInProgress ? (
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
          role="lector"
          canApproveMissing={user.permissions.includes('shift.manage') && handover.status === HandoverStatus.ENVIADA}
          reviewerId={user.id}
        />
      ) : null}

      {((canEdit && (closeStep === 2 || closeStep === 3)) ||
        (!canEdit && !receptionInProgress) ||
        receptionStep === 1 ||
        receptionStep === 4) ? (
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

      {receptionStep === 1 ? (
        <Card className="no-print">
          <CardHeader title="Confirmar entrega revisada" />
          <div className="space-y-3 px-4 py-4">
            <p className="text-sm text-slate-600">
              Confirma sólo después de leer los puntos que continúan al turno entrante.
            </p>
            <ConfirmReceptionReviewStepForm handoverId={handover.id} step="BRIEFING" simpleNovelties={simpleNovelties} />
          </div>
        </Card>
      ) : null}

      {receptionStep === 4 ? (
        <Card className="no-print">
          <CardHeader title="Revisión final de recepción" />
          <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg bg-slate-50 px-3 py-3 ring-1 ring-slate-200">
              <p className="text-xs text-slate-500">Caja recibida</p>
              <p className="mt-1 font-semibold text-petrol-900">
                {!cashState.enabled ? 'No configurada' : cashState.confirmed ? 'Confirmada' : 'Pendiente'}
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-3 ring-1 ring-slate-200">
              <p className="text-xs text-slate-500">Garantías en efectivo</p>
              <p className="mt-1 font-semibold text-petrol-900">{cashState.cashGuarantees.length}</p>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-3 ring-1 ring-slate-200">
              <p className="text-xs text-slate-500">Custodia</p>
              <p className="mt-1 font-semibold text-petrol-900">
                {cashState.elements.filter((element) => element.declared && element.confirmed).length} /{' '}
                {cashState.elements.filter((element) => element.declared).length} recibidos
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-3 ring-1 ring-slate-200">
              <p className="text-xs text-slate-500">Puntos heredados</p>
              <p className="mt-1 font-semibold text-petrol-900">
                {counts.urgente + counts.importante + counts.informativo}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {counts.urgente} urgente · {counts.importante} importante · {counts.informativo} informativo
              </p>
            </div>
          </div>
          <div className="border-t border-slate-100 px-4 py-4">
            <ConfirmReceptionReviewStepForm
              handoverId={handover.id}
              step="FINAL"
              urgentCount={counts.urgente}
              simpleNovelties={simpleNovelties}
            />
          </div>
        </Card>
      ) : null}

      {canEdit && closeStep === 2 ? (
        <>
          <Card className="no-print">
            <CardHeader title="Agregar nota manual" />
            <div className="px-4 py-4">
              <AddHandoverNoteForm handoverId={handover.id} actorId={user.id} revision={handover.items.find(item => item.manual)?.id ?? 'new'}
                observation={handover.items.find(item => item.manual)?.title.replace(/^Observación:\s*/, '') ?? ''}
                nextAction={handover.items.find(item => item.manual)?.detail?.replace(/^Siguiente acción:\s*/, '').replace(/^Sin acción adicional indicada\.$/, '') ?? ''} />
            </div>
          </Card>
          <Card className="no-print">
            <CardHeader title={simpleNovelties?"Pendientes del relevo":"Confirmar revisión de pendientes"} />
            <div className="space-y-3 px-4 py-4">
              {!simpleNovelties&&<p className="text-sm text-slate-600">
                Confirma sólo después de revisar los asuntos que continuarán al siguiente turno.
                Esta confirmación queda registrada y se invalida si actualizas el resumen o cambias
                la nota de entrega.
              </p>}
              {simpleNovelties?<Link href={`/turno/entrega/${handover.id}?paso=3`} className="inline-flex bg-petrol-800 px-3 py-2 text-white">Continuar a revisión final</Link>:<ConfirmHandoverReviewStepForm handoverId={handover.id} step="PENDINGS" />}
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
              simpleNovelties={simpleNovelties}
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

      {receptionStep === 5 && canReceive ? (
        <div id="confirmar-recepcion" className="scroll-mt-32">
          <Card className="no-print">
            <CardHeader title="Paso 5 de 5 · confirmar y activar" />
            <div className="px-4 py-4">
              <p className="mb-3 text-sm leading-5 text-slate-700">
                Ya completaste entrega, Caja, garantías, custodia y revisión final. Al confirmar,
                el relevo quedará recibido a tu nombre y tu turno quedará ACTIVO.
              </p>
              <ReceiveHandoverForm handoverId={handover.id} />
            </div>
          </Card>
        </div>
      ) : handover.status === HandoverStatus.ENVIADA && handover.toShiftId && !isReceiver ? (
        <Card className="no-print">
          <div className="px-4 py-4 text-sm text-slate-600">
            Esta entrega ya está siendo recibida por otro turno.
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
                    : 'Supervisión / Administrador de sistema'}
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
      <div className="grid gap-4 lg:grid-cols-2 no-print">
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
    </>
  );
}
