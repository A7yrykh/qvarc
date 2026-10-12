import { HttpException, HttpStatus, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { sql } from 'kysely';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Database } from '../../../../packages/db/src';
import { AuditService } from '../common/audit.service';
import { RateLimiter } from '../common/rate-limit';
import { CONFIG, DB } from '../common/tokens';
import type { AppConfig } from '../config';
import { MAIL_SENDER, type MailSender } from '../common/mail';

const hash = (s: string) => createHash('sha256').update(s).digest();
const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
export const ACCESS_TTL_SEC = 15 * 60;
const REFRESH_TTL_MS = 60 * 24 * 3600_000;

export interface GuestAccount {
  accountId: string;
  propertyId: string;
  email: string;
}

function tooMany(message = 'Слишком много попыток. Попробуйте через несколько минут.') {
  return new HttpException({ message, code: 'rate_limited' }, HttpStatus.TOO_MANY_REQUESTS);
}

/** E-mail в нижнем регистре без пробелов или null, если адрес явно неверный. */
export function normalizeEmail(input: string): string | null {
  const e = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254 ? e : null;
}

/** Вход гостя в приложение по коду из письма: пара токенов, токен обновления меняется при каждом обновлении. */
@Injectable()
export class GuestAuthService {
  private readonly ipLimit: RateLimiter;
  private readonly testCode?: string;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) config: AppConfig,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
    private readonly audit: AuditService,
  ) {
    this.ipLimit = new RateLimiter(20 * config.rateLimitFactor, 10 * 60_000);
    this.testCode = config.guestTestCode;
  }

  private emailOrThrow(raw: string) {
    const email = normalizeEmail(raw);
    if (!email) throw new HttpException({ message: 'Проверьте адрес почты', code: 'validation_error' }, HttpStatus.BAD_REQUEST);
    return email;
  }

  async requestCode(propertyId: string, rawEmail: string, ip: string | null) {
    if (!this.mail.enabled && !this.testCode) throw new ServiceUnavailableException({ message: 'Вход по почте пока не подключён. Позвоните администратору.', code: 'mail_unavailable' });
    this.ipLimit.check(`otp:${ip ?? '-'}`);
    const email = this.emailOrThrow(rawEmail);
    const recent = await this.db
      .selectFrom('guest_otp')
      .select(['created_at'])
      .where('property_id', '=', propertyId)
      .where('email', '=', email)
      .where('created_at', '>', sql<Date>`now() - interval '1 hour'`)
      .orderBy('created_at', 'desc')
      .execute();
    if (recent[0] && Date.now() - new Date(recent[0].created_at).getTime() < 60_000) throw tooMany('Код уже отправлен. Новый можно запросить через минуту.');
    if (recent.length >= 5) throw tooMany();

    // Проверка без почты: на тестовом сервере код постоянный и никуда не отправляется
    const code = this.testCode ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.db
      .insertInto('guest_otp')
      .values({ property_id: propertyId, email, code_hash: hash(`${email}:${code}`), expires_at: new Date(Date.now() + OTP_TTL_MS), ip })
      .execute();
    if (!this.testCode) {
      await this.mail.send({
        to: email,
        subject: `Код для входа: ${code}`,
        text: `Здравствуйте!\n\nКод для входа в приложение «Кварц»: ${code}\nОн действует 5 минут. Никому его не сообщайте.\n\nЕсли вы не входили в приложение, просто удалите это письмо.\n\nМесто отдыха «Кварц»`,
      });
    }
    return { sent: true, expiresInSeconds: OTP_TTL_MS / 1000 };
  }

  async verify(propertyId: string, rawEmail: string, code: string, ip: string | null) {
    this.ipLimit.check(`verify:${ip ?? '-'}`);
    const email = this.emailOrThrow(rawEmail);
    const otp = await this.db
      .selectFrom('guest_otp')
      .select(['id', 'code_hash', 'attempts', 'expires_at', 'consumed_at'])
      .where('property_id', '=', propertyId)
      .where('email', '=', email)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();
    const wrong = new HttpException({ message: 'Неверный или устаревший код', code: 'invalid_code' }, HttpStatus.BAD_REQUEST);
    if (!otp || otp.consumed_at || new Date(otp.expires_at) < new Date()) throw wrong;
    if (otp.attempts >= OTP_MAX_ATTEMPTS) throw tooMany('Слишком много неверных попыток. Запросите новый код.');
    // Попытка учитывается до сравнения: параллельные запросы не обойдут лимит
    const counted = await this.db
      .updateTable('guest_otp')
      .set((eb) => ({ attempts: eb('attempts', '+', 1) }))
      .where('id', '=', otp.id)
      .where('attempts', '<', OTP_MAX_ATTEMPTS)
      .where('consumed_at', 'is', null)
      .returning('id')
      .executeTakeFirst();
    if (!counted) throw wrong;
    const want = hash(`${email}:${code.trim()}`);
    if (!timingSafeEqual(Buffer.from(otp.code_hash), want)) throw wrong;
    const used = await this.db.updateTable('guest_otp').set({ consumed_at: new Date() }).where('id', '=', otp.id).where('consumed_at', 'is', null).returning('id').executeTakeFirst();
    if (!used) throw wrong;

    const account = await this.db
      .insertInto('guest_account')
      .values({ property_id: propertyId, email, last_login_at: new Date() })
      .onConflict((oc) => oc.columns(['property_id', 'email']).doUpdateSet({ last_login_at: new Date() }))
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.audit.write({ propertyId, actorType: 'guest', actorId: null, action: 'guest_app.login', entity: 'guest_account', entityId: account.id, ip });
    return this.issue(account.id);
  }

  private async issue(accountId: string, replaceSessionId?: string) {
    const accessToken = randomBytes(32).toString('base64url');
    const refreshToken = randomBytes(32).toString('base64url');
    await this.db.transaction().execute(async (trx) => {
      if (replaceSessionId) await trx.updateTable('guest_app_session').set({ revoked_at: new Date() }).where('id', '=', replaceSessionId).execute();
      await trx
        .insertInto('guest_app_session')
        .values({
          account_id: accountId,
          access_hash: hash(accessToken),
          access_expires_at: new Date(Date.now() + ACCESS_TTL_SEC * 1000),
          refresh_hash: hash(refreshToken),
          refresh_expires_at: new Date(Date.now() + REFRESH_TTL_MS),
        })
        .execute();
    });
    return { guestId: accountId, accessToken, refreshToken, expiresInSeconds: ACCESS_TTL_SEC };
  }

  async refresh(propertyId: string, refreshToken: string) {
    const s = await this.db
      .selectFrom('guest_app_session as s')
      .innerJoin('guest_account as a', 'a.id', 's.account_id')
      .select(['s.id', 's.account_id', 's.revoked_at', 's.refresh_expires_at'])
      .where('s.refresh_hash', '=', hash(refreshToken))
      .where('a.property_id', '=', propertyId)
      .executeTakeFirst();
    if (!s || new Date(s.refresh_expires_at) < new Date()) throw new UnauthorizedException({ message: 'Сессия закончилась. Войдите снова.', code: 'unauthorized' });
    if (s.revoked_at) {
      // Повторное использование старого токена обновления: возможна кража, закрываем все сессии гостя
      await this.db.updateTable('guest_app_session').set({ revoked_at: new Date() }).where('account_id', '=', s.account_id).where('revoked_at', 'is', null).execute();
      throw new UnauthorizedException({ message: 'Сессия закончилась. Войдите снова.', code: 'unauthorized' });
    }
    return this.issue(s.account_id, s.id);
  }

  async logout(refreshToken: string) {
    await this.db.updateTable('guest_app_session').set({ revoked_at: new Date() }).where('refresh_hash', '=', hash(refreshToken)).where('revoked_at', 'is', null).execute();
  }

  /** Гость по заголовку Authorization: Bearer <токен доступа>. */
  async resolve(propertyId: string, authorization: string | undefined): Promise<GuestAccount> {
    const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
    const fail = new UnauthorizedException({ message: 'Нужно войти', code: 'unauthorized' });
    if (!token) throw fail;
    const s = await this.db
      .selectFrom('guest_app_session as s')
      .innerJoin('guest_account as a', 'a.id', 's.account_id')
      .select(['a.id', 'a.property_id', 'a.email', 's.access_expires_at', 's.revoked_at'])
      .where('s.access_hash', '=', hash(token))
      .executeTakeFirst();
    // Учётные записи старого входа по телефону без почты больше не действуют
    if (!s || !s.email || s.revoked_at || new Date(s.access_expires_at) < new Date()) throw fail;
    if (s.property_id !== propertyId) throw new NotFoundException('Объект не найден');
    return { accountId: s.id, propertyId: s.property_id, email: s.email };
  }
}
