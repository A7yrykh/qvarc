/** Админка ходит в API через тот же адрес: cookie сессии и CSRF работают без CORS. */
const API_URL = process.env.API_URL ?? 'http://localhost:3000';

export default {
  reactStrictMode: true,
  poweredByHeader: false,
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
