'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionForm, Checkbox, Field, Input } from '@/components/ui/form';
import { Button, SubmitButton } from '@/components/ui/button';
import { SYSTEM_CLOSURE_CONFIRMATION, type MaintenanceState } from '@/domain/system-maintenance';
import { beginSystemClosureAction, verifyClosureBackupAction, lockSystemClosureAction, recoverSystemClosureAction } from '@/server/actions/system-closure';

export function DownloadClosureBackup({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  async function download() {
    setPending(true); setMessage('');
    try {
      const response = await fetch('/api/libro/reporte?respaldo=cierre', { cache: 'no-store' });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error || 'No se pudo generar el respaldo. Comprueba los pendientes y vuelve a intentar.');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] || 'respaldo-cierre.json';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      setMessage('Respaldo generado. Guarda el archivo, ábrelo para revisarlo y selecciónalo abajo para verificarlo.');
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo generar el respaldo.'); }
    finally { setPending(false); }
  }
  return <div className="space-y-2"><Button disabled={disabled || pending} onClick={() => void download()}>{pending ? 'Generando respaldo…' : 'Descargar respaldo actualizado'}</Button>{message && <p role="status" className="text-sm">{message}</p>}</div>;
}

function VerifyLocalBackup({ state }: { state: MaintenanceState }) {
  const [digest, setDigest] = useState('');
  const [fileProof, setFileProof] = useState('');
  const [message, setMessage] = useState('');
  const selection = useRef(0);
  async function inspect(file: File | undefined) {
    const current = ++selection.current;
    setDigest(''); setFileProof(''); setMessage('');
    if (!file) return;
    try {
      const bytes = await file.arrayBuffer();
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      const nonce = state.closure?.backup?.verificationNonce;
      if (!nonce) throw new Error('Falta el desafío de verificación del respaldo.');
      const prefix = new TextEncoder().encode(nonce);
      const challengedBytes = new Uint8Array(prefix.byteLength + bytes.byteLength);
      challengedBytes.set(prefix);
      challengedBytes.set(new Uint8Array(bytes), prefix.byteLength);
      const proofHash = await crypto.subtle.digest('SHA-256', challengedBytes);
      if (current !== selection.current) return;
      const value = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
      setDigest(value);
      setFileProof(Array.from(new Uint8Array(proofHash), byte => byte.toString(16).padStart(2, '0')).join(''));
      setMessage(value === state.closure?.backup?.digest ? 'Archivo local leído: coincide con el respaldo generado. Confirma su revisión para verificar vigencia en servidor.' : 'El archivo no coincide con el último respaldo. Selecciona el archivo correcto o genera uno nuevo.');
    } catch {
      if (current === selection.current) setMessage('No se pudo leer el archivo JSON. Selecciona de nuevo el respaldo guardado.');
    }
  }
  return <div className="space-y-3">
    <label className="block text-sm font-medium">Seleccionar el respaldo guardado<input type="file" accept=".json,application/json" className="mt-2 block w-full text-sm" onChange={event => void inspect(event.target.files?.[0])} /></label>
    <p className="text-xs text-slate-600">El archivo se lee en este navegador. Se envían su huella SHA256 y una prueba de sus bytes para comprobarlo en servidor. Esto verifica el JSON de registros y referencias; no respalda archivos binarios externos.</p>
    {message && <p role="status" className="text-sm">{message}</p>}
    <ActionForm action={verifyClosureBackupAction} refreshOnSuccess>
      <input type="hidden" name="revision" value={state.revision} /><input type="hidden" name="digest" value={digest} /><input type="hidden" name="fileProof" value={fileProof} />
      <Checkbox name="confirm" required label="Abrí y revisé el respaldo guardado: contiene los cierres y novedades completos, incluido el turno final." />
      <SubmitButton disabled={!digest || !fileProof || digest !== state.closure?.backup?.digest} pendingLabel="Verificando…">Verificar respaldo guardado</SubmitButton>
    </ActionForm>
  </div>;
}

export function SystemClosureForm({ state, ready, lockReady }: { state: MaintenanceState; ready: boolean; lockReady: boolean }) {
  if (!state.closure) return <ActionForm action={beginSystemClosureAction} refreshOnSuccess>
    <input type="hidden" name="revision" value={state.revision} />
    <Checkbox name="confirm" required label="Confirmo que se mostrará la despedida, no se iniciarán turnos nuevos y sólo se permitirá finalizar la operación pendiente." />
    <SubmitButton disabled={state.enabled || !state.valid} pendingLabel="Activando despedida…">Activar despedida y cierre operativo</SubmitButton>
  </ActionForm>;
  return <div className="space-y-6">
    {state.closure.phase === 'CLOSING' && <>
      <DownloadClosureBackup disabled={!ready} />
      {state.closure.backup && <div className="space-y-3 rounded border border-slate-200 p-4">
        <p className="break-all text-sm">Último respaldo: {state.closure.backup.filename}</p>
        <p className="break-all font-mono text-xs">SHA256: {state.closure.backup.digest}</p>
        <VerifyLocalBackup key={state.revision} state={state} />
        {state.closure.backup.verifiedAt && <p role="status" className="text-sm font-semibold">JSON de registros verificado. El bloqueo volverá a comprobar que no hay pendientes, cambios ni binarios sin respaldo verificable.</p>}
      </div>}
      <div className="space-y-3 rounded border border-red-200 bg-red-50 p-4">
        <p className="font-semibold text-red-900">Acción final: acceso exclusivo de sysadmin</p>
        <p className="text-sm text-red-950">El personal perderá acceso, incluidas las sesiones abiertas, y verá «Sistema fuera de servicio». Las cuentas y la información se conservan. Sysadmin mantendrá acceso y podrá recuperar el sistema.</p>
        <ActionForm action={lockSystemClosureAction} refreshOnSuccess>
          <input type="hidden" name="revision" value={state.revision} />
          <Field label={`Escribe ${SYSTEM_CLOSURE_CONFIRMATION}`} name="confirmation"><Input name="confirmation" required autoComplete="off" /></Field>
          <Checkbox name="confirm" required label="Autorizo específicamente el bloqueo final del personal, después de revisar y verificar el respaldo actualizado." />
          <SubmitButton variant="danger" disabled={!lockReady || !state.closure.backup?.verifiedAt} pendingLabel="Comprobando y restringiendo acceso…">Dejar acceso exclusivo a sysadmin</SubmitButton>
        </ActionForm>
      </div>
    </>}
    <details className="rounded border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-semibold">Recuperación del sistema</summary><div className="mt-3 space-y-3">
      <p className="text-sm">Restablece el acceso bajo los permisos actuales. Conserva todos los datos y la auditoría; los cron seguirán desactivados. Para un nuevo cierre habrá que generar y verificar otro respaldo.</p>
      <ActionForm action={recoverSystemClosureAction} refreshOnSuccess>
        <input type="hidden" name="revision" value={state.revision} />
        <Checkbox name="confirm" required label="Confirmo que deseo desactivar el cierre ordenado y restablecer el acceso del personal." />
        <SubmitButton variant="secondary" pendingLabel="Restableciendo acceso…">Recuperar acceso del sistema</SubmitButton>
      </ActionForm>
    </div></details>
  </div>;
}
