import { NextResponse } from 'next/server';
import { requirePermission } from '@/server/auth/guard';
import { RuleError } from '@/server/errors';
import { calendarDateKey, hotelCalendarDate } from '@/domain/time';
import {
  mergeSupervisionAuditReport,
  parseSupervisionReport,
  SUPERVISION_AUDIT_PARSER_VERSION,
} from '@/server/services/supervision-audit-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_PDF_BYTES = 4 * 1024 * 1024;

function businessDateFrom(value: FormDataEntryValue | null, reportedBusinessDate: string | null): Date {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new RuleError('La fecha auditada no es válida.');
  }
  const resolved = raw || reportedBusinessDate || calendarDateKey(hotelCalendarDate());
  return new Date(`${resolved}T00:00:00.000Z`);
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

    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = await parseSupervisionReport(file.name, bytes);
    // Ventas por período es una fotografía mensual: se ancla al inicio declarado
    // por el propio informe, no a la fecha diaria elegida en el formulario.
    const requestedBusinessDate =
      parsed.kind === 'VENTAS_PERIODO' ? null : formData.get('businessDate');
    const businessDate = businessDateFrom(requestedBusinessDate, parsed.reportedBusinessDate);
    const selectedBusinessDate = businessDate.toISOString().slice(0, 10);

    if (
      parsed.kind !== 'VENTAS_PERIODO' &&
      typeof formData.get('businessDate') === 'string' &&
      String(formData.get('businessDate')).trim() &&
      parsed.reportedBusinessDate &&
      parsed.reportedBusinessDate !== selectedBusinessDate
    ) {
      throw new RuleError(
        `La fecha seleccionada es ${selectedBusinessDate}, pero el informe parece corresponder a ${parsed.reportedBusinessDate}. Corrige la fecha antes de cargarlo.`,
      );
    }

    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');

    const saved = await mergeSupervisionAuditReport(user, {
      businessDate,
      parsed,
      sourceFile: {
        sha256,
        size: file.size,
        parserVersion: SUPERVISION_AUDIT_PARSER_VERSION,
        reportedBusinessDate: parsed.reportedBusinessDate,
        completeness: parsed.completeness,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        savedId: saved.id,
        kind: parsed.kind,
        label: parsed.label,
        findings: parsed.findings.length,
        warnings: parsed.warnings,
        completeness: parsed.completeness,
        reportedBusinessDate: parsed.reportedBusinessDate,
        sourceFilePersisted: false,
        sourceFingerprintPersisted: true,
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
