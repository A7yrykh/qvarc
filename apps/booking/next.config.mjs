/** Модуль бронирования ходит в API через тот же адрес, CORS не нужен. */
const API_URL = process.env.API_URL ?? 'http://localhost:3000';
// Сайты, на которых модуль можно встроить во фрейм (кварц.рус). Список задаётся переменной окружения.
const FRAME_ANCESTORS = process.env.FRAME_ANCESTORS ?? "'self' https://xn--80adx0a4a.xn--p1acf https://*.xn--80adx0a4a.xn--p1acf";

export default {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/public/v1/:path*', destination: `${API_URL}/public/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: `frame-ancestors ${FRAME_ANCESTORS}` },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      // Ссылка гостя на бронь не должна попадать в Referer сторонних сайтов
      { source: '/b/:path*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'X-Robots-Tag', value: 'noindex' }] },
    ];
  },
};
