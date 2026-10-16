import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { AdminGuard } from '../auth/admin.guard';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { CurrentOrg } from '../orgs/current-org.decorator';
import type { OrgContext } from '../orgs/org.types';
import { NoOrg } from '../orgs/permissions';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AssignDto, ContactsQuery, NewThreadDto, PreviewDto, ReplyDto, ThreadsQuery, ThreadStatusDto } from './mail.dto';
import { mailHtml } from './mail-html';
import { MailInbox } from './mail-inbox';
import { MAIL_LOGO_PNG } from './mail-logo';
import { MailIntakeService } from './mail-intake.service';
import { MailService, type MailActor } from './mail.service';
import { expandLinks, portalPath, portalUrl } from '../portal/portal-token';

const actor = (user: PublicUser, org: OrgContext): MailActor => ({ userId: user.id, orgId: org.id });

/** Conversations with suppliers by email, inside the app (docs/MESSAGING.md). */
@Controller('mail')
export class MailController {
  constructor(
    private readonly mail: MailService,
    private readonly inbox: MailInbox,
    private readonly intake: MailIntakeService,
  ) {}

  /** The user's address for sending documents by email, when that is on. */
  @Get('intake')
  intakeAddress(@CurrentUser() user: PublicUser) {
    return this.intake.address(user.id);
  }

  /** Checks a documents-by-email shipment again once its destination is set. */
  @Post('intakes/:id/retry')
  @HttpCode(200)
  async retryIntake(@CurrentUser() user: PublicUser, @Param('id', ParseUUIDPipe) id: string) {
    if (!(await this.intake.retry(user.id, id))) throw MailService.badRequestRetry();
    return { ok: true };
  }

  /** Unread replies, conversations awaiting an answer, overdue and failed ones (and unassigned mail for admins). */
  @Get('summary')
  summary(@CurrentUser() user: PublicUser, @CurrentOrg() org: OrgContext) {
    return this.mail.summary(actor(user, org), user.role === 'admin');
  }

  /** How mail goes out and comes in on this server. */
  @Get('status')
  status(@CurrentUser() user: PublicUser) {
    return this.mail.status(user.role === 'admin');
  }

  /** ?filter=open|unread|awaiting|overdue|failed|closed|all&q=&shipmentId=&partyId=&limit=&offset= */
  @Get('threads')
  threads(@CurrentUser() user: PublicUser, @CurrentOrg() org: OrgContext, @Query(new ZodValidationPipe(ThreadsQuery)) query: ThreadsQuery) {
    return this.mail.list(actor(user, org), query);
  }

  /** The email as the recipient will see it (the HTML part), with the logo inline as a data URL. */
  @Post('preview')
  @HttpCode(200)
  preview(@Body(new ZodValidationPipe(PreviewDto)) dto: PreviewDto) {
    // A portal link is made only when the email is sent: the preview shows where it goes.
    const text = expandLinks(dto.body, portalUrl('…') ?? portalPath('…'));
    return { html: mailHtml({ subject: dto.subject, text, language: dto.language, logoSrc: `data:image/png;base64,${MAIL_LOGO_PNG.toString('base64')}` }) };
  }

  /** Starts a conversation (or a request for corrected documents) and queues its first message. */
  @Post('threads')
  create(@CurrentUser() user: PublicUser, @CurrentOrg() org: OrgContext, @Body(new ZodValidationPipe(NewThreadDto)) dto: NewThreadDto) {
    return this.mail.createThread(actor(user, org), dto, user.role === 'admin');
  }

  @Get('threads/:id')
  thread(@CurrentUser() user: PublicUser, @CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.mail.thread(actor(user, org), id);
  }

