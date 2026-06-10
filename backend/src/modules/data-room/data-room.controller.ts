import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import busboy from 'busboy';
import { RequireRole } from '../auth/require-role.decorator';
import { DataRoomService } from './data-room.service';

const UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024; // 50 MiB

@Controller()
export class DataRoomController {
  constructor(private readonly service: DataRoomService) {}

  // ----------------------------- Files -----------------------------

  @RequireRole('viewer')
  @Get('cases/:caseId/data-room/files')
  async listFiles(
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
  ) {
    return this.service.listFiles(caseId);
  }

  /**
   * Stream-proxy a file straight to the client. We capture metadata
   * first so we can set `Content-Type`, `Content-Disposition`, and (when
   * known) `Content-Length` before the stream starts. RFC 5987 fallback for
   * non-ASCII filenames.
   */
  @RequireRole('viewer')
  @Get('cases/:caseId/data-room/files/:fileId/download')
  async download(
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
    @Param('fileId') fileId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, name, mimeType, size } = await this.service.getFileForDownload(
      caseId,
      (req as any).user.id,
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
   * file event hands us a `Readable` we can pipe straight into storage.
   *
   * The `safeRespond` guard exists because once the upload is mid-flight,
   * response headers may already be flushed. A second response call would
   * crash the process; busboy's `limit` and `error` events can fire after
   * partial transmission, so every response path checks `headersSent` first.
   */
  @RequireRole('editor')
  @Post('cases/:caseId/data-room/files')
  async upload(
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const userId = (req as any).user.id as string;

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
      // flag and abort the upload.
      fileStream.on('limit', () => {
        oversize = true;
        fileStream.unpipe();
        fileStream.resume(); // drain remaining bytes
        safeRespond(413, { message: 'File exceeds 50MB' });
      });

      try {
        const file = await this.service.uploadFromStream(
          caseId,
          userId,
          info.filename,
          info.mimeType,
          fileStream,
        );
        if (oversize) return; // 413 already sent; don't double-respond
        safeRespond(200, file);
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

  @RequireRole('editor')
  @Delete('cases/:caseId/data-room/files/:fileId')
  @HttpCode(204)
  async deleteFile(
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
    @Param('fileId') fileId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.service.deleteFile(caseId, (req as any).user.id, fileId);
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
