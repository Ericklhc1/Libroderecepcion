import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'AROH Central IA',
    short_name: 'AROH',
    description:
      'Central operativa para Recepción, Supervisión, Caja, reservas, alertas y Fronti.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f1f5f9',
    theme_color: '#173442',
    orientation: 'any',
    categories: ['business', 'productivity'],
  };
}
