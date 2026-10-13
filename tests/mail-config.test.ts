import { describe, expect, it } from 'vitest';
import { loadConfig } from '../apps/api/src/config';

const base = { DATABASE_URL: 'postgres://x' };

describe('настройка почты для кода входа', () => {
  it('без SMTP_URL письма идут в журнал на машине разработчика и выключены в рабочей среде', () => {
    expect(loadConfig({ ...base }).mail.mode).toBe('log');
    expect(loadConfig({ ...base, NODE_ENV: 'production', ALLOW_SANDBOX_PAYMENTS: 'true' }).mail.mode).toBe('off');
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', ALLOW_SANDBOX_PAYMENTS: 'true', MAIL_MODE: 'log' })).toThrow(/в рабочей среде нельзя/);
  });

  it('с SMTP_URL отправляет через почтовый ящик и требует адрес отправителя', () => {
    expect(() => loadConfig({ ...base, SMTP_URL: 'smtps://u:p@smtp.example.com:465' })).toThrow(/MAIL_FROM/);
    const c = loadConfig({ ...base, SMTP_URL: 'smtps://u:p@smtp.example.com:465', MAIL_FROM: 'Кварц <info@example.com>' });
    expect(c.mail).toEqual({ mode: 'smtp', smtpUrl: 'smtps://u:p@smtp.example.com:465', from: 'Кварц <info@example.com>' });
  });
});
