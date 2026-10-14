import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { parse } from '../common/validation';
import { ClientIp, CurrentUser, RequirePerms, type StaffUser } from '../iam/auth.decorators';
import { CategoryBody, CompetitorBody, DecideBody, FloorBody, ManualPriceBody, PricesQuery, RecQuery, SettingsBody } from './pricing.schemas';
import { PricingService } from './pricing.service';

/** Цены соседей и цена «дешевле соседей, но не ниже минимума» */
@Controller('admin/v1/pricing')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get('settings')
  @RequirePerms('rates.read')
  settings(@CurrentUser() u: StaffUser) {
    return this.pricing.settings(u.propertyId);
  }

  @Put('settings')
  @RequirePerms('rates.write')
  updateSettings(@Body() b: unknown, @CurrentUser() user: StaffUser, @ClientIp() ip: string | null) {
    return this.pricing.updateSettings({ user, ip }, parse(SettingsBody, b));
  }

  @Get('competitors')
  @RequirePerms('rates.read')
  competitors(@CurrentUser() u: StaffUser) {
    return this.pricing.listCompetitors(u.propertyId);
  }

  @Post('competitors')
  @RequirePerms('rates.write')
  createCompetitor(@Body() b: unknown, @CurrentUser() user: StaffUser, @ClientIp() ip: string | null) {
    return this.pricing.createCompetitor({ user, ip }, parse(CompetitorBody, b));
  }

  @Post('competitors/presets')
  @RequirePerms('rates.write')
  presets(@CurrentUser() user: StaffUser, @ClientIp() ip: string | null) {
    return this.pricing.addPresets({ user, ip });
  }

  @Put('competitors/:id')
  @RequirePerms('rates.write')
  updateCompetitor(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() user: StaffUser, @ClientIp() ip: string | null) {
    return this.pricing.updateCompetitor({ user, ip }, id, parse(CompetitorBody, b));
  }

  @Put('competitors/:id/categories')
  @RequirePerms('rates.write')
  upsertCategory(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() user: StaffUser, @ClientIp() ip: string | null) {
    return this.pricing.upsertCategory({ user, ip }, id, parse(CategoryBody, b));
  }

  @Post('competitors/:id/collect')
  @HttpCode(200)
  @RequirePerms('rates.write')
  collect(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: StaffUser) {
    return this.pricing.collectOne(u.propertyId, id);
  }

  @Post('competitor-prices')
  @RequirePerms('rates.write')
  manualPrices(@Body() b: unknown, @CurrentUser() user: StaffUser, @ClientIp() ip: string | null) {
    return this.pricing.addManualPrices({ user, ip }, parse(ManualPriceBody, b));
  }

  @Get('competitor-prices')
  @RequirePerms('rates.read')
  prices(@Query() q: unknown, @CurrentUser() u: StaffUser) {
    const p = parse(PricesQuery, q);
    return this.pricing.latestPrices(u.propertyId, p.from, p.to);
  }

  @Get('floors')
  @RequirePerms('rates.read')
  floors(@CurrentUser() u: StaffUser) {
    return this.pricing.listFloors(u.propertyId);
  }

  @Post('floors')
  @RequirePerms('rates.write')
  createFloor(@Body() b: unknown, @CurrentUser() user: StaffUser, @ClientIp() ip: string | null) {
    return this.pricing.createFloor({ user, ip }, parse(FloorBody, b));
  }

  @Delete('floors/:id')
  @RequirePerms('rates.write')
  deleteFloor(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: StaffUser, @ClientIp() ip: string | null) {
    return this.pricing.deleteFloor({ user, ip }, id);
  }

  /** Собрать цены всех соседей и пересчитать предложения сейчас, не дожидаясь расписания */
  @Post('run')
  @HttpCode(200)
  @RequirePerms('rates.write')
  async run(@CurrentUser() u: StaffUser) {
    const collected = await this.pricing.collectAll(u.propertyId);
    const result = await this.pricing.recompute(u.propertyId, u.id);
    return { collected, ...result };
  }

  @Get('recommendations')
  @RequirePerms('rates.read')
  recommendations(@Query() q: unknown, @CurrentUser() u: StaffUser) {
    return this.pricing.listRecommendations(u.propertyId, parse(RecQuery, q));
  }

  @Post('recommendations/decide')
  @HttpCode(200)
  @RequirePerms('rates.write')
  decide(@Body() b: unknown, @CurrentUser() user: StaffUser, @ClientIp() ip: string | null) {
    const d = parse(DecideBody, b);
    return this.pricing.decide({ user, ip }, d.ids, d.accept);
  }

  @Post('auto-prices/remove')
  @HttpCode(200)
  @RequirePerms('rates.write')
  removeAuto(@CurrentUser() user: StaffUser, @ClientIp() ip: string | null) {
    return this.pricing.removeAutoPrices({ user, ip });
  }

  @Get('journal')
  @RequirePerms('rates.read')
  journal(@CurrentUser() u: StaffUser) {
    return this.pricing.journal(u.propertyId);
  }
}
