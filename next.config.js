/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { instrumentationHook: true },
  async redirects() {
    return [
      // PiliKing: la promo pasó de Duplica a Triplica. La URL vieja sigue viva
      // (pauta ya publicada) y redirige a la nueva, conservando ccpp/campaign.
      { source: '/l/piliking/duplica', destination: '/l/piliking/triplica', permanent: true },
    ];
  },
};

module.exports = nextConfig;
