import { HttpException, HttpStatus, Inject, Injectable, Logger, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { sql } from 'kysely';
import type { Database } from '../../../../packages/db/src';
import { AuditService } from '../common/audit.service';
import { CONFIG, DB } from '../common/tokens';
import type { AppConfig } from '../config';
import { deriveKey, hmac, randomDigits, randomToken, sameBytes, sha256 } from './guest-crypto';
import type { GuestPrincipal } from './guest.guard';
import { SMS_PROVIDER, type SmsProvider } from './sms.provider';

const OTP_TTL_MS = 5 * 60_000;
const ACCESS_TTL_S = 15 * 60;
const REFRESH_TTL_MS = 30 * 24 * 3600_000;
const tooMany = (message = 'Слишком много попыток, попробуйте позже') =>
  new HttpException({ message, code: 'too_many_requests' }, HttpStatus.TOO_MANY_REQUESTS);
const badCode = () => new UnprocessableEntityException({ message: 'Код неверный или устарел. Запросите новый.', code: 'otp_invalid' });

/** Вход гостя по SMS-коду и сессии приложения. */
@Injectable()
export class GuestAuthService {
  private readonly log = new Logger('GuestAuth');
  private propertyId: string | null = null;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    private readonly audit: AuditService,
  ) {}

  /** Объект, с которым работает приложение (GUEST_PROPERTY_CODE). */
  async property(): Promise<string> {
    if (this.propertyId) return this.propertyId;
    const p = await this.db.selectFrom('property').select('id').where('code', '=', this.config.guest.propertyCode).executeTakeFirst();
    if (!p) throw new ServiceUnavailableException({ message: 'Приложение гостя не настроено', code: 'not_configured' });
    this.propertyId = p.id;
    return p.id;
  }

  private otpKey() {
    const key = this.config.guest.dataKey;
    if (!key) throw new ServiceUnavailableException({ message: 'Вход в приложение пока не настроен', code: 'not_configured' });
    return deriveKey(key, 'otp');
  }

  async requestCode(phone: string, ip: string | null) {
    const key = this.otpKey();
    if (this.sms.code === 'none') {
      throw new ServiceUnavailableException({ message: 'Вход по SMS пока не подключён. Позвоните администратору.', code: 'sms_not_configured' });
    }
    const propertyId = await this.property();
    // Лимиты по номеру считаются в базе: работают и при нескольких копиях API
    const recent = await this.db
      .selectFrom('guest_otp')
      .select([
        sql<number>`count(*) FILTER (WHERE created_at > now() - interval '60 seconds')::int`.as('last_minute'),
        sql<number>`count(*)::int`.as('last_hour'),
      ])
      .where('property_id', '=', propertyId)
      .where('phone_e164', '=', phone)
      .where('created_at', '>', sql<Date>`now() - interval '1 hour'`)
      .executeTakeFirstOrThrow();
    if (recent.last_minute > 0) throw tooMany('Код уже отправлен. Повторно можно запросить через минуту.');
    if (recent.last_hour >= 5) throw tooMany();

    const code = randomDigits(6);
    await this.db
      .insertInto('guest_otp')
      .values({ property_id: propertyId, phone_e164: phone, code_hash: hmac(key, `${phone}:${code}`), expires_at: new Date(Date.now() + OTP_TTL_MS), request_ip: ip })
      .execute();
    try {
      await this.sms.send(phone, `Код для входа в приложение «Кварц»: ${code}. Никому его не сообщайте.`);
    } catch (e) {
      this.log.error(`SMS не отправлено: ${e instanceof Error ? e.message : e}`);
      throw new ServiceUnavailableException({ message: 'Не удалось отправить SMS, попробуйте позже', code: 'sms_failed' });
    }
    return { sent: true, expiresInSeconds: OTP_TTL_MS / 1000, demo: this.sms.isTest };
  }

  async verify(phone: string, code: string, userAgent: string | null, ip: string | null) {
    const key = this.otpKey();
    const propertyId = await this.property();
    const failed = await this.db
      .selectFrom('guest_otp')
      .select(sql<number>`coalesce(sum(attempts), 0)::int`.as('n'))
      .where('property_id', '=', propertyId)
      .where('phone_e164', '=', phone)
      .where('created_at', '>', sql<Date>`now() - interval '1 hour'`)
      .executeTakeFirstOrThrow();
    if (failed.n >= 10) throw tooMany();

    const result = await this.db.transaction().execute(async (trx) => {
      const ch = await trx
        .selectFrom('guest_otp')
        .select(['id', 'code_hash', 'attempts', 'max_attempts'])
        .where('property_id', '=', propertyId)
        .where('phone_e164', '=', phone)
        .where('consumed_at', 'is', null)
        .where('expires_at', '>', new Date())
        .orderBy('created_at', 'desc')
        .limit(1)
        .forUpdate()
        .executeTakeFirst();
      if (!ch || ch.attempts >= ch.max_attempts) return null;
      if (!sameBytes(ch.code_hash, hmac(key, `${phone}:${code}`))) {
        // Неудачная попытка фиксируется, ответ об ошибке уходит после фиксации
        await trx.updateTable('guest_otp').set({ attempts: ch.attempts + 1 }).where('id', '=', ch.id).execute();
        return null;
      }
      await trx.updateTable('guest_otp').set({ consumed_at: new Date() }).where('id', '=', ch.id).execute();
      const account = await trx
        .insertInto('guest_account')
        .values({ property_id: propertyId, phone_e164: phone, verified_at: new Date() })
        .onConflict((oc) => oc.columns(['property_id', 'phone_e164']).doUpdateSet({ verified_at: new Date() }))
        .returning('id')
        .executeTakeFirstOrThrow();
      const tokens = await this.issue(trx, account.id, userAgent);
      await this.audit.write({ propertyId, actorType: 'guest', actorId: account.id, action: 'guest_app.login', entity: 'guest_account', entityId: account.id, ip }, trx);
      return { guestId: account.id, ...tokens };
    });
    if (!result) throw badCode();
    return result;
  }

  private async issue(trx: Database, accountId: string, userAgent: string | null, sessionId?: string) {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const values = {
      access_hash: sha256(accessToken),
      access_expires_at: new Date(Date.now() + ACCESS_TTL_S * 1000),
      refresh_hash: sha256(refreshToken),
      expires_at: new Date(Date.now() + REFRESH_TTL_MS),
    };
    if (sessionId) await trx.updateTable('guest_session').set(values).where('id', '=', sessionId).execute();
    else await trx.insertInto('guest_session').values({ account_id: accountId, user_agent: userAgent, ...values }).execute();
    return { accessToken, refreshToken, expiresInSeconds: ACCESS_TTL_S };
  }

  /** Новая пара токенов; старый токен обновления сразу перестаёт действовать. */
  async refresh(refreshToken: string) {
    const r = await this.db.transaction().execute(async (trx) => {
      const s = await trx
        .selectFrom('guest_session')
        .select(['id', 'account_id'])
        .where('refresh_hash', '=', sha256(refreshToken))
        .where('revoked_at', 'is', null)
        .where('expires_at', '>', new Date())
        .forUpdate()
        .executeTakeFirst();
      if (!s) return null;
      return { guestId: s.account_id, ...(await this.issue(trx, s.account_id, null, s.id)) };
    });
    if (!r) throw new HttpException({ message: 'Сессия истекла, войдите снова', code: 'unauthorized' }, HttpStatus.UNAUTHORIZED);
    return r;
  }

  async logout(refreshToken: string) {
    await this.db
      .updateTable('guest_session')
      .set({ revoked_at: new Date() })
      .where('refresh_hash', '=', sha256(refreshToken))
      .where('revoked_at', 'is', null)
      .execute();
  }

  async resolve(accessToken: string): Promise<GuestPrincipal | null> {
    const row = await this.db
      .selectFrom('guest_session as s')
      .innerJoin('guest_account as a', 'a.id', 's.account_id')
      .select(['s.id as session_id', 'a.id', 'a.property_id', 'a.phone_e164'])
      .where('s.access_hash', '=', sha256(accessToken))
      .where('s.revoked_at', 'is', null)
      .where('s.access_expires_at', '>', new Date())
      .executeTakeFirst();
    return row ? { accountId: row.id, propertyId: row.property_id, phone: row.phone_e164, sessionId: row.session_id } : null;
  }

  /** Удаление старых кодов и закончившихся сессий (фоновая задача). */
  async cleanup() {
    await this.db.deleteFrom('guest_otp').where('created_at', '<', sql<Date>`now() - interval '1 day'`).execute();
    await this.db.deleteFrom('guest_session').where('expires_at', '<', sql<Date>`now() - interval '1 day'`).execute();
  }
}
