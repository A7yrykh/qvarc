import { Logger } from '@nestjs/common';

export const SMS_SENDER = Symbol('SMS_SENDER');

/** Отправка SMS гостю. Провайдер SMS ещё не выбран; пока есть только отладочная отправка в журнал сервера. */
export interface SmsSender {
  /** false — отправка не настроена, вход по коду недоступен */
  readonly enabled: boolean;
  send(phoneE164: string, text: string): Promise<void>;
}

/** Для разработки и тестов: код пишется в журнал сервера и хранится в памяти. В рабочей среде не включается. */
export class LogSmsSender implements SmsSender {
  readonly enabled = true;
  private readonly log = new Logger('SMS');
  readonly sent: { phone: string; text: string }[] = [];

  async send(phone: string, text: string) {
    this.sent.push({ phone, text });
    if (this.sent.length > 100) this.sent.shift();
    this.log.log(`SMS для ${phone}: ${text}`);
  }
}

export class DisabledSmsSender implements SmsSender {
  readonly enabled = false;
  async send() {
    throw new Error('SMS не настроены');
  }
}
