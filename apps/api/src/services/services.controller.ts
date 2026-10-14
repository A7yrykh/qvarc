import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../common/validation';
import { ClientIp, CurrentUser, RequirePerms, type StaffUser } from '../iam/auth.decorators';
import { ActionBody, DateQuery, EquipmentTypeBody, EquipmentUnitBody, ServiceBody, ServiceBookingBody } from './services.schemas';
import { type Actor, ServicesService } from './services.service';

const staff = (u: StaffUser, ip: string | null): Actor => ({ type: 'user', id: u.id, propertyId: u.propertyId, ip });
const ActionParam = z.enum(['confirm', 'issue', 'return', 'cancel']);

/** Доп. услуги и прокат в админке: каталог, оборудование, расписание, выдача и возврат */
@Controller('admin/v1')
export class ServicesController {
  constructor(private readonly svc: ServicesService) {}

  @Get('services')
  @RequirePerms('rental.read')
  list(@CurrentUser() u: StaffUser) {
    return this.svc.listAll(u.propertyId);
  }

  @Post('services')
  @RequirePerms('rental.manage')
  create(@CurrentUser() u: StaffUser, @ClientIp() ip: string | null, @Body() b: unknown) {
    return this.svc.createService(staff(u, ip), parse(ServiceBody, b));
  }

  @Put('services/:id')
  @RequirePerms('rental.manage')
  update(@CurrentUser() u: StaffUser, @ClientIp() ip: string | null, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.updateService(staff(u, ip), id, parse(ServiceBody, b));
  }

  @Get('services/:id/slots')
  @RequirePerms('rental.read')
  slots(@CurrentUser() u: StaffUser, @Param('id', ParseUUIDPipe) id: string, @Query('date') date: string) {
    return this.svc.slots(u.propertyId, id, parse(DateQuery, date));
  }

  @Get('equipment')
  @RequirePerms('rental.read')
  equipment(@CurrentUser() u: StaffUser) {
    return this.svc.listEquipment(u.propertyId);
  }

  @Post('equipment-types')
  @RequirePerms('rental.manage')
  createType(@CurrentUser() u: StaffUser, @ClientIp() ip: string | null, @Body() b: unknown) {
    return this.svc.createEquipmentType(staff(u, ip), parse(EquipmentTypeBody, b));
  }

  @Put('equipment-types/:id')
  @RequirePerms('rental.manage')
  updateType(@CurrentUser() u: StaffUser, @ClientIp() ip: string | null, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.updateEquipmentType(staff(u, ip), id, parse(EquipmentTypeBody, b));
  }

  @Post('equipment-types/:id/units')
  @RequirePerms('rental.manage')
  createUnit(@CurrentUser() u: StaffUser, @ClientIp() ip: string | null, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.createUnit(staff(u, ip), id, parse(EquipmentUnitBody, b));
  }

  @Put('equipment-units/:id')
  @RequirePerms('rental.manage')
  updateUnit(@CurrentUser() u: StaffUser, @ClientIp() ip: string | null, @Param('id', ParseUUIDPipe) id: string, @Body() b: unknown) {
    return this.svc.updateUnit(staff(u, ip), id, parse(EquipmentUnitBody, b));
  }

  @Get('service-bookings')
  @RequirePerms('rental.read')
  schedule(@CurrentUser() u: StaffUser, @Query('date') date: string) {
    return this.svc.schedule(u.propertyId, parse(DateQuery, date));
  }

  @Get('bookings/:id/services')
  @RequirePerms('rental.read')
  forBooking(@CurrentUser() u: StaffUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.forBooking(u.propertyId, id);
  }

  @Post('service-bookings')
  @RequirePerms('rental.manage')
  book(@CurrentUser() u: StaffUser, @ClientIp() ip: string | null, @Body() b: unknown) {
    return this.svc.book(staff(u, ip), parse(ServiceBookingBody, b), 'admin');
  }

  @Get('service-bookings/:id')
  @RequirePerms('rental.read')
  get(@CurrentUser() u: StaffUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.propertyId, id);
  }

  @Post('service-bookings/:id/:action')
  @HttpCode(200)
  @RequirePerms('rental.manage')
  act(@CurrentUser() u: StaffUser, @ClientIp() ip: string | null, @Param('id', ParseUUIDPipe) id: string, @Param('action') action: string, @Body() b: unknown) {
    return this.svc.act(staff(u, ip), id, parse(ActionParam, action), parse(ActionBody, b ?? {}));
  }
}
