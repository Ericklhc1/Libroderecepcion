import { withMaintenance } from '@/server/api/maintenance';
import { GET as frontiGET, POST as frontiPOST } from '../fronti/route';

/**
 * Compatibilidad con clientes antiguos.
 *
 * Fronti es el único endpoint canónico. La ruta /api/asistente se conserva
 * temporalmente como alias para no romper pestañas o clientes todavía abiertos,
 * pero no mantiene una segunda implementación ni una segunda lógica de sesión.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function GETHandler(request: Request) {
  return frontiGET(request);
}

async function POSTHandler(request: Request) {
  return frontiPOST(request);
}

export const GET = withMaintenance(GETHandler);
export const POST = withMaintenance(POSTHandler);
