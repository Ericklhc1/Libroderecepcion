import { redirect } from 'next/navigation';

export const metadata = { title: 'Novedades · Habitaciones' };

/**
 * Compatibilidad de marcadores anteriores.
 *
 * AROH no es PMS ni mantiene una Central de Reservas. La ruta histórica
 * desemboca en el monitor operativo por habitación.
 */
export default function RetiredReservationCenter() {
  redirect('/libro/habitaciones');
}
