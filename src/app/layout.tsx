import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

/**
 * Inter es la única familia tipográfica del sistema. La jerarquía se construye
 * con tamaño, peso y color —no con fuentes distintas— y la fuente se sirve
 * desde el propio dominio para que no dependa de un tercero ni provoque salto
 * de texto al cargar.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: {
    default: 'Central de Operaciones · Hotel HW Libertad',
    template: '%s · Central de Operaciones · Hotel HW Libertad',
  },
  description:
    'Central operativa digital del Hotel HW Libertad: turnos, recepción, caja, novedades, supervisión, reservas, trazabilidad e informes.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#173442',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
