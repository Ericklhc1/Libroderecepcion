'use server';

import { z } from 'zod';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import { RuleError } from '@/server/errors';
import { sendMail } from '@/server/mail';
import { buildSupervisorReport, reportDateRange } from '@/server/services/supervisor-reports';
import { createTextPdf } from '@/server/reports/simple-pdf';

const schema = z.object({
  type: z.enum(['gimnasio', 'multas', 'estado']),
  from: z.string().optional(),
  toDate: z.string().optional(),
  recipients: z.string().trim().min(3).max(1200),
});

export async function sendSupervisorReportAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('supervision.view');
    const input = parseOrThrow(schema, formDataToObject(formData));
    const recipients = input.recipients
      .split(/[;,\n]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (recipients.length === 0 || recipients.length > 20) {
      throw new RuleError('Indica entre 1 y 20 destinatarios.');
    }
    const email = z.string().email();
    const invalid = recipients.find((recipient) => !email.safeParse(recipient).success);
    if (invalid) throw new RuleError(`El destinatario «${invalid}» no es un correo válido.`);

    const range = reportDateRange(input.from, input.toDate);
    const report = await buildSupervisorReport(input.type, range);
    const pdf = createTextPdf({
      title: report.title,
      subtitle: `${formatDate(range.from)} a ${formatDate(range.to)}`,
      lines: [...report.summary, '', ...report.lines],
    });
    const result = await sendMail({
      to: recipients.join(', '),
      subject: `[Libro Operativo] ${report.title}`,
      text:
        `${report.title}\n` +
        `Período: ${range.from.toLocaleDateString('es-CL')} a ${range.to.toLocaleDateString('es-CL')}\n` +
        `Generado por: ${user.name}\n\n` +
        `${report.summary.join('\n')}\n\nEl informe completo va adjunto en PDF.`,
      attachments: [{ filename: report.filename, content: pdf, contentType: 'application/pdf' }],
    });
    if (!result.sent) throw new RuleError(result.reason);
    return {
      ok: true as const,
      message: `Informe enviado en PDF a ${recipients.length} destinatario(s).`,
    };
  });
}
