'use client';

import { useRef, useState, type DragEvent } from 'react';
import { FileText, UploadCloud } from 'lucide-react';
import { ActionForm } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { prepareReservationPdfAction } from '@/server/actions/reservation-pdf';

export function ReservationPdfUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  function acceptFile(file: File | undefined) {
    if (!file || !inputRef.current) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    inputRef.current.files = transfer.files;
    setName(file.name);
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    acceptFile(event.dataTransfer.files?.[0]);
  }

  return (
    <ActionForm action={prepareReservationPdfAction} hideSuccess>
      <div
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
        className={`rounded-2xl border-2 border-dashed p-7 text-center transition ${dragging ? 'border-gold-500 bg-gold-50' : 'border-slate-300 bg-slate-50'}`}
      >
        <UploadCloud className="mx-auto h-8 w-8 text-petrol-600" aria-hidden="true" />
        <p className="mt-2 font-semibold text-petrol-900">Arrastra aquí el PDF de la reserva</p>
        <p className="mt-1 text-sm text-slate-500">o selecciónalo desde el equipo. Máximo 8 MB.</p>
        <label className="mt-4 inline-flex cursor-pointer rounded-lg bg-white px-3 py-2 text-sm font-semibold text-petrol-700 ring-1 ring-slate-300 hover:bg-slate-50">
          Seleccionar PDF
          <input
            ref={inputRef}
            type="file"
            name="reservationPdf"
            accept="application/pdf,.pdf"
            required
            className="sr-only"
            onChange={(event) => setName(event.currentTarget.files?.[0]?.name ?? null)}
          />
        </label>
        {name ? (
          <p className="mx-auto mt-4 flex max-w-md items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-sm text-petrol-900 ring-1 ring-slate-200">
            <FileText className="h-4 w-4 text-petrol-600" aria-hidden="true" /> {name}
          </p>
        ) : null}
      </div>
      <SubmitButton className="mt-4 w-full" size="lg" pendingLabel="Leyendo reserva…">
        Leer PDF y revisar antes de aplicar
      </SubmitButton>
    </ActionForm>
  );
}
