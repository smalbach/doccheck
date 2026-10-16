import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { CurrentOrg } from '../orgs/current-org.decorator';
import type { OrgContext } from '../orgs/org.types';
import { Permission } from '../orgs/permissions';
import { RuleSettingsService } from './rule-settings.service';

const MAX_PO_BYTES = 5 * 1024 * 1024;

/** The active organization's rule settings (rules on/off, severity, tolerances) and its purchase orders. */
@Controller()
export class RuleSettingsController {
  constructor(private readonly settings: RuleSettingsService) {}

  @Get('rules/settings')
  @Permission('data.read')
  get(@CurrentOrg() org: OrgContext) {
    return this.settings.settings(org.id);
  }

  /** Body: RuleConfig { rules?: { [id]: { enabled?, severity? } }, params?: { ...tolerances, knownScacs? } }; replaces the stored one. */
  @Put('rules/settings')
  @Permission('org.settings')
  save(@CurrentOrg() org: OrgContext, @CurrentUser() user: PublicUser, @Body() body: unknown) {
    return this.settings.save(org.id, user.id, body);
  }

  @Delete('rules/settings')
  @Permission('org.settings')
  reset(@CurrentOrg() org: OrgContext) {
    return this.settings.reset(org.id);
  }

  @Get('purchase-orders')
  @Permission('data.read')
  listPurchaseOrders(@CurrentOrg() org: OrgContext) {
    return this.settings.listPurchaseOrders(org.id);
  }

  /** A CSV or JSON file in "file", or JSON orders in the body: [{ poNumber, currency?, lines: [{ sku?, description?, quantity, unit?, unitPrice? }] }]. */
  @Post('purchase-orders')
  @Permission('shipment.write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PO_BYTES } }))
  importPurchaseOrders(@CurrentOrg() org: OrgContext, @CurrentUser() user: PublicUser, @UploadedFile() file: Express.Multer.File | undefined, @Body() body: unknown) {
    if (!file && (body === undefined || (typeof body === 'object' && body !== null && Object.keys(body).length === 0))) {
      throw new BadRequestException('Send a CSV or JSON file in the "file" field, or the orders as JSON');
    }
    return this.settings.importPurchaseOrders(org.id, user.id, file ? { file: { name: file.originalname, bytes: file.buffer } } : { body });
  }

  @Delete('purchase-orders/:id')
  @Permission('shipment.write')
  @HttpCode(204)
  async deletePurchaseOrder(@CurrentOrg() org: OrgContext, @Param('id') id: string) {
    await this.settings.deletePurchaseOrder(org.id, id);
  }
}
