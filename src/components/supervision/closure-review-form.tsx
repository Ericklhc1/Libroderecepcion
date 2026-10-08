import Link from 'next/link';
import { ActionForm, Field, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { reviewShiftClosureAction } from '@/server/actions/closure-review';
export function ClosureReviewLink({ shiftId }: { shiftId: string }) {
  return <Link className="no-print inline-block rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold" href={`/supervision/cierres/${shiftId}`}>Revisar cierre · Validar / Observar</Link>;
}
export function ClosureReviewForm({ shiftId, revision }: { shiftId: string; revision: string }) {
  return <div className="flex gap-2">{(['VALIDADA', 'OBSERVADA'] as const).map(decision => <Dialog key={decision} title={decision === 'VALIDADA' ? 'Validar cierre de turno' : 'Observar cierre de turno'} trigger={decision === 'VALIDADA' ? 'Validar' : 'Observar'} triggerVariant="secondary" width="sm">
    <ActionForm action={reviewShiftClosureAction} closeOnSuccess refreshOnSuccess>
      <input type="hidden" name="shiftId" value={shiftId} /><input type="hidden" name="revision" value={revision} /><input type="hidden" name="decision" value={decision} />
      <Field label={decision === 'VALIDADA' ? 'Evidencia revisada' : 'Observación que debe resolverse'} name="note" required><Textarea name="note" required maxLength={2000} rows={4} /></Field>
      <SubmitButton pendingLabel="Guardando…">Confirmar {decision === 'VALIDADA' ? 'validación' : 'observación'}</SubmitButton>
    </ActionForm>
  </Dialog>)}</div>;
}
