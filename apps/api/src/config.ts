import type { SberConfig } from './payments/sber.provider';

export interface AppConfig {
  databaseUrl: string;
  cookieSecure: boolean;
  sessionHours: number;
  /** Адрес модуля бронирования, куда возвращается гость после оплаты, например https://book.кварц.рус */
  bookingSiteUrl: string;
  /** Внешний адрес API: на него эквайер отправляет уведомления и с него открывается тестовая страница оплаты */
  apiPublicUrl: string;
  payments: {
    provider: 'sandbox' | 'sber';
    /** Секрет подписи уведомлений тестового провайдера. Настоящие ключи эквайера только в переменных окружения. */
    sandboxSecret: string;
    sber?: SberConfig;
  };
  /** Фоновые задачи (снятие просроченных удержаний). В тестах выключены, задачи вызываются напрямую. */
  jobs: boolean;
  /** Множитель лимитов частоты запросов к модулю бронирования (1 в работе, больше в тестах). */
  rateLimitFactor: number;
  guest: GuestAppConfig;
}

/** Приложение гостя для iPhone (адреса guest/v1/...). */
export interface GuestAppConfig {
  /** Объект, с которым работает приложение */
  propertyCode: string;
  /**
   * 32 байта: шифрование паспортных данных и подпись SMS-кодов. Только из переменной GUEST_DATA_KEY.
   * Без ключа вход в приложение и заселение отвечают «не настроено», остальной API работает как раньше.
   */
  dataKey: Buffer | null;
  /** test: SMS не уходит, код пишется в журнал сервера (не для работы). none: вход по SMS выключен. */
  sms: 'test' | 'none';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL не задан');
  const provider = (env.PAYMENT_PROVIDER ?? 'sandbox') as AppConfig['payments']['provider'];
  if (provider !== 'sandbox' && provider !== 'sber') throw new Error(`Неизвестный PAYMENT_PROVIDER: ${provider}`);
  let sber: SberConfig | undefined;
  if (provider === 'sber') {
    if (!env.SBER_USERNAME || !env.SBER_PASSWORD) throw new Error('Для оплаты через Сбер нужны SBER_USERNAME и SBER_PASSWORD');
    const format = env.SBER_API_FORMAT ?? 'json';
    if (format !== 'json' && format !== 'form') throw new Error('SBER_API_FORMAT: json или form');
    sber = {
      apiUrl: (env.SBER_API_URL ?? 'https://ecomtest.sberbank.ru/ecomm/gw/partner/api/v1/').replace(/\/?$/, '/'),
      userName: env.SBER_USERNAME,
      password: env.SBER_PASSWORD,
      format,
      callbackSecret: env.SBER_CALLBACK_SECRET || undefined,
      callbackUrl: env.SBER_CALLBACK_URL || undefined,
      sessionTimeoutSecs: Number(env.SBER_SESSION_TIMEOUT_SECS ?? 1200),
    };
  }
  if (provider === 'sandbox' && env.NODE_ENV === 'production' && env.ALLOW_SANDBOX_PAYMENTS !== 'true') {
    throw new Error('Тестовый провайдер оплаты нельзя включать в рабочей среде');
  }
  const sms = (env.SMS_PROVIDER ?? (env.NODE_ENV === 'production' ? 'none' : 'test')) as GuestAppConfig['sms'];
  if (sms !== 'test' && sms !== 'none') throw new Error(`Неизвестный SMS_PROVIDER: ${sms}`);
  if (sms === 'test' && env.NODE_ENV === 'production' && env.ALLOW_TEST_SMS !== 'true') {
    throw new Error('Тестовую отправку SMS нельзя включать в рабочей среде');
  }
  let dataKey: Buffer | null = null;
  if (env.GUEST_DATA_KEY) {
    dataKey = Buffer.from(env.GUEST_DATA_KEY, 'base64');
    if (dataKey.length !== 32) throw new Error('GUEST_DATA_KEY: нужно 32 байта в base64 (openssl rand -base64 32)');
  }
  return {
    databaseUrl,
    cookieSecure: env.COOKIE_SECURE !== 'false',
    sessionHours: Number(env.SESSION_HOURS ?? 12),
    bookingSiteUrl: (env.BOOKING_SITE_URL ?? 'http://localhost:3200').replace(/\/$/, ''),
    apiPublicUrl: (env.API_PUBLIC_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
    payments: { provider, sandboxSecret: env.SANDBOX_WEBHOOK_SECRET ?? 'sandbox-dev-secret', sber },
    jobs: env.JOBS !== 'false',
    rateLimitFactor: 1,
    guest: { propertyCode: env.GUEST_PROPERTY_CODE ?? 'qvarc-uvildy', dataKey, sms },
  };
}
