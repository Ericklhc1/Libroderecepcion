'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import { requireUser } from '@/server/auth/guard';
import { assertReceptionOperationPermission } from '@/server/services/reception-operation-gate';
import { RuleError } from '@/server/errors';
import { sendMail } from '@/server/mail';
import type { BookKind } from '@/server/services/book';

const schema = z.object({
  kind: z.enum(['entry', 'task', 'followup', 'alert']),
  id: z.string().min(1),
  to: z.string().trim().email('Indica una dirección de correo válida.').max(200),
  note: z.string().trim().max(2000).optional().transform((v) => v || null),
});

type MailRecord = {
  ref: string;
  type: string;
  title: string;
  status: string;
  detail: string | null;
  date: Date;
  owner: string | null;
  creator: string | null;
  extra: Array<[string, string | null | undefined]>;
};

function human(value: string | null | undefined) {
  if (!value) return null;
  return value.toLowerCase().replaceAll('_', ' ').replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function dateTime(date: Date) {
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Santiago',
  }).format(date);
}

async function loadRecord(kind: BookKind, id: string): Promise<MailRecord | null> {
  if (kind === 'entry') {
    const row = await prisma.operationalEntry.findUnique({
      where: { id },
      include: {
        owner: { select: { name: true } },
        createdBy: { select: { name: true } },
        department: { select: { name: true } },
      },
    });
    if (!row) return null;
    return {
      ref: `#${row.seq}`,
      type: human(row.type) ?? 'Novedad',
      title: row.title,
      status: human(row.status) ?? row.status,
      detail: row.description,
      date: row.occurredAt,
      owner: row.owner?.name ?? null,
      creator: row.createdBy.name,
      extra: [
        ['Área', row.department?.name],
        ['Categoría', row.category],
        ['Prioridad', human(row.priority)],
        ['Gravedad', human(row.severity)],
        ['Impacto', human(row.impact)],
        ['Acción inmediata', row.immediateAction],
        ['Causa', row.rootCause],
        ['Resolución', row.resolution],
      ],
    };
  }

  if (kind === 'task') {
    const row = await prisma.task.findUnique({
      where: { id },
      include: {
        assignee: { select: { name: true } },
        createdBy: { select: { name: true } },
        department: { select: { name: true } },
        entry: { select: { seq: true, title: true } },
      },
    });
    if (!row) return null;
    return {
      ref: `T#${row.seq}`,
      type: 'Tarea',
      title: row.title,
      status: human(row.status) ?? row.status,
      detail: row.description,
      date: row.createdAt,
      owner: row.assignee?.name ?? null,
      creator: row.createdBy.name,
      extra: [
        ['Área', row.department?.name],
        ['Prioridad', human(row.priority)],
        ['Caso', row.entry ? `#${row.entry.seq} · ${row.entry.title}` : null],
        ['Vencimiento', row.dueAt ? dateTime(row.dueAt) : null],
      ],
    };
  }

  if (kind === 'followup') {
    const row = await prisma.followUp.findUnique({
      where: { id },
      include: {
        owner: { select: { name: true } },
        createdBy: { select: { name: true } },
        entry: { select: { seq: true, title: true } },
        task: { select: { seq: true, title: true } },
      },
    });
    if (!row) return null;
    return {
      ref: 'Seguimiento',
      type: 'Seguimiento',
      title: row.action,
      status: human(row.status) ?? row.status,
      detail: row.nextAction ?? row.result,
      date: row.createdAt,
      owner: row.owner.name,
      creator: row.createdBy.name,
      extra: [
        ['Caso', row.entry ? `#${row.entry.seq} · ${row.entry.title}` : null],
        ['Tarea', row.task ? `T#${row.task.seq} · ${row.task.title}` : null],
        ['Programado', row.scheduledAt ? dateTime(row.scheduledAt) : null],
        ['Resultado', row.result],
      ],
    };
  }

  const row = await prisma.alert.findUnique({
    where: { id },
    include: {
      createdBy: { select: { name: true } },
      department: { select: { name: true } },
      entry: { select: { seq: true, title: true } },
    },
  });
  if (!row) return null;
  return {
    ref: 'Alerta',
    type: human(row.type) ?? 'Alerta',
    title: row.title,
    status: human(row.status) ?? row.status,
    detail: row.message,
    date: row.createdAt,
    owner: null,
    creator: row.createdBy?.name ?? 'Sistema',
    extra: [
      ['Nivel', human(row.level)],
      ['Área', row.department?.name],
      ['Caso', row.entry ? `#${row.entry.seq} · ${row.entry.title}` : null],
      ['Vencimiento', row.dueAt ? dateTime(row.dueAt) : null],
    ],
  };
}

