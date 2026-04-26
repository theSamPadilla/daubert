import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import busboy from 'busboy';
import { CaseMemberGuard } from '../auth/case-member.guard';
import { Public } from '../auth/public.decorator';
import { DataRoomService } from './data-room.service';
import { DriveFile } from './google-drive.service';
import { SetFolderDto } from './dto/set-folder.dto';
import { DataRoomConnectionEntity } from '../../database/entities/data-room-connection.entity';

const UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024; // 50 MiB

/**
 * Public projection of `DataRoomConnectionEntity` — strips the encrypted
 * credentials (`credentialsCipher`, `credentialsIv`, `credentialsAuthTag`)
 * so they never leave the backend. Every endpoint that returns connection
 * data routes through this mapper.
 */
interface PublicDataRoomConnection {
  id: string;
  caseId: string;
  provider: string;
  folderId: string | null;
  folderName: string | null;
  status: 'active' | 'broken';
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Two prefixes intentionally split on one controller via per-route paths:
 *
 * - `cases/:caseId/data-room/...` — case-scoped, gated by `CaseMemberGuard`.
 * - `data-room/oauth-callback` — public OAuth landing, gated by HMAC `state`.
 *
 * The OAuth callback can't sit under `cases/:caseId/...` because Google's
 * `redirect_uri` is fixed; the `caseId` rides inside the signed `state`.
 */
@Controller()
export class DataRoomController {
  constructor(private readonly service: DataRoomService) {}

  private stripCredentials(
    conn: DataRoomConnectionEntity | null,
  ): PublicDataRoomConnection | null {
    if (!conn) return null;
    return {
      id: conn.id,
      caseId: conn.caseId,
      provider: conn.provider,
      folderId: conn.folderId,
      folderName: conn.folderName,
      status: conn.status,
      createdAt: conn.createdAt,
      updatedAt: conn.updatedAt,
    };
  }

  // ----------------------------- OAuth -----------------------------

  /**
   * Initiate OAuth — returns the consent URL. The frontend navigates to it.
   * Owner-only: guests can browse the data room but not connect/disconnect it.
   */
  @UseGuards(CaseMemberGuard)
  @Post('cases/:caseId/data-room/connect')
  connect(
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
    @Req() req: Request,
  ): { url: string } {
    DataRoomService.requireOwner((req as any).caseMembership?.role);
    return { url: this.service.getAuthUrl(caseId) };
  }

  /**
   * OAuth landing. `@Public()` skips Firebase auth (Google can't send a
   * Firebase token); the HMAC `state` is the actual auth.
   */
  @Public()
  @Get('data-room/oauth-callback')
  async oauthCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!code || !state) {
      throw new BadRequestException('missing_code_or_state');
    }
    const { caseId } = await this.service.handleCallback({ code, state });
    const frontend = process.env.FRONTEND_URL ?? 'http://localhost:3001';
    res.redirect(302, `${frontend}/cases/${caseId}/data-room`);
  }

  // --------------------------- Connection ---------------------------

  /**
   * Returns the connection or 404 if none exists. Credentials never leave the
   * backend (`stripCredentials` projection). 404-on-absent matches the OpenAPI
   * contract — the frontend api-client maps 404 → `null` for the consumer.
   */
  @UseGuards(CaseMemberGuard)
  @Get('cases/:caseId/data-room')
  async get(@Param('caseId', new ParseUUIDPipe()) caseId: string) {
    const conn = await this.service.getConnection(caseId);
    if (!conn) {
      throw new NotFoundException('connection_not_found');
    }
    return this.stripCredentials(conn);
  }

  @UseGuards(CaseMemberGuard)
  @Patch('cases/:caseId/data-room/folder')
  async setFolder(
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
    @Body() dto: SetFolderDto,
    @Req() req: Request,
  ) {
    DataRoomService.requireOwner((req as any).caseMembership?.role);
    return this.stripCredentials(await this.service.setFolder(caseId, dto.folderId));
  }

  /**
   * Issue a short-lived Drive access token to the case owner's browser so
   * the Google Drive Picker SDK can run client-side.
   *
   * Security: access tokens are short-lived (~1 hour) and scoped to the
   * owner's Drive account. Returning them to the browser is the standard
   * pattern for Google Picker integration. Do not expose this endpoint to
   * non-owners.
   */
  @UseGuards(CaseMemberGuard)
  @Get('cases/:caseId/data-room/access-token')
  async getAccessToken(
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
    @Req() req: Request,
  ): Promise<{ accessToken: string; expiresAt: string }> {
    DataRoomService.requireOwner((req as any).caseMembership?.role);
    return this.service.getAccessToken(caseId);
  }

  @UseGuards(CaseMemberGuard)
  @Delete('cases/:caseId/data-room')
  @HttpCode(204)
  async disconnect(
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
    @Req() req: Request,
  ): Promise<void> {
    DataRoomService.requireOwner((req as any).caseMembership?.role);
    await this.service.disconnect(caseId);
  }

  // ----------------------------- Files -----------------------------

  @UseGuards(CaseMemberGuard)
  @Get('cases/:caseId/data-room/files')
  async listFiles(
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
  ): Promise<DriveFile[]> {
    return this.service.listFiles(caseId);
  }

  /**
   * Stream-proxy a Drive file straight to the client. We capture metadata
   * first so we can set `Content-Type`, `Content-Disposition`, and (when
   * known) `Content-Length` before the stream starts. RFC 5987 fallback for
   * non-ASCII filenames.
   */
  @UseGuards(CaseMemberGuard)
  @Get('cases/:caseId/data-room/files/:fileId/download')
  async download(
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
    @Param('fileId') fileId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, name, mimeType, size } = await this.service.getFileForDownload(
      caseId,
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

  /**
   * Stream-upload using busboy directly. Bypasses NestJS `FileInterceptor`
   * (multer) because multer buffers the entire file before it hands us a
   * stream — that would defeat the 256KB-peak goal in the plan. busboy's
   * file event hands us a `Readable` we can pipe straight into
   * `drive.files.create`.
   *
   * The `safeRespond` guard exists because once `drive.files.create` is
   * mid-upload, response headers may already be flushed. A second response
   * call would crash the process; busboy's `limit` and `error` events can
   * fire after partial transmission, so every response path checks
   * `headersSent` first.
   */
  @UseGuards(CaseMemberGuard)
  @Post('cases/:caseId/data-room/files')
  async upload(
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    DataRoomService.requireOwner((req as any).caseMembership?.role);

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

    bb.on('file', async (_field, fileStream, info) => {
      handled = true;

      // busboy's `fileSize` limit fires on the file stream, not the busboy
      // instance. Without this listener the stream is silently truncated at
      // the limit and the upload "succeeds" with a partial file. We trip a
      // flag and abort the Drive upload.
      fileStream.on('limit', () => {
        oversize = true;
        fileStream.unpipe();
        fileStream.resume(); // drain remaining bytes
        safeRespond(413, { message: 'File exceeds 50MB' });
      });

      try {
        const driveFile = await this.service.uploadFromStream(
          caseId,
          info.filename,
          info.mimeType,
          fileStream,
        );
        if (oversize) return; // 413 already sent; don't double-respond
        safeRespond(200, driveFile);
      } catch (err) {
        if (oversize) return;
        // Drain so the request socket can free up even on failure.
        fileStream.resume();
        safeRespond(500, { message: (err as Error).message });
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
}

/**
 * RFC 5987-encoded `Content-Disposition` header. Falls back to a sanitised
 * ASCII `filename=` for legacy clients and adds `filename*=UTF-8''…` for
 * non-ASCII names.
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
