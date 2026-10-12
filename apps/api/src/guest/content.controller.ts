import { Controller, Get, Inject, NotFoundException, Param } from '@nestjs/common';
import type { Database } from '../../../../packages/db/src';
import { CONFIG, DB } from '../common/tokens';
import type { AppConfig } from '../config';
import { Public } from '../iam/auth.decorators';
import { guestInfo, legalDocument, legalDocuments } from './content';
import { GuestAuthService } from './guest-auth.service';

type Photo = { url: string; alt?: string };

/** Сведения о базе и документы для приложения гостя. Открыты без входа. */
@Public()
@Controller('guest/v1')
export class GuestContentController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly auth: GuestAuthService,
  ) {}

  @Get('property')
  async property() {
    const propertyId = await this.auth.property();
    const p = await this.db.selectFrom('property').select(['name', 'check_in_time', 'check_out_time']).where('id', '=', propertyId).executeTakeFirstOrThrow();
    const types = await this.db
      .selectFrom('accommodation_type')
      .select(['id', 'code', 'name', 'description', 'max_occupancy', 'amenities', 'photos'])
      .where('property_id', '=', propertyId)
      .where('is_active', '=', true)
      .orderBy('sort_order')
      .orderBy('name')
      .execute();
    const site = this.config.bookingSiteUrl;
    return {
      name: p.name,
      address: guestInfo.address,
      about: guestInfo.about,
      phones: guestInfo.phones,
      email: guestInfo.email,
      // Бронирование на своём сайте (модуль apps/booking)
      bookingUrl: site,
      checkInTime: p.check_in_time.slice(0, 5),
      checkOutTime: p.check_out_time.slice(0, 5),
      facilities: guestInfo.facilities,
      faq: guestInfo.faq,
      unitTypes: types.map((t) => ({
        id: t.id,
        code: t.code,
        name: t.name,
        summary: t.description,
        capacity: t.max_occupancy,
        bedrooms: null,
        amenities: t.amenities,
        photos: ((t.photos ?? []) as Photo[]).map((ph, i) => ({
          file: ph.url.split('/').pop() ?? `${t.code}-${i + 1}`,
          caption: ph.alt ?? `${t.name}, фото ${i + 1}`,
          url: /^https?:\/\//.test(ph.url) ? ph.url : `${site}${ph.url.startsWith('/') ? '' : '/'}${ph.url}`,
        })),
        externalId: null,
      })),
    };
  }

  @Get('documents')
  documents() {
    return legalDocuments.map(({ code, title, version, issuer }) => ({ code, title, version, issuer }));
  }

  @Get('documents/:code')
  document(@Param('code') code: string) {
    const d = legalDocument(code);
    if (!d) throw new NotFoundException({ message: 'Документ не найден', code: 'not_found' });
    return d;
  }
}
