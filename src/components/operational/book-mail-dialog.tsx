'use client';

import { Mail } from 'lucide-react';
import { ActionForm, Field, Input, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { sendBookItemMailAction } from '@/server/actions/book-mail';
import type { BookKind } from '@/server/services/book';

export function BookMailDialog({ kind, id, reference }: { kind: BookKind; id: string; reference: string }) {
  return (
    <Dialog
      title={`Enviar ${reference} por correo`}
      description="Se envía como ficha del Libro Operativo con sus datos actuales."
      triggerVariant="ghost"
      triggerSize="sm"
      width="sm"
      trigger={
        <>
          <Mail className="h-3.5 w-3.5" aria-hidden="true" />
          Correo
        </>
      }
    >
      <ActionForm action={sendBookItemMailAction} closeOnSuccess resetOnSuccess>
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="id" value={id} />
        <Field label="Destinatario" name="to" required>
          <Input name="to" type="email" required placeholder="correo@empresa.cl" autoComplete="off" />
        </Field>
        <Field label="Comentario para el destinatario" name="note">
          <Textarea name="note" rows={3} placeholder="Opcional" />
        </Field>
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Enviando…">Enviar correo</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}
