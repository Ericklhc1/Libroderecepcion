'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import { saveMailConfig, sendMailTest } from '@/server/services/mail-settings';

/**
 * Acciones de la consola de correo.
 *
 * Sólo `system.configure`, que en la matriz tiene el Administrador de sistema:
 * la casilla del hotel y su clave no son configuración operativa, y el
 * Supervisor no las toca.
 *
 * Ningún campo de clave vuelve al navegador, así que el formulario se envía sin
 * ellas cuando no se están cambiando y el servidor conserva las guardadas.
 */

/** Un puerto que llega vacío es «sin configurar», no un cero. */
const optionalPort = z
  .union([z.literal(''), z.coerce.number().int().positive().max(65535)])
  .optional()
  .transform((value) => (value === '' || value === undefined ? null : value));

const optionalText = z
  .string()
  .max(200)
  .optional()
  .transform((value) => value?.trim() || null);

const mailConfigSchema = z.object({
  smtpHost: optionalText,
  smtpPort: optionalPort,
  smtpUser: optionalText,
  smtpPassword: z.string().max(200).optional(),
  mailFrom: optionalText,
  credentialsMailTo: optionalText,
  inboundProtocol: z
    .union([z.literal(''), z.enum(['IMAP', 'POP3'])])
    .optional()
    .transform((value) => (value === '' || value === undefined ? null : value)),
  inboundHost: optionalText,
  inboundPort: optionalPort,
  inboundUser: optionalText,
  inboundPassword: z.string().max(200).optional(),
  clearSmtpPassword: z.coerce.boolean().optional(),
  clearInboundPassword: z.coerce.boolean().optional(),
});

export async function saveMailConfigAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requirePermission('system.configure');
    const input = parseOrThrow(mailConfigSchema, formDataToObject(formData));

    const result = await saveMailConfig(actor, input);

    revalidatePath('/admin/correo');
    revalidatePath('/admin/usuarios');

    /*
      Los avisos se devuelven como parte del mensaje de éxito, no como error:
      se guardó de verdad, y lo que sigue es una advertencia sobre lo guardado.
    */
    const base = result.canSend
      ? 'Configuración de correo guardada. Envía una prueba para confirmar que funciona.'
      : 'Configuración guardada. Todavía falta el servidor de salida para poder enviar.';

    return {
      ok: true as const,
      message:
        result.warnings.length > 0
          ? `${base} Ojo: ${result.warnings.map((warning) => warning.message).join(' ')}`
          : base,
    };
  });
}

const mailTestSchema = z.object({ to: z.string().email('Indica una dirección válida.') });

export async function sendMailTestAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requirePermission('system.configure');
    const input = parseOrThrow(mailTestSchema, formDataToObject(formData));

    const result = await sendMailTest(actor, input);
    revalidatePath('/admin/correo');

    /*
      Una prueba que falla NO es un error de la acción: la acción hizo su
      trabajo —intentó y averiguó qué pasa—. Se devuelve como éxito con el
      detalle del servidor, que es justo lo que hay que leer para corregir.
    */
    return {
      ok: true as const,
      message: result.ok
        ? `Correo de prueba enviado a ${result.to}. Revisa la casilla.`
        : `No se pudo enviar: ${result.detail}`,
    };
  });
}
