import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Res, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { Isf } from '@doccheck/schemas';
import type { Response } from 'express';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AlertsRepository } from './alerts.repository';
import { ShipmentOwnerGuard } from './shipment-owner.guard';
import { CorrectDataDto, CreateShipmentDto, ListShipmentsQuery, ReextractDto, ReviewFindingsDto, UpdateShipmentDto, ValidateShipmentDto } from './shipments.dto';
import { ShipmentsService } from './shipments.service';

const MAX_PDF_BYTES = 20 * 1024 * 1024;
/** Alerts listed on the dashboard; the counts cover them all. */
const MAX_ALERTS = 20;

/** Every route with :id is limited to the signed-in user's shipments (ShipmentOwnerGuard). */
@Controller('shipments')
@UseGuards(ShipmentOwnerGuard)
export class ShipmentsController {
  constructor(
    private readonly shipments: ShipmentsService,
    private readonly alerts: AlertsRepository,
  ) {}

  @Post()
  create(@CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(CreateShipmentDto)) dto: CreateShipmentDto) {
    return this.shipments.create(dto, user.id);
  }

  /** ?status=all|open|attention|done&destination=CA|US&q=text&limit=25&offset=0 → { items, total, limit, offset, summary } */
  @Get()
  list(@CurrentUser() user: PublicUser, @Query(new ZodValidationPipe(ListShipmentsQuery)) query: ListShipmentsQuery) {
    return this.shipments.list(user.id, query);
  }

  /** What needs the user's attention across their shipments → { items (newest first), counts per kind, total }. Declared before :id. */
  @Get('alerts')
  listAlerts(@CurrentUser() user: PublicUser) {
    return this.alerts.list(user.id, MAX_ALERTS);
  }

  /** { reference?, destination?, transportMode? }; a reference of null or "" clears it. */
  @Patch(':id')
  update(@Param('id') id: string, @Body(new ZodValidationPipe(UpdateShipmentDto)) dto: UpdateShipmentDto) {
    return this.shipments.update(id, dto);
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
   * Multipart upload, field "files": one or more PDFs, photos (JPEG, PNG, HEIC: straightened, cropped
   * and read with OCR) or spreadsheets (.xlsx, .csv: read without a model). A PDF or workbook holding
   * several documents is split into one document per part once it is read. Responds 202 with the
   * queued documents; poll GET /shipments/:id/documents/:documentId, or pass ?wait=true to block until extracted.
   */
  @Post(':id/documents')
  @HttpCode(202)
  @UseInterceptors(FilesInterceptor('files', 10, { limits: { fileSize: MAX_PDF_BYTES } }))
  upload(@Param('id') id: string, @UploadedFiles() files: Express.Multer.File[] = [], @Query('wait') wait?: string) {
    if (files.length === 0) throw new BadRequestException('Send at least one PDF, photo or spreadsheet in the "files" field');
    return this.shipments.addDocuments(id, files.map((f) => ({ name: f.originalname, bytes: f.buffer })), wait === 'true');
  }

  @Get(':id/documents/:documentId')
  document(@Param('id') id: string, @Param('documentId') documentId: string) {
    return this.shipments.document(id, documentId);
  }

  /**
   * Corrects extracted values by hand: { changes: [{ path: "/lines/0/quantity/value", value: "120" }] }.
   * The corrected document must pass its schema (400 with issues otherwise); each change is recorded.
   * Responds with the document detail, whose `corrected` lists the corrected paths. 409 while extracting.
   */
  @Patch(':id/documents/:documentId/data')
  correct(@CurrentUser() user: PublicUser, @Param('id') id: string, @Param('documentId') documentId: string, @Body(new ZodValidationPipe(CorrectDataDto)) dto: CorrectDataDto) {
    return this.shipments.correct(id, documentId, user.id, dto.changes);
  }

  /** Puts back the values the model read; the history records the revert. */
  @Post(':id/documents/:documentId/data/revert')
  @HttpCode(200)
  revert(@CurrentUser() user: PublicUser, @Param('id') id: string, @Param('documentId') documentId: string) {
    return this.shipments.revertCorrections(id, documentId, user.id);
  }

  /** History of the values corrected by hand, oldest first. Re-extracting the document clears it. */
  @Get(':id/documents/:documentId/corrections')
  corrections(@Param('id') id: string, @Param('documentId') documentId: string) {
    return this.shipments.corrections(id, documentId);
  }

  /**
   * Re-extracts a document as the given type: { "type": "COMMERCIAL_INVOICE" | "PACKING_LIST" | "BILL_OF_LADING" | "ISF" }.
   * The new extraction replaces the data: values corrected by hand and their history are dropped.
   */
  @Post(':id/documents/:documentId/reextract')
  @HttpCode(202)
  reextract(@Param('id') id: string, @Param('documentId') documentId: string, @Body(new ZodValidationPipe(ReextractDto)) dto: ReextractDto, @Query('wait') wait?: string) {
    return this.shipments.reextract(id, documentId, dto.type, wait === 'true');
  }

  /**
   * Stops a document's extraction (QUEUED or EXTRACTING, else 409): it ends FAILED with "Cancelled by
   * the user". Blocked in the read-only demo like every other write.
   */
  @Post(':id/documents/:documentId/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string, @Param('documentId') documentId: string) {
    return this.shipments.cancelExtraction(id, documentId);
  }

  /** The stored file, for the viewer: the PDF (a photo's image PDF), or the spreadsheet as uploaded. */
  @Get(':id/documents/:documentId/file')
  async file(@Param('id') id: string, @Param('documentId') documentId: string, @Res() res: Response) {
    const { name, bytes, contentType } = await this.shipments.file(id, documentId);
    res.setHeader('content-type', contentType);
    res.setHeader('content-disposition', `inline; filename="${name.replace(/[^\w.-]+/g, '_')}"`);
    res.send(bytes);
  }

  /** A spreadsheet document's cells, for the viewer: { sheets: [{ name, rows }] }, and the sheets it covers. 400 for other documents. */
  @Get(':id/documents/:documentId/sheets')
  sheets(@Param('id') id: string, @Param('documentId') documentId: string) {
    return this.shipments.sheets(id, documentId);
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

  @Get(':id/validations')
  validations(@Param('id') id: string) {
    return this.shipments.validations(id);
  }

  @Get(':id/validations/:validationId')
  pastValidation(@Param('id') id: string, @Param('validationId') validationId: string) {
    return this.shipments.validation(id, validationId);
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

  /**
   * Records a decision about findings of the latest run: open, waiting_supplier, accepted or
   * false_positive (the last two need a note). Responds with the latest run, as GET :id/validation.
   */
  @Post(':id/findings/review')
  @HttpCode(200)
  review(@CurrentUser() user: PublicUser, @Param('id') id: string, @Body(new ZodValidationPipe(ReviewFindingsDto)) dto: ReviewFindingsDto) {
    return this.shipments.reviewFindings(id, user.id, dto);
  }
}
