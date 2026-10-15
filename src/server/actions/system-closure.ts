'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/server/auth/guard';
import { parseOrThrow, runAction, type ActionState } from '@/server/action';
import { beginSystemClosure, recoverSystemClosure, verifyClosureBackup, lockSystemClosure } from '@/server/services/system-closure';

const revision = z.string().regex(/^[a-f0-9]{64}$/);
const confirmed = z.literal('on');
const base = z.object({ revision, confirm: confirmed });
function refresh() { revalidatePath('/', 'layout'); revalidatePath('/admin/mantenimiento'); }

export async function beginSystemClosureAction(_state: ActionState | null, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const input = parseOrThrow(base, Object.fromEntries(form));
    await beginSystemClosure(user, { expectedRevision: input.revision });
    refresh();
    return { ok: true, message: 'Despedida activada. El personal puede finalizar su operación; el acceso exclusivo todavía no está activado.' };
  });
}

export async function verifyClosureBackupAction(_state: ActionState | null, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const input = parseOrThrow(base.extend({ digest: revision, fileProof: revision }), Object.fromEntries(form));
    await verifyClosureBackup(user, { expectedRevision: input.revision, uploadedDigest: input.digest, fileProof: input.fileProof });
    refresh();
    return { ok: true, message: 'El archivo local coincide por SHA256 con el respaldo generado y los datos siguen vigentes.' };
  });
}

export async function lockSystemClosureAction(_state: ActionState | null, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const input = parseOrThrow(base.extend({ confirmation: z.string() }), Object.fromEntries(form));
    await lockSystemClosure(user, { expectedRevision: input.revision, confirmation: input.confirmation });
    refresh();
    return { ok: true, message: 'El sistema está fuera de servicio para el personal. Sysadmin conserva administración y recuperación.' };
  });
}

export async function recoverSystemClosureAction(_state: ActionState | null, form: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const input = parseOrThrow(base, Object.fromEntries(form));
    await recoverSystemClosure(user, { expectedRevision: input.revision });
    refresh();
    return { ok: true, message: 'Cierre ordenado desactivado. Se restablece el acceso según los permisos existentes; los cron siguen desactivados.' };
  });
}
