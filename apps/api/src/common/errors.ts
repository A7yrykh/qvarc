import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PG, pgCode } from '../../../../packages/db/src';

/** Ошибки базы, которые означают конфликт данных, а не сбой, отдаются клиенту понятным ответом. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('Error');

  catch(e: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const raw = http.getResponse<Response>();
    // Гостевое приложение ждёт ошибки в виде { error: { code, message, details } }
    const res = http.getRequest<Request>().path.startsWith('/guest/v1/') ? guestFormat(raw) : raw;
    if (e instanceof HttpException) {
      const body = e.getResponse();
      res.status(e.getStatus()).json(typeof body === 'string' ? { message: body } : body);
      return;
    }
    const code = pgCode(e);
    const msg = e instanceof Error ? e.message : String(e);
    switch (code) {
      case PG.exclusionViolation:
        res.status(HttpStatus.CONFLICT).json({ message: 'Пересечение по времени: объект уже занят', code: 'overlap' });
        return;
      case PG.checkViolation:
        res.status(HttpStatus.CONFLICT).json({ message: msg, code: 'rule_violation' });
        return;
      case PG.uniqueViolation:
        res.status(HttpStatus.CONFLICT).json({ message: 'Такая запись уже существует', code: 'duplicate' });
        return;
      case PG.foreignKeyViolation:
        res.status(HttpStatus.UNPROCESSABLE_ENTITY).json({ message: 'Ссылка на несуществующую запись', code: 'bad_reference' });
        return;
      case 'P0001': // RAISE EXCEPTION из триггеров
      case '42501':
        res.status(HttpStatus.CONFLICT).json({ message: msg, code: 'forbidden_change' });
        return;
    }
    this.log.error(msg, e instanceof Error ? e.stack : undefined);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'Внутренняя ошибка' });
  }
}

const GUEST_CODES: Record<number, string> = { 400: 'validation_error', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 422: 'unprocessable', 429: 'rate_limited', 502: 'payment_provider', 503: 'unavailable' };

function guestFormat(res: Response) {
  return {
    status(code: number) {
      return {
        json(body: { message?: string | string[]; code?: string; issues?: { path: string; message: string }[] }) {
          const message = Array.isArray(body.message) ? body.message.join('; ') : body.message ?? 'Ошибка';
          const details = body.issues?.map((i) => ({ path: i.path, message: i.message }));
          res.status(code).json({ error: { code: body.code ?? GUEST_CODES[code] ?? (code >= 500 ? 'server' : `http_${code}`), message, ...(details ? { details } : {}) } });
        },
      };
    },
  } as unknown as Response;
}
