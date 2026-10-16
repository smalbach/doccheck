import { BadRequestException, Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { CurrentOrg } from '../orgs/current-org.decorator';
import type { OrgContext } from '../orgs/org.types';
import { NoOrg, Permission } from '../orgs/permissions';
import type { MailActor } from '../messaging/mail.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from '../messaging/mail.config';
import { CloseDto, NewLinkDto, NewPreShipmentDto, RequestsQuery, RevokeDto, UploadNote } from './portal.dto';
import { Portal, PortalGuard } from './portal.guard';
import { PortalService, type PortalAccess } from './portal.service';

/**
 * The supplier's side of the portal (docs/PORTAL.md): no account, only the link's token. Nothing here
 * reaches beyond the one request the link is for.
 */
// Outside the member model: the organization comes from the token's request alone, never a session.
@Public()
@NoOrg()
@UseGuards(PortalGuard)
@Controller('portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('session')
  @Header('cache-control', 'no-store')
  @Header('referrer-policy', 'no-referrer')
  session(@Portal() access: PortalAccess) {
    return this.portal.view(access);
  }

  /** Corrected (or draft) PDFs, in "files", with an optional "note". The files are refused unless they are PDFs. */
  @Post('uploads')
  @HttpCode(201)
  @Header('cache-control', 'no-store')
  // One more than allowed, so too many files is our refusal (and is recorded), not a parser error.
  @UseInterceptors(FilesInterceptor('files', MAX_ATTACHMENTS + 1, { limits: { fileSize: MAX_ATTACHMENT_BYTES + 1, fields: 4, fieldSize: 20_000, parts: MAX_ATTACHMENTS + 5 } }))
  upload(@Portal() access: PortalAccess, @UploadedFiles() files: Express.Multer.File[] = [], @Body() body: { note?: unknown } = {}) {
    const note = UploadNote.safeParse(typeof body?.note === 'string' ? body.note : undefined);
    if (!note.success) throw new BadRequestException('The note is too long');
    return this.portal.upload(access, files, note.data || undefined);
  }
}

const actor = (user: PublicUser, org: OrgContext): MailActor => ({ userId: user.id, orgId: org.id });

/**
 * The importer's side: requests, their links and what suppliers did with them, in the active
 * organization. Reading needs data.read; anything that makes, shows or stops a link needs shipment.write.
 */
@Controller('supplier-portal')
export class SupplierPortalController {
  constructor(private readonly portal: PortalService) {}

  /** ?partyId=&threadId=&shipmentId=&kind=correction|pre_shipment: requests with their status. */
  @Get('requests')
  list(@CurrentUser() user: PublicUser, @CurrentOrg() org: OrgContext, @Query(new ZodValidationPipe(RequestsQuery)) query: RequestsQuery) {
    return this.portal.list(actor(user, org), query);
  }

  /** A pre-shipment check for a supplier: a draft shipment, and an email with the link. */
  @Post('requests')
  @Permission('shipment.write')
  create(@CurrentUser() user: PublicUser, @CurrentOrg() org: OrgContext, @Body(new ZodValidationPipe(NewPreShipmentDto)) dto: NewPreShipmentDto) {
    return this.portal.createPreShipment(actor(user, org), user.role === 'admin', dto);
  }

  @Get('requests/:id')
  detail(@CurrentUser() user: PublicUser, @CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.detail(actor(user, org), id);
  }

  /** The working link, to copy. */
  @Get('requests/:id/link')
  @Permission('shipment.write')
  @Header('cache-control', 'no-store')
  link(@CurrentUser() user: PublicUser, @CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.currentLink(actor(user, org), id);
  }

  /** A new link (the earlier ones stop working). */
  @Post('requests/:id/links')
  @Permission('shipment.write')
  @Header('cache-control', 'no-store')
  newLink(@CurrentUser() user: PublicUser, @CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(NewLinkDto)) dto: NewLinkDto) {
    return this.portal.newLink(actor(user, org), id, dto.days);
  }

  /** Revokes one link, or every link of the request. */
  @Post('requests/:id/revoke')
  @Permission('shipment.write')
  @HttpCode(200)
  revoke(@CurrentUser() user: PublicUser, @CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(RevokeDto)) dto: RevokeDto) {
    return this.portal.revoke(actor(user, org), id, dto.linkId);
  }

  /** Closes a request (its links stop working) or reopens it. */
  @Post('requests/:id/close')
  @Permission('shipment.write')
  @HttpCode(200)
  close(@CurrentUser() user: PublicUser, @CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(CloseDto)) dto: CloseDto) {
    return this.portal.close(actor(user, org), id, dto.closed);
  }

  /** A portal for a correction request that has none. */
  @Post('threads/:threadId/request')
  @Permission('shipment.write')
  @HttpCode(200)
  forThread(@CurrentUser() user: PublicUser, @CurrentOrg() org: OrgContext, @Param('threadId', ParseUUIDPipe) threadId: string, @Body(new ZodValidationPipe(NewLinkDto)) dto: NewLinkDto) {
    return this.portal.forThread(actor(user, org), threadId, dto.days);
  }
}
