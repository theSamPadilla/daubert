import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
// busboy is a CommonJS `export =` module and the project has esModuleInterop off,
// so a default import compiles to `busboy_1.default` (undefined at runtime).
import busboy = require('busboy');
import { requireUserPrincipal } from '../auth/access-principal';
import { RequireOrgRole } from '../auth/require-org-role.decorator';
import { DeclarantsService, DeclarantRequester } from './declarants.service';
import { DeclarantFilesService } from './declarant-files.service';
import { DeclarantFileKind } from '../../database/entities/declarant-file.entity';
import {
  DeclarantExtractionService,
  DeclarantExtractionSource,
} from './declarant-extraction.service';
import { CreateDeclarantDto } from './dto/create-declarant.dto';
import { UpdateDeclarantDto } from './dto/update-declarant.dto';

const EXTRACT_LIMIT_BYTES = 10 * 1024 * 1024; // 10 MiB — Anthropic needs the full base64 in memory
const UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024; // 50 MiB — same ceiling as the data-room upload

@Controller('orgs/:org/declarants')
export class DeclarantsController {
  constructor(
    private readonly service: DeclarantsService,
    private readonly filesService: DeclarantFilesService,
    private readonly extractionService: DeclarantExtractionService,
  ) {}

  @RequireOrgRole('member')
  @Get()
  list(@Req() req: any) {
    return this.service.listForOrg(req.organization.id);
  }

  @RequireOrgRole('member')
  @Post()
  create(@Req() req: any, @Body() dto: CreateDeclarantDto) {
    return this.service.create(req.organization.id, dto, this.requester(req));
  }

  @RequireOrgRole('member')
  @Patch(':declarantId')
  update(@Req() req: any, @Param('declarantId') declarantId: string, @Body() dto: UpdateDeclarantDto) {
    return this.service.update(req.organization.id, declarantId, dto, this.requester(req));
  }

  @RequireOrgRole('member')
  @Delete(':declarantId')
  @HttpCode(204)
  remove(@Req() req: any, @Param('declarantId') declarantId: string) {
    return this.service.remove(req.organization.id, declarantId, this.requester(req));
  }

  /**
   * Extract a declarant draft from an uploaded PDF (a CV or a previously filed
   * declaration). Streams the multipart body through busboy but BUFFERS the
   * file in memory — Anthropic needs the full base64, so we cannot stream it to
   * storage. Nothing is persisted; the draft prefills the create form for human
   * review.
   *
   * The `safeRespond` guard mirrors the data-room upload: busboy's `limit` and
   * `error` events can fire after a response path has already run, and a second
   * response call would crash the process — so every path checks `headersSent`.
   */
  @RequireOrgRole('member')
  @Post('extract')
  async extract(@Req() req: Request, @Res() res: Response): Promise<void> {
    // Capture metering context up front (the guard has attached org + principal).
    const orgId = (req as any).organization.id as string;
    const userId = requireUserPrincipal(req);

    const safeRespond = (status: number, body: unknown) => {
      if (res.headersSent) return;
      res.status(status).json(body);
    };

    const bb = busboy({
      headers: req.headers,
      limits: { fileSize: EXTRACT_LIMIT_BYTES, files: 1 },
    });

    let handled = false;
    let oversize = false;
    let badType = false;
    let source: DeclarantExtractionSource | undefined;
    const chunks: Buffer[] = [];

    bb.on('field', (name, value) => {
      if (name === 'source' && (value === 'cv' || value === 'prior_declaration')) {
        source = value;
      }
    });

    bb.on('file', (_field, fileStream, info) => {
      handled = true;

      if (info.mimeType !== 'application/pdf') {
        badType = true;
        fileStream.resume(); // drain so the socket frees up
        safeRespond(400, { message: 'Only PDF files can be extracted' });
        return;
      }

      // busboy's `fileSize` limit fires on the file stream, not the busboy
      // instance. Without this the stream is silently truncated at the limit
      // and we'd extract from a partial PDF. Trip a flag and abort.
      fileStream.on('limit', () => {
        oversize = true;
        fileStream.resume(); // drain remaining bytes
        safeRespond(400, { message: 'PDF exceeds 10MB' });
      });

      fileStream.on('data', (chunk: Buffer) => {
        if (oversize) return;
        chunks.push(chunk);
      });
    });

    bb.on('filesLimit', () => {
      safeRespond(400, { message: 'Only one file per extraction' });
    });

    bb.on('error', (err) => {
      safeRespond(400, { message: `Malformed upload: ${(err as Error).message}` });
    });

    // `finish` fires only after busboy has parsed every part — file AND
    // fields — so the extraction below no longer depends on whether `source`
    // arrived before or after the file part on the wire.
    bb.on('finish', async () => {
      if (!handled) {
        safeRespond(400, { message: 'No file in upload' });
        return;
      }
      if (oversize || badType || res.headersSent) return;
      if (!source) {
        safeRespond(400, { message: 'Missing or invalid "source" field (cv | prior_declaration)' });
        return;
      }
      try {
        const buffer = Buffer.concat(chunks);
        const draft = await this.extractionService.extract(buffer, source, { orgId, userId });
        safeRespond(200, draft);
      } catch (err: any) {
        // Extraction service throws BadRequestException (400) / BadGatewayException (502).
        const status = typeof err?.getStatus === 'function' ? err.getStatus() : 500;
        const message =
          typeof err?.getResponse === 'function'
            ? (err.getResponse() as any)?.message ?? err.message
            : (err as Error).message;
        safeRespond(status, { message });
      }
    });

    req.pipe(bb);
  }

