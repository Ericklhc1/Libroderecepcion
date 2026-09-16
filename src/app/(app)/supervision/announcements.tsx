'use client';

import { ActionForm, Field, Input, Select, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

import {
  closeAnnouncementAction,
  createAnnouncementAction,
} from '@/server/actions/announcements';

export type UserOption = { value: string; label: string };

/**
 * Emitir un comunicado obligatorio.
 *
 * El selector de persona se muestra siempre y el servidor descarta el
 * destinatario cuando el alcance es «todos»: esconderlo con JavaScript sería
 * una barrera de interfaz, y la regla tiene que valer también si el formulario
 * se envía de otra forma.
 */
export function NewAnnouncementDialog({ users }: { users: UserOption[] }) {
  return (
    <Dialog
      trigger="Emitir comunicado"
      triggerVariant="gold"
      triggerSize="sm"
      title="Comunicado obligatorio"
      description="Bloquea la pantalla de quien lo recibe hasta que confirme la lectura escribiendo algo. Úsalo para lo que nadie puede dejar de leer."
    >
      <ActionForm action={createAnnouncementAction} closeOnSuccess resetOnSuccess>
        <Field label="Título" name="title" required>
          <Input name="title" required maxLength={200} placeholder="Corte de agua en el piso 5" />
        </Field>
        <Field
          label="Mensaje"
          name="body"
          required
          hint="Se muestra tal como lo escribas, con tus saltos de línea."
        >
          <Textarea name="body" rows={5} required minLength={10} maxLength={4000} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dirigido a" name="scope" required>
            <Select
              name="scope"
              required
              options={[
                { value: 'TODOS', label: 'Todo el personal' },
                { value: 'USUARIO', label: 'Una persona' },
              ]}
            />
          </Field>
          <Field
            label="Persona"
            name="targetUserId"
            hint="Sólo si elegiste «Una persona»."
          >
            <Select name="targetUserId" options={users} placeholder="Sin destinatario" />
          </Field>
        </div>
        <Field
          label="Caduca (opcional)"
          name="expiresAt"
          hint="Vacío = no caduca. Un comunicado vencido deja de bloquear."
        >
          <Input type="datetime-local" name="expiresAt" />
        </Field>
        <SubmitButton variant="gold" pendingLabel="Emitiendo…">
          Emitir comunicado
        </SubmitButton>
      </ActionForm>
    </Dialog>
  );
}

/** Retira un comunicado: deja de bloquear y se conserva quién lo confirmó. */
export function CloseAnnouncementDialog({ announcementId }: { announcementId: string }) {
  return (
    <Dialog
      trigger="Retirar"
      triggerVariant="ghost"
      triggerSize="sm"
      width="sm"
      title="Retirar comunicado"
      description="Deja de bloquear a quien no lo haya confirmado. Las confirmaciones que ya existen se conservan."
    >
      <ActionForm action={closeAnnouncementAction} closeOnSuccess>
        <input type="hidden" name="announcementId" value={announcementId} />
        <Field label="Motivo" name="reason" required>
          <Textarea name="reason" rows={2} required maxLength={500} />
        </Field>
        <SubmitButton variant="secondary" pendingLabel="Retirando…">
          Retirar
        </SubmitButton>
      </ActionForm>
    </Dialog>
  );
}
