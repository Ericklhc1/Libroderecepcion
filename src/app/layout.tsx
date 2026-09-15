import type { Metadata, Viewport } from 'next';
import './globals.css';

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
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
