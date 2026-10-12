import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { parse } from '../common/validation';
import { ClientIp, CurrentUser, RequirePerms, type StaffUser } from '../iam/auth.decorators';
import { GuestBody, GuestsService } from './guests.service';

@Controller('admin/v1/guests')
export class GuestsController {
  constructor(private readonly guests: GuestsService) {}

  @Get()
  @RequirePerms('guest.read')
  search(@Query('q') q: string | undefined, @CurrentUser() u: StaffUser) {
    return this.guests.search(u, q ?? '');
  }

  @Get(':id')
  @RequirePerms('guest.read')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: StaffUser, @ClientIp() ip: string | null) {
    return this.guests.get(u, id, ip);
  }

  @Post()
  @RequirePerms('guest.write')
  create(@Body() b: unknown, @CurrentUser() u: StaffUser) {
    return this.guests.create(u.propertyId, parse(GuestBody, b));
  }

  @Put(':id')
  @RequirePerms('guest.write', 'guest.contacts.read')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() u: StaffUser, @ClientIp() ip: string | null) {
    return this.guests.update(u, id, parse(GuestBody, b), ip);
  }
}
