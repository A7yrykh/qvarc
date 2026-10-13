/** Админка ходит в API через тот же адрес: cookie сессии и CSRF работают без CORS. */
const API_URL = process.env.API_URL ?? 'http://localhost:3000';
/** Демо-сборка: статичные файлы без сервера, данные выдуманы и живут в браузере (lib/demo.ts) */
const DEMO = process.env.NEXT_PUBLIC_DEMO === '1';

const server = {
  async rewrites() {
    return [{ source: '/admin/v1/:path*', destination: `${API_URL}/admin/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default {
  reactStrictMode: true,
  poweredByHeader: false,
  // Демо берёт номера и тариф из data/ и расчёт цены из packages/domain
  experimental: { externalDir: true },
  ...(DEMO
    ? { output: 'export', basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '', trailingSlash: true, images: { unoptimized: true }, distDir: 'out-demo' }
    : server),
};
