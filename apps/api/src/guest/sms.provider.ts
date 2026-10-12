import { Logger } from '@nestjs/common';

export interface SmsProvider {
  readonly code: string;
  /** true: SMS на самом деле не отправляется */
  readonly isTest: boolean;
  send(phone: string, text: string): Promise<void>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

/**
 * Тестовая отправка: SMS НЕ уходит, текст пишется в журнал сервера и хранится в памяти для тестов.
 * В рабочей среде включается только явно (ALLOW_TEST_SMS=true), см. config.ts.
 */
export class TestSmsProvider implements SmsProvider {
  readonly code = 'test';
  readonly isTest = true;
  readonly outbox: { phone: string; text: string }[] = [];
  private readonly log = new Logger('TestSms');

  async send(phone: string, text: string) {
    this.outbox.push({ phone, text });
    if (this.outbox.length > 100) this.outbox.shift();
    this.log.warn(`[тест, SMS не отправлено] ${phone}: ${text}`);
  }

  lastCodeFor(phone: string): string | undefined {
    return [...this.outbox].reverse().find((m) => m.phone === phone)?.text.match(/\d{6}/)?.[0];
  }
}

/** SMS-сервис не подключён: вход в приложение гостя недоступен. */
export class NoSmsProvider implements SmsProvider {
  readonly code = 'none';
  readonly isTest = false;
  async send(): Promise<void> {
    throw new Error('SMS-сервис не подключён');
  }
}
