import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HandoverLevel, HandoverStatus } from '@prisma/client';
import { ArrowLeft, CheckCircle2, Clock, Send, User } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { requirePageUser } from '@/server/auth/guard';
import { hasPermission } from '@/server/auth/current-user';
import { getHistory } from '@/server/services/history';
import { getMyActiveShift } from '@/server/services/shifts';
import { Badge, Chip } from '@/components/ui/badge';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
import { CashBox } from '@/components/operational/cash-box';
import { getHandoverCashState, listDenominations } from '@/server/services/cash';
import { getShiftCashClosure } from '@/server/services/cash-closure';
import { CashCountKind } from '@prisma/client';
import { Comments } from '@/components/operational/comments';
import { HistoryTimeline } from '@/components/operational/history-timeline';
import { SendHandoverForm } from '@/components/operational/shift-actions';
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
import { formatDate, formatDateTime, relativeTime } from '@/lib/format';

export const metadata = { title: 'Entrega de turno' };
export const dynamic = 'force-dynamic';

const LEVEL_ORDER: HandoverLevel[] = [
  HandoverLevel.URGENTE,
  HandoverLevel.IMPORTANTE,
  HandoverLevel.INFORMATIVO,
];

export default async function HandoverPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePageUser();
  const { id } = await params;

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

  const [history, cashState, denominations, myActiveShift, formalCashClosure] = await Promise.all([
    getHistory({ entity: 'ShiftHandover', entityId: handover.id }),
    getHandoverCashState(handover.id),
    listDenominations(),
    getMyActiveShift(user.id),
    getShiftCashClosure(handover.fromShiftId),
  ]);

  const isIssuer = handover.fromShift.assignments.some((a) => a.userId === user.id);
  const linkedReceiver = handover.toShift?.assignments.some((a) => a.userId === user.id) ?? false;
  /*
    Una entrega se envía a la bandeja con `toShiftId = null`: el turno entrante
    todavía no existe en ese momento. Por eso el receptor no puede depender de
    `toShift`; basta con que tenga un turno abierto distinto del saliente y que
    la entrega siga ENVIADA. `receiveHandover` fijará el destino definitivo al
    confirmar. Sin esta regla el receptor nunca podía contar la caja, y la
    recepción exigía precisamente ese recuento: un bloqueo circular.
  */
  const inboxReceiver = Boolean(
    handover.status === HandoverStatus.ENVIADA &&
      !handover.toShiftId &&
      myActiveShift &&
      myActiveShift.id !== handover.fromShiftId &&
      myActiveShift.assignments.some((a) => a.userId === user.id),
  );
  const isReceiver = linkedReceiver || inboxReceiver;
  const isDraft = handover.status === HandoverStatus.BORRADOR;
  const canEdit = isDraft && isIssuer && user.permissions.includes('shift.handover');

  /*
    La Caja se puede recibir antes que la entrega operativa: basta un arqueo
    declarado y un turno entrante activo distinto del saliente.
  */
  const canReceiveCash = Boolean(
    myActiveShift &&
      myActiveShift.id !== handover.fromShiftId &&
      cashState.declared &&
      !cashState.confirmed &&
      (handover.status === HandoverStatus.BORRADOR ||
        handover.status === HandoverStatus.ENVIADA) &&
      (!handover.toShiftId || handover.toShiftId === myActiveShift.id) &&
      hasPermission(user, 'cash.count_receive'),
  );
  const cashRole: 'emisor' | 'receptor' | 'lector' = canEdit
    ? 'emisor'
    : canReceiveCash
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
        <PrintButton />
      </div>

      <Card>
        <div className="px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={HANDOVER_STATUS_TONE[handover.status]}>
                  {HANDOVER_STATUS_LABEL[handover.status]}
                </Badge>
                <Chip>
                  Turno {SHIFT_TYPE_LABEL[handover.fromShift.type]} ·{' '}
                  {formatDate(handover.fromShift.date)}
                </Chip>
                {handover.toShift ? (
                  <Chip>
                    → Turno {SHIFT_TYPE_LABEL[handover.toShift.type]} ·{' '}
                    {formatDate(handover.toShift.date)}
                  </Chip>
                ) : (
                  <Chip>En bandeja · sin receptor confirmado</Chip>
                )}
              </div>
              <h1 className="mt-2 text-xl font-semibold text-petrol-900">Entrega de turno</h1>
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

      {/*
        La Caja puede transferirse mientras la entrega completa sigue en borrador.
        Es la única recepción obligatoria para que el turno entrante continúe.
      */}
      <CashBox
        handoverId={handover.id}
        shiftId={handover.fromShiftId}
        state={cashState}
        formalClosure={formalCashClosure ? {
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
        permissions={{
          declareCount: hasPermission(user, 'cash.count_declare'),
          receiveCount: hasPermission(user, 'cash.count_receive'),
          returnGuarantee: hasPermission(user, 'cash.guarantee_out'),
          usdRate: hasPermission(user, 'cash.usd_rate'),
          treasuryTransfer: hasPermission(user, 'cash.treasury_transfer'),
          close: hasPermission(user, 'cash.close'),
        }}
      />

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

      {canEdit ? (
        <>
          <Card className="no-print">
            <CardHeader title="Agregar nota manual" />
            <div className="px-4 py-4">
              <AddHandoverNoteForm handoverId={handover.id} />
            </div>
          </Card>

          <Card className="no-print">
            <CardHeader title="Enviar la entrega" />
            <div className="px-4 py-4">
              <p className="mb-3 text-sm text-slate-600">
                Al enviarla queda registrada de forma permanente y el turno siguiente debe
                confirmarla.
                {handover.toShift
                  ? ` Destinatario: turno ${SHIFT_TYPE_LABEL[handover.toShift.type]} (${handover.toShift.assignments.map((a) => a.user.name).join(', ') || 'sin personal asignado'}).`
                  : ' Quedará en la bandeja para que el próximo turno la revise y la reciba.'}
              </p>
              <SendHandoverForm shiftId={handover.fromShiftId} />
            </div>
          </Card>
        </>
      ) : null}

      {handover.status === HandoverStatus.ENVIADA && isReceiver ? (
        <Card className="no-print">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
            <p className="text-sm text-slate-700">
              Esta entrega operativa está disponible para tu turno. La Caja se recibe por separado; los elementos físicos pendientes no bloquean.
            </p>
            <Link
              href="/turno"
              className="inline-flex items-center gap-2 rounded-lg bg-gold-500 px-3.5 py-2 text-sm font-semibold text-petrol-950 hover:bg-gold-400"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              Ir a confirmar recepción
            </Link>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Comentarios" count={handover._count.comments} />
          <Comments target={{ handoverId: handover.id }} />
        </Card>
        <Card>
          <CardHeader title="Historial" count={history.length} />
          <HistoryTimeline events={history} />
        </Card>
      </div>
    </div>
  );
}
