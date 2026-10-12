import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/** Проверка входных данных по схеме zod. Ошибка превращается в ответ 400 со списком полей. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new BadRequestException({
      message: 'Некорректные данные',
      issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return r.data;
}

export const isoDate = z.iso.date();
export const uuid = z.uuid();
export const money = z.number().int().nonnegative();
