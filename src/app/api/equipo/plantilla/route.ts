import { withMaintenance } from '@/server/api/maintenance';
import { requireUser } from '@/server/auth/guard';
import { assertSchedulePermission } from '@/server/services/schedule-access';

async function GETHandler() {
  try {
    const user = await requireUser(); assertSchedulePermission(user, 'schedule.manage');
    return new Response('\uFEFFID_COLABORADOR;FECHA;CODIGO;INICIO;TERMINO\r\n', { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="plantilla_malla.csv"', 'Cache-Control': 'private, no-store' } });
  } catch { return new Response('Acceso no autorizado.', { status: 403, headers: { 'Cache-Control': 'no-store' } }); }
}

export const GET = withMaintenance(GETHandler);
