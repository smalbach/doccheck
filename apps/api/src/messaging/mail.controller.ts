import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { AdminGuard } from '../auth/admin.guard';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AssignDto, ContactsQuery, NewThreadDto, ReplyDto, ThreadsQuery, ThreadStatusDto } from './mail.dto';
import { MailInbox } from './mail-inbox';
import { MailService } from './mail.service';

/** Conversations with suppliers by email, inside the app (docs/MESSAGING.md). */
@Controller('mail')
export class MailController {
  constructor(
    private readonly mail: MailService,
    private readonly inbox: MailInbox,
  ) {}

  /** Unread replies, conversations awaiting an answer, overdue and failed ones (and unassigned mail for admins). */
  @Get('summary')
  summary(@CurrentUser() user: PublicUser) {
    return this.mail.summary(user.id, user.role === 'admin');
  }

  /** How mail goes out and comes in on this server. */
  @Get('status')
  status() {
    return this.mail.status();
  }

  /** ?filter=open|unread|awaiting|overdue|failed|closed|all&q=&shipmentId=&partyId=&limit=&offset= */
  @Get('threads')
  threads(@CurrentUser() user: PublicUser, @Query(new ZodValidationPipe(ThreadsQuery)) query: ThreadsQuery) {
    return this.mail.list(user.id, query);
  }

  /** Starts a conversation (or a request for corrected documents) and queues its first message. */
  @Post('threads')
  create(@CurrentUser() user: PublicUser, @Body(new ZodValidationPipe(NewThreadDto)) dto: NewThreadDto) {
    return this.mail.createThread(user.id, dto);
  }

  @Get('threads/:id')
  thread(@CurrentUser() user: PublicUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.mail.thread(user.id, id);
  }

  @Post('threads/:id/reply')
  @HttpCode(200)
  reply(@CurrentUser() user: PublicUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(ReplyDto)) dto: ReplyDto) {
    return this.mail.reply(user.id, id, dto);
  }

  @Post('threads/:id/read')
  @HttpCode(200)
  read(@CurrentUser() user: PublicUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.mail.markRead(user.id, id);
  }

  /** closed, or awaiting to reopen. */
  @Post('threads/:id/status')
  @HttpCode(200)
  setStatus(@CurrentUser() user: PublicUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(ThreadStatusDto)) dto: ThreadStatusDto) {
    return this.mail.setStatus(user.id, id, dto.status);
  }

  /** Queues a failed message again. */
  @Post('messages/:id/retry')
  @HttpCode(200)
  retry(@CurrentUser() user: PublicUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.mail.retry(user.id, id);
  }

  @Get('contacts')
  contacts(@CurrentUser() user: PublicUser, @Query(new ZodValidationPipe(ContactsQuery)) query: ContactsQuery) {
    return this.mail.contacts(user.id, query.partyId);
  }

  @Get('attachments/:id/file')
  async file(@CurrentUser() user: PublicUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { name, contentType, bytes } = await this.mail.attachmentFile(user.id, user.role === 'admin', id);
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
  importAttachment(@CurrentUser() user: PublicUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.mail.importAttachment(user.id, id);
  }

  @Get('unassigned')
  @UseGuards(AdminGuard)
  unassigned() {
    return this.mail.unassigned();
  }

  @Post('messages/:id/assign')
  @UseGuards(AdminGuard)
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
    const secret = process.env.MAIL_INBOUND_SECRET;
    const given = Buffer.from(String(req.headers['x-inbound-secret'] ?? ''));
    if (!secret || given.length !== Buffer.byteLength(secret) || !timingSafeEqual(given, Buffer.from(secret))) throw MailService.forbidden();
    let raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : '');
    if (/json/i.test(String(req.headers['content-type']))) {
      const parsed = JSON.parse(raw.toString('utf8')) as { raw?: string };
      raw = Buffer.from(parsed.raw ?? '', 'base64');
    }
    if (raw.length === 0) throw MailService.badRequest();
    return this.inbox.ingest(raw);
  }
}
