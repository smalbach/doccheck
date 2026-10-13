import { BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, Param, Post, Put, Query, Res, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { Isf } from '@doccheck/schemas';
import type { Response } from 'express';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ShipmentOwnerGuard } from './shipment-owner.guard';
import { CreateShipmentDto, ReextractDto, ValidateShipmentDto } from './shipments.dto';
import { ShipmentsService } from './shipments.service';

const MAX_PDF_BYTES = 20 * 1024 * 1024;

/** Every route with :id is limited to the signed-in user's shipments (ShipmentOwnerGuard). */
@Controller('shipments')
@UseGuards(ShipmentOwnerGuard)
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}

  @Post()
  create(@CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(CreateShipmentDto)) dto: CreateShipmentDto) {
    return this.shipments.create(dto, user.id);
  }

  @Get()
  list(@CurrentUser() user: PublicUser) {
    return this.shipments.list(user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.shipments.remove(id);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.shipments.get(id);
  }

  /**
   * Multipart upload, field "files": one or more PDFs. Responds 202 with the queued documents;
   * poll GET /shipments/:id/documents/:documentId, or pass ?wait=true to block until extracted.
   */
  @Post(':id/documents')
  @HttpCode(202)
  @UseInterceptors(FilesInterceptor('files', 10, { limits: { fileSize: MAX_PDF_BYTES } }))
  upload(@Param('id') id: string, @UploadedFiles() files: Express.Multer.File[] = [], @Query('wait') wait?: string) {
    if (files.length === 0) throw new BadRequestException('Send at least one PDF in the "files" field');
    return this.shipments.addDocuments(id, files.map((f) => ({ name: f.originalname, bytes: f.buffer })), wait === 'true');
  }

  @Get(':id/documents/:documentId')
  document(@Param('id') id: string, @Param('documentId') documentId: string) {
    return this.shipments.document(id, documentId);
  }

  /** Re-extracts a document as the given type: { "type": "COMMERCIAL_INVOICE" | "PACKING_LIST" | "BILL_OF_LADING" | "ISF" }. */
  @Post(':id/documents/:documentId/reextract')
  @HttpCode(202)
  reextract(@Param('id') id: string, @Param('documentId') documentId: string, @Body(new ZodValidationPipe(ReextractDto)) dto: ReextractDto, @Query('wait') wait?: string) {
    return this.shipments.reextract(id, documentId, dto.type, wait === 'true');
  }

  /** The uploaded PDF, for the viewer. */
  @Get(':id/documents/:documentId/file')
  @Header('content-type', 'application/pdf')
  async file(@Param('id') id: string, @Param('documentId') documentId: string, @Res() res: Response) {
    const { name, bytes } = await this.shipments.file(id, documentId);
    res.setHeader('content-disposition', `inline; filename="${name.replace(/[^\w.-]+/g, '_')}"`);
    res.send(bytes);
  }

  /** The Importer Security Filing (10+2) as JSON. Used by X11 on US shipments; an uploaded ISF PDF also lands here. */
  @Put(':id/isf')
  saveIsf(@Param('id') id: string, @Body(new ZodValidationPipe(Isf)) isf: Isf) {
    return this.shipments.saveIsf(id, isf);
  }

  @Get(':id/isf')
  isf(@Param('id') id: string) {
    return this.shipments.isf(id);
  }

  @Delete(':id/isf')
  @HttpCode(204)
  async deleteIsf(@Param('id') id: string) {
    await this.shipments.deleteIsf(id);
  }

  @Get(':id/validation')
  validation(@Param('id') id: string) {
    return this.shipments.latestValidation(id);
  }

  /**
   * Runs the rules on the extracted documents (or normalized JSON documents in the body), attaches
   * regulation citations and lets the agent review ambiguous cases. ?agent=false skips the model.
   */
  @Post(':id/validate')
  @HttpCode(200)
  validate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ValidateShipmentDto.optional())) dto?: ValidateShipmentDto,
    @Query('agent') agent?: string,
  ) {
    return this.shipments.validate(id, dto ?? {}, { agent: agent === undefined ? undefined : agent !== 'false' });
  }

  @Get(':id/findings')
  findings(@Param('id') id: string) {
    return this.shipments.findings(id);
  }
}
