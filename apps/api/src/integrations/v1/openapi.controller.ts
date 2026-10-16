import { Controller, Get, Header, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../auth/public.decorator';
import { openApiDocument } from './openapi';

/** The OpenAPI 3.1 document of the public API, open to anyone (it holds no data). */
@Controller('api/v1')
@Public()
export class OpenApiController {
  private cached?: Record<string, unknown>;

  @Get('openapi.json')
  @Header('cache-control', 'public, max-age=300')
  spec(@Req() req: Request) {
    // Servers: the origin the spec was fetched from, so "try it" tools call this server.
    this.cached ??= openApiDocument();
    return { ...this.cached, servers: [{ url: `${req.protocol}://${req.get('host')}` }] };
  }
}
