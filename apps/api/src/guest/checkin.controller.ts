import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { isoDate, parse } from '../common/validation';
import { ClientIp, CurrentUser, Public, RequirePerms, type StaffUser } from '../iam/auth.decorators';
import { CheckinService } from './checkin.service';
import { CurrentGuest, GuestGuard, type GuestPrincipal } from './guest.guard';

const guestSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  middleName: z.string().trim().max(100).optional(),
  birthDate: isoDate.optional(),
  isChild: z.boolean().default(false),
});

const ruPassport = z.object({
  bookingGuestId: z.uuid(),
  docType: z.literal('ru_passport'),
  series: z.string().regex(/^\d{4}$/, 'Серия паспорта: 4 цифры'),
  number: z.string().regex(/^\d{6}$/, 'Номер паспорта: 6 цифр'),
  issuedBy: z.string().trim().min(3).max(300),
  issueDate: isoDate,
  divisionCode: z.string().regex(/^\d{3}-\d{3}$/, 'Код подразделения: 000-000'),
  birthPlace: z.string().trim().min(2).max(300),
  registrationAddress: z.string().trim().min(5).max(500),
  citizenship: z.literal('RU').default('RU'),
});
const foreignPassport = z.object({
  bookingGuestId: z.uuid(),
  docType: z.literal('foreign_passport'),
  series: z.string().trim().max(20).optional(),
  number: z.string().trim().min(4).max(20),
  issueDate: isoDate.optional(),
  issuedBy: z.string().trim().max(300).optional(),
  citizenship: z.string().regex(/^[A-Z]{2}$/, 'Гражданство: код страны из двух латинских букв'),
});
const birthCertificate = z.object({
  bookingGuestId: z.uuid(),
  docType: z.literal('birth_certificate'),
  series: z.string().trim().min(2).max(10),
  number: z.string().regex(/^\d{6}$/, 'Номер свидетельства: 6 цифр'),
  issueDate: isoDate.optional(),
});
const documentSchema = z.discriminatedUnion('docType', [ruPassport, foreignPassport, birthCertificate]);

/** Онлайн-регистрация в приложении гостя */
@Public()
@UseGuards(GuestGuard)
@Controller('guest/v1/checkin')
export class CheckinController {
  constructor(private readonly checkin: CheckinService) {}

  @Get(':bookingId')
  get(@CurrentGuest() g: GuestPrincipal, @Param('bookingId', ParseUUIDPipe) id: string) {
    return this.checkin.get(g, id);
  }

  @Post(':bookingId/start')
  @HttpCode(200)
  start(@CurrentGuest() g: GuestPrincipal, @Param('bookingId', ParseUUIDPipe) id: string) {
    return this.checkin.start(g, id);
  }

  @Put(':bookingId/guests')
  guests(@CurrentGuest() g: GuestPrincipal, @Param('bookingId', ParseUUIDPipe) id: string, @Body() b: unknown) {
    const { guests } = parse(z.object({ guests: z.array(guestSchema).min(1).max(30) }), b);
    return this.checkin.submitGuests(g, id, guests);
  }

  @Put(':bookingId/documents')
  documents(@CurrentGuest() g: GuestPrincipal, @Param('bookingId', ParseUUIDPipe) id: string, @Body() b: unknown) {
    const { documents } = parse(z.object({ documents: z.array(documentSchema).min(1).max(30) }), b);
    return this.checkin.submitDocuments(g, id, documents);
  }

  @Post(':bookingId/rules')
  @HttpCode(200)
  rules(@CurrentGuest() g: GuestPrincipal, @Param('bookingId', ParseUUIDPipe) id: string, @Body() b: unknown, @ClientIp() ip: string | null) {
    const { rulesVersion } = parse(
      z.object({ rulesVersion: z.string().max(50), rulesAccepted: z.literal(true), personalDataConsent: z.literal(true) }),
      b,
    );
    return this.checkin.acceptRules(g, id, rulesVersion, ip);
  }
}

/** Онлайн-регистрация гостя в админке */
@Controller('admin/v1/bookings/:id')
export class AdminCheckinController {
  constructor(private readonly checkin: CheckinService) {}

  @Get('checkin')
  @RequirePerms('booking.read')
  view(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: StaffUser) {
    return this.checkin.staffView(u, id);
  }

  @Get('guest-documents')
  @RequirePerms('booking.read', 'guest.documents.read')
  documents(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: StaffUser, @ClientIp() ip: string | null) {
    return this.checkin.staffDocuments(u, id, ip);
  }

  @Post('checkin/approve')
  @HttpCode(200)
  @RequirePerms('booking.status')
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: StaffUser) {
    return this.checkin.approve(u, id);
  }

  @Post('checkin/unit-ready')
  @HttpCode(200)
  @RequirePerms('booking.status')
  unitReady(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: StaffUser) {
    return this.checkin.unitReady(u, id);
  }
}
