import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { Public } from '../iam/auth.decorators';
import { CurrentGuest, GuestGuard, type GuestPrincipal } from './guest.guard';
import { GuestStayService } from './stay.service';

@Public()
@UseGuards(GuestGuard)
@Controller('guest/v1/bookings')
export class GuestBookingsController {
  constructor(private readonly stay: GuestStayService) {}

  /** Брони, оформленные на подтверждённый телефон гостя */
  @Get('my')
  async my(@CurrentGuest() g: GuestPrincipal) {
    const rows = await this.stay.listOwn(g);
    return Promise.all(rows.map(async (b) => this.stay.view(b, await this.stay.facts(b))));
  }

  @Get(':id')
  async get(@CurrentGuest() g: GuestPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    const b = await this.stay.getOwn(g, id);
    return this.stay.view(b, await this.stay.facts(b));
  }
}
