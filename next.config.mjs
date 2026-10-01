/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
  /*
    La librería de PDF se resuelve en tiempo de ejecución, no se empaqueta.
    Al empaquetarla, pdf.js busca su worker dentro del bundle del servidor
    —donde no existe— y la lectura de informes falla con "Setting up fake
    worker failed". Dejándola externa, Node la carga desde node_modules y el
    worker se resuelve como corresponde.
  */
  serverExternalPackages: ['pdfjs-dist'],
  /*
    El worker de pdf.js se carga en tiempo de ejecución, no con un `import`
    estático, así que el trazador de Next no lo veía y no lo copiaba a la
    función desplegada.

    La lectura PMS canónica vive en /huespedes/importar. Supervisión reutiliza
    el mismo lector para /api/supervision/auditoria-diaria. La ruta histórica
    /habitaciones/importar sólo redirige y /turno ya no procesa PDF.
  */
  outputFileTracingIncludes: {
    '/equipo': ['./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'],
    '/huespedes/importar': ['./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'],
    '/api/supervision/auditoria-diaria': ['./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'],
  },
  experimental: {
    // Los informes del PMS viajan juntos en una sola acción de servidor.
    serverActions: { bodySizeLimit: '4mb' },
  },
};

export default nextConfig;
