import { HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import type { Database } from '../../../../packages/db/src';
import { AuditService } from '../common/audit.service';
import { CONFIG, DB } from '../common/tokens';
import type { AppConfig } from '../config';
import type { StaffUser } from './auth.decorators';

const sha256 = (s: string) => createHash('sha256').update(s).digest();

// Подбор пароля: не больше 5 неудачных попыток за 15 минут на пару «почта + IP».
// Счётчик в памяти процесса; при нескольких экземплярах API перенести в базу.
const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 5;

@Injectable()
export class AuthService {
  private readonly fails = new Map<string, { count: number; until: number }>();
  // Настоящий хеш случайного пароля: проверка для несуществующей почты занимает столько же времени
  private readonly dummyHash = AuthService.hashPassword(randomBytes(16).toString('hex'));

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  static hashPassword(password: string) {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  async login(email: string, password: string, ip: string | null, userAgent: string | null) {
    const key = `${email.toLowerCase()}|${ip}`;
    const f = this.fails.get(key);
    if (f && f.until > Date.now() && f.count >= MAX_FAILS) {
      throw new HttpException('Слишком много попыток входа, попробуйте позже', HttpStatus.TOO_MANY_REQUESTS);
    }
    const user = await this.db
      .selectFrom('app_user')
      .select(['id', 'property_id', 'password_hash', 'is_active'])
      .where('email', '=', email)
      .executeTakeFirst();
    // Хеш проверяется всегда, чтобы время ответа не выдавало существование почты
    const ok = await argon2
      .verify(user?.password_hash ?? (await this.dummyHash), password)
      .catch(() => false);
    if (!user || !user.is_active || !ok) {
      const cur = f && f.until > Date.now() ? f : { count: 0, until: Date.now() + WINDOW_MS };
      this.fails.set(key, { count: cur.count + 1, until: cur.until });
      throw new UnauthorizedException('Неверная почта или пароль');
    }
    this.fails.delete(key);

    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.sessionHours * 3_600_000);
    await this.db
      .insertInto('session')
      .values({ user_id: user.id, token_hash: sha256(token), ip, user_agent: userAgent, expires_at: expiresAt })
      .execute();
    await this.audit.write({ propertyId: user.property_id, actorId: user.id, action: 'auth.login', entity: 'app_user', entityId: user.id, ip });
    return { token, csrf, expiresAt };
  }

  /** Смена своего пароля: нужен текущий, остальные сеансы этого сотрудника закрываются. */
  async changePassword(user: StaffUser, current: string, next: string, ip: string | null) {
    const row = await this.db.selectFrom('app_user').select('password_hash').where('id', '=', user.id).executeTakeFirstOrThrow();
    if (!(await argon2.verify(row.password_hash, current).catch(() => false))) {
      throw new UnauthorizedException('Текущий пароль неверный');
    }
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('app_user').set({ password_hash: await AuthService.hashPassword(next) }).where('id', '=', user.id).execute();
      await trx
        .updateTable('session')
        .set({ revoked_at: new Date() })
        .where('user_id', '=', user.id)
        .where('id', '!=', user.sessionId)
        .where('revoked_at', 'is', null)
        .execute();
      await this.audit.write({ propertyId: user.propertyId, actorId: user.id, action: 'auth.password_changed', entity: 'app_user', entityId: user.id, ip }, trx);
    });
  }

  async logout(sessionId: string) {
    await this.db.updateTable('session').set({ revoked_at: new Date() }).where('id', '=', sessionId).execute();
  }

  async resolve(token: string): Promise<StaffUser | null> {
    const row = await this.db
      .selectFrom('session as s')
      .innerJoin('app_user as u', 'u.id', 's.user_id')
      .select(['s.id as session_id', 'u.id', 'u.property_id', 'u.email', 'u.full_name'])
      .where('s.token_hash', '=', sha256(token))
      .where('s.revoked_at', 'is', null)
      .where('s.expires_at', '>', new Date())
      .where('u.is_active', '=', true)
      .executeTakeFirst();
    if (!row) return null;
    const perms = await this.db
      .selectFrom('user_role as ur')
      .innerJoin('role_permission as rp', 'rp.role_id', 'ur.role_id')
      .select('rp.permission_code')
      .where('ur.user_id', '=', row.id)
      .execute();
    return {
      id: row.id,
      propertyId: row.property_id,
      email: row.email,
      fullName: row.full_name,
      permissions: new Set(perms.map((p) => p.permission_code)),
      sessionId: row.session_id,
    };
  }
}
