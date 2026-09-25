'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarClock, LockKeyhole } from 'lucide-react';
import type { ReceptionOperationMode } from '@/server/services/reception-operation-gate';

export function ReceptionOperationGate({
  mode,
}: {
  mode: ReceptionOperationMode;
}) {
  const pathname = usePathname();

  if (mode === 'ACTIVE') return null;
  if (
    pathname === '/turno' ||
    pathname.startsWith('/turno/entrega/') ||
    pathname === '/perfil'
  ) {
    return null;
  }

  const copy =
    mode === 'NO_SHIFT'
      ? {
          title: 'Operación bloqueada',
          body: 'Debes iniciar tu turno antes de trabajar con Novedades, Caja, Llaves o cualquier otra operación de Recepción.',
          action: 'Ir a iniciar turno',
        }
      : mode === 'HANDOVER_PENDING'
        ? {
            title: 'Entrega de turno pendiente',
            body: 'El turno saliente ya cerró. Recibe la entrega y recuenta Caja antes de iniciar el turno siguiente.',
            action: 'Revisar y recibir entrega',
          }
        : mode === 'RECEIVING'
          ? {
              title: 'Recepción de turno pendiente',
              body: 'Hay una recepción anterior todavía incompleta. Complétala desde Mi turno antes de operar.',
              action: 'Completar recepción',
            }
          : {
              title: 'Cierre de turno en curso',
              body: 'Mientras preparas o cierras tu turno, la operación general queda bloqueada. Completa Caja, entrega y cierre antes de continuar.',
              action: 'Continuar cierre',
            };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-petrol-950/55 p-4 backdrop-blur-sm no-print">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-slate-200">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold-100 text-petrol-800">
            <LockKeyhole className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-petrol-950">{copy.title}</h2>
            <p className="mt-1 text-sm leading-5 text-slate-600">{copy.body}</p>
          </div>
        </div>

        <Link
          href="/turno"
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-petrol-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-petrol-700"
        >
          <CalendarClock className="h-4 w-4" aria-hidden="true" />
          {copy.action}
        </Link>
      </div>
    </div>
  );
}
