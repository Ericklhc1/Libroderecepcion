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

export async function GET(request: Request) {
  return frontiGET(request);
}

export async function POST(request: Request) {
  return frontiPOST(request);
}
