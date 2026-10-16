import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RuleSettingsService } from './rule-settings.service';

const MAX_PO_BYTES = 5 * 1024 * 1024;

/** The signed-in account's rule settings (rules on/off, severity, tolerances) and its purchase orders. */
@Controller()
export class RuleSettingsController {
  constructor(private readonly settings: RuleSettingsService) {}

  @Get('rules/settings')
  get(@CurrentUser() user: PublicUser) {
    return this.settings.settings(user.id);
  }

  /** Body: RuleConfig { rules?: { [id]: { enabled?, severity? } }, params?: { ...tolerances, knownScacs? } }; replaces the stored one. */
  @Put('rules/settings')
  save(@CurrentUser() user: PublicUser, @Body() body: unknown) {
    return this.settings.save(user.id, body);
  }

  @Delete('rules/settings')
  reset(@CurrentUser() user: PublicUser) {
    return this.settings.reset(user.id);
  }

  @Get('purchase-orders')
  listPurchaseOrders(@CurrentUser() user: PublicUser) {
    return this.settings.listPurchaseOrders(user.id);
  }

  /** A CSV or JSON file in "file", or JSON orders in the body: [{ poNumber, currency?, lines: [{ sku?, description?, quantity, unit?, unitPrice? }] }]. */
  @Post('purchase-orders')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PO_BYTES } }))
  importPurchaseOrders(@CurrentUser() user: PublicUser, @UploadedFile() file: Express.Multer.File | undefined, @Body() body: unknown) {
    if (!file && (body === undefined || (typeof body === 'object' && body !== null && Object.keys(body).length === 0))) {
      throw new BadRequestException('Send a CSV or JSON file in the "file" field, or the orders as JSON');
    }
    return this.settings.importPurchaseOrders(user.id, file ? { file: { name: file.originalname, bytes: file.buffer } } : { body });
  }

  @Delete('purchase-orders/:id')
  @HttpCode(204)
  async deletePurchaseOrder(@CurrentUser() user: PublicUser, @Param('id') id: string) {
    await this.settings.deletePurchaseOrder(user.id, id);
  }
}
