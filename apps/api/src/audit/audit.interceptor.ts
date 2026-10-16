import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { mergeMap, Observable } from 'rxjs';
import type { AuthedRequest } from '../auth/auth.types';
import type { OrgRequest } from '../orgs/org.types';
import { AuditService, type AuditScope } from './audit.service';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global: every request that changes something is logged once it succeeds, with who made it, from
 * which address, and what changed. Services describe their changes (AuditService.note, with before
 * and after); a route whose service notes nothing is logged with its route, ids and body (secrets
 * redacted), so no write goes unrecorded.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request & AuthedRequest & OrgRequest>();
    if (READS.has(req.method)) return next.handle();
    const scope: AuditScope = {
      actor: { userId: req.user?.id ?? null, email: req.user?.email ?? null, orgId: req.org?.id ?? null, ip: req.ip ?? null },
      entries: [],
    };
    return new Observable((subscriber) =>
      this.audit.run(scope, () =>
        next
          .handle()
          .pipe(
            mergeMap(async (value) => {
              await this.flush(req, scope);
              return value;
            }),
          )
          .subscribe(subscriber),
      ),
    );
  }

  private async flush(req: Request & AuthedRequest & OrgRequest, scope: AuditScope) {
    // A route that signed someone out or deleted the account still names who did it.
    if (!scope.actor.userId && req.user) Object.assign(scope.actor, { userId: req.user.id, email: req.user.email });
    if (!scope.entries.length) {
      const route = (req.route as { path?: string } | undefined)?.path ?? req.path;
      const files = (req as { files?: { originalname: string; size: number }[] }).files;
      scope.entries.push({
        action: `http.${req.method.toLowerCase()}`,
        entity: route,
        entityId: typeof req.params?.id === 'string' ? req.params.id : undefined,
        after: {
          ...(Object.keys(req.params ?? {}).length ? { params: req.params } : {}),
          ...(Object.keys(req.query ?? {}).length ? { query: req.query } : {}),
          ...(req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) && Object.keys(req.body).length ? { body: req.body } : {}),
          ...(Array.isArray(files) ? { files: files.map((f) => ({ name: f.originalname, size: f.size })) } : {}),
        },
      });
    }
    for (const entry of scope.entries) await this.audit.record(scope.actor, entry);
  }
}
