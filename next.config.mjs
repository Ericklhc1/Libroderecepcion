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
    función desplegada. En local funcionaba —el archivo está en
    node_modules— y en producción fallaba con "Setting up fake worker
    failed: Cannot find module .../pdf.worker.mjs".

    Se declara explícitamente para las dos rutas desde las que se leen los
    informes: el inicio de turno y la pantalla de importación.
  */
  outputFileTracingIncludes: {
    '/turno': ['./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'],
    '/habitaciones/importar': ['./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'],
  },
  experimental: {
    // Los tres informes del PMS viajan juntos en una sola acción de servidor.
    serverActions: { bodySizeLimit: '4mb' },
  },
};

export default nextConfig;
