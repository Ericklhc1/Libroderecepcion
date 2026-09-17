import Link from 'next/link';
import { ArrowLeft, FileCheck2, TriangleAlert } from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import { getReservationPdfDraft } from '@/server/services/reservation-pdf';
import { Card, CardHeader } from '@/components/ui/card';
import { ActionForm, Field, Input } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { applyReservationPdfAction, discardReservationPdfAction } from '@/server/actions/reservation-pdf';
import { ReservationPdfUpload } from './reservation-pdf-upload';

export const metadata = { title: 'Cargar nueva reserva' };
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NewReservationPdfPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePagePermission('pms.import');
  const params = await searchParams;
  const raw = params.revision;
  const id = Array.isArray(raw) ? raw[0] : raw;
  const draft = id ? await getReservationPdfDraft(id) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/huespedes" className="inline-flex items-center gap-1.5 text-sm font-medium text-petrol-600 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Huéspedes y reservas
      </Link>

      <header>
        <h1 className="text-xl font-semibold text-petrol-900">Cargar nueva reserva</h1>
        <p className="mt-1 text-sm text-slate-600">
          El PDF se lee primero y no cambia nada hasta que confirmes la revisión. El ID PMS es la identidad canónica: si ya existe, se reconcilia en vez de duplicarse.
        </p>
      </header>

      {!draft ? (
        <Card className="p-4"><ReservationPdfUpload /></Card>
      ) : draft.appliedAt ? (
        <Card className="p-4">
          <p className="flex items-center gap-2 font-semibold text-emerald-700"><FileCheck2 className="h-5 w-5" />Este borrador ya fue aplicado.</p>
          <Link href="/huespedes" className="mt-3 inline-flex text-sm font-medium text-petrol-600 hover:underline">Volver a reservas</Link>
        </Card>
      ) : draft.discardedAt ? (
        <Card className="p-4"><p className="text-sm text-slate-600">Este borrador fue descartado y no modificó datos.</p></Card>
      ) : (
        <>
          <Card>
            <CardHeader title="Revisión antes de aplicar" />
            <div className="border-b border-slate-100 px-4 py-3 text-sm text-slate-600">
              Archivo: <span className="font-medium text-petrol-900">{draft.fileName}</span>. Corrige cualquier dato que el PDF no haya permitido leer con seguridad.
            </div>
            {!draft.extracted.code ? (
              <div className="mx-4 mt-4 flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                No se detectó un ID de reserva confiable. Debes escribirlo; sin ID no se puede aplicar.
              </div>
            ) : null}
            <ActionForm action={applyReservationPdfAction} className="space-y-4 p-4">
              <input type="hidden" name="draftId" value={draft.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="ID PMS / reserva" name="code" required hint="Clave canónica de deduplicación.">
                  <Input name="code" required defaultValue={draft.extracted.code ?? ''} />
                </Field>
                <Field label="Huésped principal" name="guestName">
                  <Input name="guestName" defaultValue={draft.extracted.guestName ?? ''} />
                </Field>
                <Field label="Habitación" name="roomNumber">
                  <Input name="roomNumber" inputMode="numeric" defaultValue={draft.extracted.roomNumber ?? ''} placeholder="Puede quedar vacía" />
                </Field>
                <Field label="Canal" name="channel">
                  <Input name="channel" defaultValue={draft.extracted.channel ?? ''} />
                </Field>
                <Field label="Llegada" name="checkInDate">
                  <Input name="checkInDate" type="date" defaultValue={draft.extracted.checkInDate ?? ''} />
                </Field>
                <Field label="Salida" name="checkOutDate">
                  <Input name="checkOutDate" type="date" defaultValue={draft.extracted.checkOutDate ?? ''} />
                </Field>
              </div>
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
                Al confirmar se crea o actualiza ReservationReference por ID PMS. Si el mismo ID ocupa varias habitaciones, las ocupaciones siguen siendo RoomStay independientes y no se duplica la reserva.
              </p>
              <SubmitButton pendingLabel="Aplicando…">Confirmar y aplicar reserva</SubmitButton>
            </ActionForm>
          </Card>

          <details className="card px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-petrol-700">Ver texto extraído del PDF</summary>
            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{draft.extracted.rawText}</pre>
          </details>

          <ActionForm action={discardReservationPdfAction}>
            <input type="hidden" name="draftId" value={draft.id} />
            <SubmitButton variant="danger" pendingLabel="Descartando…">Descartar sin aplicar</SubmitButton>
          </ActionForm>
        </>
      )}
    </div>
  );
}
