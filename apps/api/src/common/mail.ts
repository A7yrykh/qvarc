import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

export const MAIL_SENDER = Symbol('MAIL_SENDER');

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Отправка писем гостям (код входа в приложение). */
export interface MailSender {
  /** false — отправка не настроена, вход по коду недоступен */
  readonly enabled: boolean;
  send(message: MailMessage): Promise<void>;
}

/** Почта через SMTP: адрес вида smtps://логин:пароль@smtp.timeweb.ru:465, задаётся только в переменной окружения. */
export class SmtpMailSender implements MailSender {
  readonly enabled = true;
  private readonly transport: Transporter;

  constructor(smtpUrl: string, private readonly from: string) {
    this.transport = createTransport(smtpUrl);
  }

  async send(m: MailMessage) {
    await this.transport.sendMail({ from: this.from, to: m.to, subject: m.subject, text: m.text });
  }
}

/** Для разработки и тестов: письмо пишется в журнал сервера и хранится в памяти. В рабочей среде не включается. */
export class LogMailSender implements MailSender {
  readonly enabled = true;
  private readonly log = new Logger('Mail');
  readonly sent: MailMessage[] = [];

  async send(m: MailMessage) {
    this.sent.push(m);
    if (this.sent.length > 100) this.sent.shift();
    this.log.log(`Письмо для ${m.to}: ${m.subject}. ${m.text}`);
  }
}

export class DisabledMailSender implements MailSender {
  readonly enabled = false;
  async send() {
    throw new Error('Почта не настроена');
  }
}
