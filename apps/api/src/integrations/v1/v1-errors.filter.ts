import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { STATUS_CODES } from 'node:http';

/**
 * Errors of the public API in one shape (the Error schema of the OpenAPI document):
 * { statusCode, error, message, issues? }, whatever threw them. Unexpected errors are a 500 that
 * says nothing about the internals.
 */
@Catch()
export class V1ErrorsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiV1');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = exception instanceof HttpException ? exception.getResponse() : undefined;
    let message = status === 500 ? 'Something went wrong' : exception instanceof Error ? exception.message : 'Error';
    let issues: { path: (string | number)[]; message: string; code?: string }[] | undefined;
    if (body && typeof body === 'object') {
      const b = body as { message?: unknown; issues?: { path?: unknown[]; message?: string; code?: string }[] };
      if (typeof b.message === 'string') message = b.message;
      else if (Array.isArray(b.message)) message = b.message.join('; ');
      if (Array.isArray(b.issues)) issues = b.issues.map((i) => ({ path: (i.path ?? []).filter((p): p is string | number => typeof p === 'string' || typeof p === 'number'), message: String(i.message ?? ''), ...(i.code ? { code: i.code } : {}) }));
    } else if (typeof body === 'string') {
      message = body;
    }
    if (status === 500) this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    if (res.headersSent) return;
    res.status(status).json({ statusCode: status, error: STATUS_CODES[status] ?? 'Error', message, ...(issues ? { issues } : {}) });
  }
}
