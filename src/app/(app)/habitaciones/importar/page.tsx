import { redirect } from 'next/navigation';
import type { RawSearchParams } from '@/lib/search-params';

export const metadata = { title: 'Cargar huéspedes & reservas' };
export const dynamic = 'force-dynamic';

/**
 * Ruta histórica.
 *
 * La importación PMS tiene una sola pantalla y una sola acción canónica en
 * `/huespedes/importar`. Se conserva este redirect para marcadores, enlaces
 * antiguos y pestañas abiertas, evitando mantener dos flujos que puedan
 * aplicar reglas distintas sobre las mismas estadías.
 */
export default async function LegacyRoomImportPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  const revision = typeof params.revision === 'string' ? params.revision : null;
  if (revision) query.set('revision', revision);

  const suffix = query.toString();
  redirect(suffix ? `/huespedes/importar?${suffix}` : '/huespedes/importar');
}