  @Post('threads/:id/reply')
  @HttpCode(200)
  reply(@CurrentUser() user: PublicUser, @CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(ReplyDto)) dto: ReplyDto) {
    return this.mail.reply(actor(user, org), id, dto, user.role === 'admin');
  }

  @Post('threads/:id/read')
  @HttpCode(200)
  read(@CurrentUser() user: PublicUser, @CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.mail.markRead(actor(user, org), id);
  }

  /** closed, or awaiting to reopen. */
  @Post('threads/:id/status')
  @HttpCode(200)
  setStatus(@CurrentUser() user: PublicUser, @CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(ThreadStatusDto)) dto: ThreadStatusDto) {
    return this.mail.setStatus(actor(user, org), id, dto.status);
  }

  /** Queues a failed message again. */
  @Post('messages/:id/retry')
  @HttpCode(200)
  retry(@CurrentUser() user: PublicUser, @CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.mail.retry(actor(user, org), id, user.role === 'admin');
  }

  @Get('contacts')
  contacts(@CurrentUser() user: PublicUser, @CurrentOrg() org: OrgContext, @Query(new ZodValidationPipe(ContactsQuery)) query: ContactsQuery) {
    return this.mail.contacts(actor(user, org), query.partyId, query.shipmentId);
  }

  @Get('attachments/:id/file')
  async file(@CurrentUser() user: PublicUser, @CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { name, contentType, bytes } = await this.mail.attachmentFile(actor(user, org), user.role === 'admin', id);
    res.setHeader('content-type', contentType);
    // Never rendered as a page from this origin: PDFs and pictures inline, anything else downloaded.
    const inline = contentType === 'application/pdf' || contentType.startsWith('image/');
    res.setHeader('content-disposition', `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/[^\w.-]+/g, '_')}"`);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'");
    res.send(bytes);
  }

  /** Adds a received PDF to the conversation's shipment as a document (it is extracted like an upload). */
  @Post('attachments/:id/import')
  @HttpCode(200)
  importAttachment(@CurrentUser() user: PublicUser, @CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.mail.importAttachment(actor(user, org), id);
  }

  @Get('unassigned')
  @UseGuards(AdminGuard)
  @NoOrg()
  unassigned() {
    return this.mail.unassigned();
  }

  @Post('messages/:id/assign')
  @UseGuards(AdminGuard)
  @NoOrg()
  @HttpCode(200)
  assign(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(AssignDto)) dto: AssignDto) {
    return this.mail.assign(id, dto.threadId);
  }

  /**
   * Received mail from a provider that forwards it (Cloudflare Email Workers, Postmark, Mailgun...):
   * the raw RFC 5322 message as the body (message/rfc822 or any type), or JSON { "raw": "<base64>" }.
   * Needs the header X-Inbound-Secret: MAIL_INBOUND_SECRET.
   */
  @Public()
  @Post('inbound')
  @HttpCode(202)
  async inbound(@Req() req: Request) {
    // The secret was checked before the body was read (inboundSecretGuard, main.ts); checked again here.
    if (!inboundSecretMatches(req.headers['x-inbound-secret'])) throw MailService.forbidden();
    let raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : '');
    if (/json/i.test(String(req.headers['content-type']))) {
      let parsed: { raw?: unknown };
      try {
        parsed = JSON.parse(raw.toString('utf8')) as { raw?: unknown };
      } catch {
        throw MailService.badRequest();
      }
      raw = Buffer.from(typeof parsed.raw === 'string' ? parsed.raw : '', 'base64');
    }
    if (raw.length === 0) throw MailService.badRequest();
    return this.inbox.ingest(raw);
  }
}

/** X-Inbound-Secret equals MAIL_INBOUND_SECRET (unset: inbound mail is off), compared in constant time. */
export function inboundSecretMatches(header: unknown): boolean {
  const secret = process.env.MAIL_INBOUND_SECRET;
  const given = Buffer.from(String(header ?? ''));
  return !!secret && given.length === Buffer.byteLength(secret) && timingSafeEqual(given, Buffer.from(secret));
}

/** Refuses a webhook call without the secret before its (up to 25 MB) body is read. */
export function inboundSecretGuard(req: Request, res: Response, next: () => void) {
  if (inboundSecretMatches(req.headers['x-inbound-secret'])) return next();
  res.status(403).json({ statusCode: 403, message: 'Inbound mail is not enabled, or the secret is wrong' });
}
