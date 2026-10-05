import { withMaintenance } from '@/server/api/maintenance';
import { requireUser } from '@/server/auth/guard';
import { assertScheduleArea } from '@/server/services/schedule-access';
import { getScheduleBoard } from '@/server/services/schedules';
import { scheduleCsvTemplate } from '@/domain/schedule-csv';

async function GETHandler(request: Request) {
  try {
    const user = await requireUser();
    const params = new URL(request.url).searchParams;
    const area = params.get('area');
    if (!area) return new Response('Selecciona el área desde Equipo para descargar su plantilla.', { status: 400, headers: { 'Cache-Control': 'no-store' } });
    await assertScheduleArea(user, area, 'schedule.manage');
    const board = await getScheduleBoard(user, area, params.get('malla') ?? undefined);
    return new Response(scheduleCsvTemplate(board.collaborators), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="plantilla_malla.csv"', 'Cache-Control': 'private, no-store' } });
  } catch { return new Response('Acceso no autorizado.', { status: 403, headers: { 'Cache-Control': 'no-store' } }); }
}

export const GET = withMaintenance(GETHandler);
