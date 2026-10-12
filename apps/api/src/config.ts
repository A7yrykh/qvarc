export interface AppConfig {
  databaseUrl: string;
  cookieSecure: boolean;
  sessionHours: number;
  /** Адрес модуля бронирования, куда возвращается гость после оплаты, например https://book.кварц.рус */
  bookingSiteUrl: string;
  /** Внешний адрес API: на него эквайер отправляет уведомления и с него открывается тестовая страница оплаты */
  apiPublicUrl: string;
  payments: {
    provider: 'sandbox';
    /** Секрет подписи уведомлений тестового провайдера. Настоящие ключи эквайера только в переменных окружения. */
    sandboxSecret: string;
  };
  /** Фоновые задачи (снятие просроченных удержаний). В тестах выключены, задачи вызываются напрямую. */
  jobs: boolean;
  /** Множитель лимитов частоты запросов к модулю бронирования (1 в работе, больше в тестах). */
  rateLimitFactor: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL не задан');
  const provider = (env.PAYMENT_PROVIDER ?? 'sandbox') as AppConfig['payments']['provider'];
  if (provider !== 'sandbox') throw new Error(`Неизвестный PAYMENT_PROVIDER: ${provider}`);
  if (provider === 'sandbox' && env.NODE_ENV === 'production' && env.ALLOW_SANDBOX_PAYMENTS !== 'true') {
    throw new Error('Тестовый провайдер оплаты нельзя включать в рабочей среде');
  }
  return {
    databaseUrl,
    cookieSecure: env.COOKIE_SECURE !== 'false',
    sessionHours: Number(env.SESSION_HOURS ?? 12),
    bookingSiteUrl: (env.BOOKING_SITE_URL ?? 'http://localhost:3200').replace(/\/$/, ''),
    apiPublicUrl: (env.API_PUBLIC_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
    payments: { provider, sandboxSecret: env.SANDBOX_WEBHOOK_SECRET ?? 'sandbox-dev-secret' },
    jobs: env.JOBS !== 'false',
    rateLimitFactor: 1,
  };
}
