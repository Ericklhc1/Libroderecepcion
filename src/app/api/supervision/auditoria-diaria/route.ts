import { NextResponse } from 'next/server';
import { requirePermission } from '@/server/auth/guard';
import { RuleError } from '@/server/errors';
import {
  mergeSupervisionAuditReport,
  parseSupervisionReport,
} from '@/server/services/supervision-audit-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_PDF_BYTES = 4 * 1024 * 1024;

function businessDateFrom(value: FormDataEntryValue | null): Date {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new RuleError('La fecha auditada no es válida.');
  }
  return new Date(`${raw}T00:00:00.000Z`);
}

export async function POST(request: Request) {
  try {
    const user = await requirePermission('supervision.audit.create');
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      throw new RuleError('Adjunta un informe PDF.');
    }
    if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      throw new RuleError('En esta etapa el dashboard de auditoría recibe informes PDF.');
    }
    if (file.size > MAX_PDF_BYTES) {
      throw new RuleError(
        `${file.name} supera 4 MB. Divide la carga o utiliza la versión textual del informe.`,
      );
    }

    const businessDate = businessDateFrom(formData.get('businessDate'));
    const parsed = await parseSupervisionReport(
      file.name,
      new Uint8Array(await file.arrayBuffer()),
    );
    const saved = await mergeSupervisionAuditReport(user, { businessDate, parsed });

    return NextResponse.json(
      {
        ok: true,
        savedId: saved.id,
        kind: parsed.kind,
        label: parsed.label,
        findings: parsed.findings.length,
        warnings: parsed.warnings,
        sourceFilePersisted: false,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo procesar el informe.';
    return NextResponse.json(
      { ok: false, error: message },
      { status: error instanceof RuleError ? 400 : 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