  // ----------------------------- Declarant files -----------------------------

  @RequireOrgRole('member')
  @Get(':declarantId/files')
  listFiles(@Req() req: any, @Param('declarantId') declarantId: string) {
    return this.filesService.list(req.organization.id, declarantId);
  }

  /**
   * Stream-upload using busboy directly, mirroring the data-room upload route:
   * bypasses multer (which buffers the whole file) so the file event hands us a
   * `Readable` piped straight into storage. Reads the `kind` form field
   * (`cv` | `prior_declaration`) — missing/invalid is a 400. The `safeRespond`
   * guard checks `headersSent` because busboy's `limit`/`error` events can fire
   * after a response path has already run.
   */
  @RequireOrgRole('member')
  @Post(':declarantId/files')
  async upload(
    @Req() req: Request,
    @Res() res: Response,
    @Param('declarantId') declarantId: string,
  ): Promise<void> {
    const orgId = (req as any).organization.id as string;
    const requester = this.requester(req);

    const safeRespond = (status: number, body: unknown) => {
      if (res.headersSent) return;
      res.status(status).json(body);
    };

    const bb = busboy({
      headers: req.headers,
      limits: { fileSize: UPLOAD_LIMIT_BYTES, files: 1 },
    });

    let handled = false;
    let oversize = false;
    let kind: DeclarantFileKind | undefined;

    bb.on('field', (name, value) => {
      if (name === 'kind' && (value === 'cv' || value === 'prior_declaration')) {
        kind = value as DeclarantFileKind;
      }
    });

    bb.on('file', async (_field, fileStream, info) => {
      handled = true;

      fileStream.on('limit', () => {
        oversize = true;
        fileStream.unpipe();
        fileStream.resume(); // drain remaining bytes
        safeRespond(413, { message: 'File exceeds 50MB' });
      });

      if (!kind) {
        oversize = true; // reuse the flag to short-circuit the rest of the stream handling
        fileStream.resume();
        safeRespond(400, { message: 'Missing or invalid "kind" field (cv | prior_declaration)' });
        return;
      }

      try {
        const file = await this.filesService.upload(
          orgId,
          declarantId,
          requester,
          kind,
          info.filename,
          info.mimeType,
          fileStream,
        );
        if (oversize) {
          // The 413 response already went out from the `limit` handler, but
          // `upload()` still resolved — it wrote the truncated bytes to
          // storage and saved a `declarant_files` row. Clean up the orphan
          // so a rejected oversize upload doesn't leave a stray file/row behind.
          await this.filesService.remove(orgId, declarantId, file.id, requester).catch(() => {});
          return;
        }
        safeRespond(200, file);
      } catch (err: any) {
        if (oversize) return;
        fileStream.resume();
        const status = typeof err?.getStatus === 'function' ? err.getStatus() : 500;
        const message =
          typeof err?.getResponse === 'function'
            ? (err.getResponse() as any)?.message ?? err.message
            : (err as Error).message;
        safeRespond(status, { message });
      }
    });

    bb.on('filesLimit', () => {
      safeRespond(400, { message: 'Only one file per upload' });
    });

    bb.on('error', (err) => {
      safeRespond(400, { message: `Malformed upload: ${(err as Error).message}` });
    });

    bb.on('finish', () => {
      if (!handled) {
        safeRespond(400, { message: 'No file in upload' });
      }
    });

    req.pipe(bb);
  }

  /**
   * Stream-proxy a declarant file straight to the client, mirroring the
   * data-room download route: metadata is fetched first so `Content-Type`,
   * `Content-Disposition`, and (when known) `Content-Length` can be set before
   * the stream starts.
   */
  @RequireOrgRole('member')
  @Get(':declarantId/files/:fileId/download')
  async download(
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
    @Param('declarantId') declarantId: string,
    @Param('fileId') fileId: string,
  ): Promise<StreamableFile> {
    const { stream, name, mimeType, size } = await this.filesService.download(
      req.organization.id,
      declarantId,
      fileId,
    );
    if (size) {
      res.setHeader('Content-Length', size);
    }
    return new StreamableFile(stream, {
      type: mimeType,
      disposition: contentDisposition(name),
    });
  }

  @RequireOrgRole('member')
  @Delete(':declarantId/files/:fileId')
  @HttpCode(204)
  removeFile(
    @Req() req: any,
    @Param('declarantId') declarantId: string,
    @Param('fileId') fileId: string,
  ) {
    return this.filesService.remove(req.organization.id, declarantId, fileId, this.requester(req));
  }

  /**
   * Build the requester context for row-level self-ownership. The userId comes
   * from the user principal (asserts user auth) and the org role from the
   * membership the OrgRoleGuard attached at `req.orgMembership`.
   */
  private requester(req: any): DeclarantRequester {
    return {
      userId: requireUserPrincipal(req),
      orgRole: req.orgMembership.role,
    };
  }
}

/**
 * RFC 5987-encoded `Content-Disposition` header. Falls back to a sanitised
 * ASCII `filename=` for legacy clients and adds `filename*=UTF-8''…` for
 * non-ASCII names. Mirrors the data-room controller's local helper.
 */
function contentDisposition(name: string): string {
  const asciiSafe = name.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  const isAscii = /^[\x20-\x7E]+$/.test(name);
  if (isAscii) {
    return `attachment; filename="${asciiSafe}"`;
  }
  const encoded = encodeURIComponent(name);
  return `attachment; filename="${asciiSafe}"; filename*=UTF-8''${encoded}`;
}
