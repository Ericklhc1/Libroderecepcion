import { redirect } from 'next/navigation';

export const metadata = { title: 'Caja · cierre integrado en Mi turno' };
export const dynamic = 'force-dynamic';

/**
 * Ruta heredada.
 *
 * El cierre de Caja dejó de ser un módulo independiente: la corroboración y
 * transferencia de Caja forman parte de la preparación/cierre del turno.
 * Conservamos la URL sólo para no romper enlaces antiguos.
 */
export default function LegacyCashClosurePage() {
  redirect('/turno');
}
