import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { APPEARANCE_INIT_SCRIPT } from '@/domain/appearance';
import { AppearanceProvider } from '@/components/appearance/appearance-provider';

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
    default: 'AROH Central IA · Hotel HW Libertad',
    template: '%s · AROH Central IA · Hotel HW Libertad',
  },
  description:
    'AROH Central IA para Hotel HW Libertad: turnos, recepción, caja, novedades, supervisión, reservas, trazabilidad e informes.',
  robots: { index: false, follow: false },
  applicationName: 'AROH Central IA',
  appleWebApp: {
    capable: true,
    title: 'AROH Central IA',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#091820',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={inter.variable} suppressHydrationWarning>
      <head>
        <script id="aroh-appearance" dangerouslySetInnerHTML={{ __html: APPEARANCE_INIT_SCRIPT }} />
      </head>
      <body><AppearanceProvider>{children}</AppearanceProvider></body>
    </html>
  );
}
