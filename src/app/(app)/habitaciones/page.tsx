import { redirect } from 'next/navigation';

export const metadata = { title: 'Novedades · Habitaciones' };

/**
 * Compatibilidad histórica. «Habitaciones» ya no es una pantalla PMS:
 * redirige al monitor de contexto operativo de Novedades.
 */
export default function RoomContextCompatibilityRoute() {
  redirect('/libro/habitaciones');
}
