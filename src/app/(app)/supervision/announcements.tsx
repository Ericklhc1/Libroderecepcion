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
 * Emitir un aviso importante.
 *
 * El selector de persona se muestra siempre y el servidor descarta el
 * destinatario cuando el alcance es «todos»: esconderlo con JavaScript sería
 * una barrera de interfaz, y la regla tiene que valer también si el formulario
 * se envía de otra forma.
 *
 * El modelo sigue siendo `Announcement`: cambia el lenguaje del mesón, no la
 * arquitectura ni la trazabilidad que ya existe.
 */
export function NewAnnouncementDialog({ users }: { users: UserOption[] }) {
  return (
    <Dialog
      trigger="Emitir aviso importante"
      triggerVariant="gold"
      triggerSize="sm"
      title="Aviso importante"
      description="Se muestra antes de continuar y pide una confirmación escrita de lectura. Úsalo para instrucciones que el turno necesita ver sí o sí."
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
          hint="Vacío = no caduca. Un aviso vencido deja de pedir confirmación."
        >
          <Input type="datetime-local" name="expiresAt" />
        </Field>
        <SubmitButton variant="gold" pendingLabel="Emitiendo…">
          Emitir aviso
        </SubmitButton>
      </ActionForm>
    </Dialog>
  );
}

/** Retira un aviso: deja de bloquear y conserva quién lo confirmó. */
export function CloseAnnouncementDialog({ announcementId }: { announcementId: string }) {
  return (
    <Dialog
      trigger="Retirar"
      triggerVariant="ghost"
      triggerSize="sm"
      width="sm"
      title="Retirar aviso"
      description="Deja de pedir confirmación a quien no lo haya leído. Las confirmaciones que ya existen se conservan."
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
