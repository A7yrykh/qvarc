import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { parse } from '../common/validation';
import { ClientIp, CurrentUser, RequirePerms, type StaffUser } from '../iam/auth.decorators';
import { BlockBody, RatePlanBody, RatePlanTermsBody, RateRuleBody, TypeBody, UnitBody } from './inventory.schemas';
import { InventoryService } from './inventory.service';
import { RateGridService } from './rate-grid.service';
import { z } from 'zod';
import { isoDate, uuid } from '../common/validation';

const GridQuery = z
  .object({ ratePlanId: uuid, from: isoDate, to: isoDate })
  .refine((q) => q.to > q.from, { message: 'Конец периода раньше начала' });
const RuleFilter = z.object({ typeId: uuid.optional(), ratePlanId: uuid.optional(), from: isoDate.optional(), to: isoDate.optional() });

@Controller('admin/v1')
export class InventoryController {
  constructor(
    private readonly inv: InventoryService,
    private readonly grid: RateGridService,
  ) {}

  @Get('rate-grid')
  @RequirePerms('rates.read')
  rateGrid(@Query() q: unknown, @CurrentUser() u: StaffUser) {
    const g = parse(GridQuery, q);
    return this.grid.grid(u.propertyId, g.ratePlanId, g.from, g.to);
  }

  @Get('accommodation-types')
  @RequirePerms('inventory.read')
  types(@CurrentUser() u: StaffUser) {
    return this.inv.listTypes(u.propertyId);
  }

  @Post('accommodation-types')
  @RequirePerms('inventory.write')
  createType(@Body() b: unknown, @CurrentUser() user: StaffUser, @ClientIp() ip: string | null) {
    return this.inv.createType({ user, ip }, parse(TypeBody, b));
  }

  @Put('accommodation-types/:id')
  @RequirePerms('inventory.write')
  updateType(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() user: StaffUser, @ClientIp() ip: string | null) {
    return this.inv.updateType({ user, ip }, id, parse(TypeBody, b));
  }

  @Get('units')
  @RequirePerms('inventory.read')
  units(@CurrentUser() u: StaffUser) {
    return this.inv.listUnits(u.propertyId);
  }

  @Post('units')
  @RequirePerms('inventory.write')
  createUnit(@Body() b: unknown, @CurrentUser() user: StaffUser, @ClientIp() ip: string | null) {
    return this.inv.createUnit({ user, ip }, parse(UnitBody, b));
  }

  @Put('units/:id')
  @RequirePerms('inventory.write')
  updateUnit(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() user: StaffUser, @ClientIp() ip: string | null) {
    return this.inv.updateUnit({ user, ip }, id, parse(UnitBody, b));
  }

  @Post('availability-blocks')
  @RequirePerms('inventory.write')
  createBlock(@Body() b: unknown, @CurrentUser() user: StaffUser, @ClientIp() ip: string | null) {
    return this.inv.createBlock({ user, ip }, parse(BlockBody, b));
  }

  @Get('rate-plans')
  @RequirePerms('rates.read')
  ratePlans(@CurrentUser() u: StaffUser) {
    return this.inv.listRatePlans(u.propertyId);
  }

  @Post('rate-plans')
  @RequirePerms('rates.write')
  createRatePlan(@Body() b: unknown, @CurrentUser() user: StaffUser, @ClientIp() ip: string | null) {
    return this.inv.createRatePlan({ user, ip }, parse(RatePlanBody, b));
  }

  @Put('rate-plans/:id')
  @RequirePerms('rates.write')
  updateRatePlan(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() user: StaffUser, @ClientIp() ip: string | null) {
    return this.inv.updateRatePlan({ user, ip }, id, parse(RatePlanBody, b));
  }

  @Put('rate-plans/:id/terms')
  @RequirePerms('rates.write')
  updateRatePlanTerms(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() user: StaffUser, @ClientIp() ip: string | null) {
    return this.inv.updateRatePlanTerms({ user, ip }, id, parse(RatePlanTermsBody, b));
  }

  @Get('rate-rules')
  @RequirePerms('rates.read')
  rateRules(@Query() q: unknown, @CurrentUser() u: StaffUser) {
    return this.inv.listRateRules(u.propertyId, parse(RuleFilter, q));
  }

  @Post('rate-rules')
  @RequirePerms('rates.write')
  createRateRule(@Body() b: unknown, @CurrentUser() user: StaffUser, @ClientIp() ip: string | null) {
    return this.inv.createRateRule({ user, ip }, parse(RateRuleBody, b));
  }

  @Delete('rate-rules/:id')
  @RequirePerms('rates.write')
  deleteRateRule(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: StaffUser, @ClientIp() ip: string | null) {
    return this.inv.deleteRateRule({ user, ip }, id);
  }
}
