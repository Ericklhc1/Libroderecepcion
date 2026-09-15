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
  experimental: {
    // Los tres informes del PMS viajan juntos en una sola acción de servidor.
    serverActions: { bodySizeLimit: '4mb' },
  },
};

export default nextConfig;