function render(record: MailRecord, note: string | null) {
  const rows: Array<[string, string | null | undefined]> = [
    ['Referencia', record.ref],
    ['Tipo', record.type],
    ['Estado', record.status],
    ['Fecha', dateTime(record.date)],
    ['Responsable', record.owner],
    ['Registró', record.creator],
    ...record.extra,
  ].filter(([, value]) => Boolean(value)) as Array<[string, string]>;

  const text = [
    'LIBRO OPERATIVO DE RECEPCIÓN',
    `${record.ref} · ${record.type}`,
    record.title,
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    record.detail ? `Detalle:\n${record.detail}` : '',
    note ? `\nComentario para el destinatario:\n${note}` : '',
  ].filter(Boolean).join('\n');

  const table = rows
    .map(([label, value]) => `<tr><td style="padding:6px 10px;color:#64748b;font-size:12px;width:145px;vertical-align:top">${escapeHtml(label)}</td><td style="padding:6px 10px;color:#173442;font-size:13px;font-weight:600">${escapeHtml(value ?? '')}</td></tr>`)
    .join('');

  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#173442"><div style="max-width:760px;margin:0 auto;padding:24px"><div style="background:#173442;padding:16px 20px;border-radius:12px 12px 0 0"><div style="color:#d8ad52;font-size:12px;font-weight:700;letter-spacing:.08em">HOTEL HW LIBERTAD</div><div style="color:#fff;font-size:18px;font-weight:700;margin-top:4px">Libro Operativo de Recepción</div></div><div style="background:#fff;padding:20px;border-radius:0 0 12px 12px"><div style="font-size:12px;color:#64748b;font-weight:700">${escapeHtml(record.ref)} · ${escapeHtml(record.type)}</div><h1 style="font-size:20px;margin:6px 0 16px;color:#173442">${escapeHtml(record.title)}</h1><table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:8px">${table}</table>${record.detail ? `<div style="margin-top:18px"><div style="font-size:12px;font-weight:700;color:#64748b;margin-bottom:6px">DETALLE</div><div style="white-space:pre-wrap;font-size:14px;line-height:1.5">${escapeHtml(record.detail)}</div></div>` : ''}${note ? `<div style="margin-top:18px;padding:12px 14px;background:#fff8e8;border-left:4px solid #d8ad52"><div style="font-size:12px;font-weight:700;color:#64748b;margin-bottom:5px">COMENTARIO PARA EL DESTINATARIO</div><div style="white-space:pre-wrap;font-size:14px">${escapeHtml(note)}</div></div>` : ''}<div style="margin-top:20px;padding-top:12px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:11px">Enviado desde el Libro Operativo de Recepción · Hotel HW Libertad</div></div></div></body></html>`;

  return { text, html };
}

export async function sendBookItemMailAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    await assertReceptionOperationPermission(user, 'entry.edit');
    const input = parseOrThrow(schema, formDataToObject(formData));
    const record = await loadRecord(input.kind, input.id);
    if (!record) throw new RuleError('Ese registro ya no existe o no está disponible.');

    const body = render(record, input.note);
    const result = await sendMail({
      to: input.to,
      subject: `[Libro Operativo] ${record.ref} · ${record.title}`.slice(0, 180),
      text: body.text,
      html: body.html,
    });
    if (!result.sent) throw new RuleError(result.reason);

    return { ok: true as const, message: `Correo enviado a ${result.to}.` };
  });
}
