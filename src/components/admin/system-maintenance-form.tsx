'use client';
import { ActionForm, Checkbox } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { setSystemMaintenanceAction } from '@/server/actions/system-maintenance';
import type { MaintenanceState } from '@/domain/system-maintenance';

export function SystemMaintenanceForm({ state }: { state: MaintenanceState }) {
  return <ActionForm key={state.revision} action={setSystemMaintenanceAction} refreshOnSuccess>
    <input type="hidden" name="enabled" value={String(!state.enabled)} />
    <input type="hidden" name="revision" value={state.revision} />
    <Checkbox name="confirm" required label={state.enabled ? 'Confirmo que la actualización terminó y se puede reabrir la operación.' : 'Confirmo que se pausará la operación del personal hasta que desactive este modo.'} />
    <SubmitButton pendingLabel="Guardando…">{state.enabled ? 'Desactivar mantenimiento y reabrir' : 'Activar mantenimiento'}</SubmitButton>
  </ActionForm>;
}
