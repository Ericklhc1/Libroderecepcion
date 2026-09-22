import { redirect } from 'next/navigation';

export const metadata = { title: 'Huéspedes PMS retirados' };

/**
 * Ruta operativa retirada en v1.4.0.
 *
 * El Libro ya no administra PMS, habitaciones, huéspedes ni llaves. Se mantiene
 * la ruta únicamente para que marcadores y enlaces históricos lleguen al nuevo
 * núcleo operativo sin reactivar consultas legadas.
 */
export default function RetiredOperationalRoute() {
  redirect('/libro');
}
