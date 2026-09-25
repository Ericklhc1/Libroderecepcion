'use client';

import { formatDateTime } from '@/lib/format';

import { Megaphone, UserRound } from 'lucide-react';
import { ActionForm, Field, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { confirmAnnouncementAction } from '@/server/actions/announcements';
import type { PendingAnnouncement } from '@/server/services/announcements';

/**
 * Aviso importante: bloquea la pantalla hasta confirmar la lectura.
 *
 * Se muestra UNO a la vez, el primero de la cola. Apilar cinco avisos en una
 * pantalla es garantizar que no se lea ninguno; de a uno, cada confirmación
 * revela el siguiente.
 *
 * No hay forma de cerrarlo: ni aspa, ni Escape, ni clic fuera. La exigencia
 * operativa no cambió; sólo el lenguaje visible evita presentar una medida de
 * seguridad como una amenaza. El texto de confirmación sigue siendo
 * obligatorio porque un botón solo se pulsa sin leer.
 *
 * El bloqueo es de interfaz, no de seguridad: quien sepa usar la consola puede
 * saltárselo. Lo que garantiza el sistema es que **sin confirmar no queda
 * registro de lectura**, y eso es lo que el Supervisor necesita saber.
 */
export function AnnouncementGate({
  announcements,
  userName,
}: {
  announcements: PendingAnnouncement[];
  userName: string;
}) {
  const current = announcements[0];
  if (!current) return null;

  const remaining = announcements.length - 1;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center overflow-y-auto bg-petrol-950/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="aviso-importante-titulo"
    >
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <span className="mt-0.5 rounded-lg bg-gold-100 p-2 text-gold-700">
            {current.personal ? (
              <UserRound className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Megaphone className="h-5 w-5" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="atencion">
                {current.personal ? 'Aviso importante para ti' : 'Aviso importante para el equipo'}
              </Badge>
              {remaining > 0 ? (
                <span className="text-xs text-slate-500">
                  y {remaining} más después de éste
                </span>
              ) : null}
            </div>
            <h2
              id="aviso-importante-titulo"
              className="mt-1 text-lg font-semibold text-petrol-900"
            >
              {current.title}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {current.createdByName} · {formatDateTime(current.createdAt)}
            </p>
          </div>
        </div>

        <div className="px-5 py-4">
          <p className="whitespace-pre-line text-sm text-slate-700">{current.body}</p>
        </div>

        <div className="border-t border-slate-100 px-5 py-4">
          <ActionForm action={confirmAnnouncementAction} refreshOnSuccess>
            <input type="hidden" name="announcementId" value={current.id} />
            <Field
              label={`${userName}, confirma que lo leíste`}
              name="text"
              required
              hint="Escribe qué entendiste o qué vas a hacer. Queda registrado."
            >
              <Textarea
                name="text"
                rows={3}
                required
                minLength={3}
                maxLength={2000}
                autoFocus
                placeholder="Entendido: reviso las llaves del piso 6 antes de entregar el turno."
              />
            </Field>
            <SubmitButton className="w-full" pendingLabel="Confirmando…" size="lg">
              Confirmar lectura y continuar
            </SubmitButton>
          </ActionForm>
          <p className="mt-2 text-center text-xs text-slate-400">
            Este aviso requiere confirmación antes de continuar.
          </p>
        </div>
      </div>
    </div>
  );
}
