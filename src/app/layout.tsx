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
    default: 'Libro Operativo de Recepción',
    template: '%s · Libro Operativo de Recepción',
  },
  description:
    'Sistema operativo digital de recepción hotelera: turnos, entregas, novedades, incidencias, tareas, seguimientos y alertas.',
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
