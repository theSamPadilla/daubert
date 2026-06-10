import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StorageProvider } from './storage-provider.interface';

/**
 * Filesystem-backed StorageProvider for local development.
 *
 * Objects are written under a base directory (default
 * `os.tmpdir()/daubert-data-room`, overridable via `DATA_ROOM_LOCAL_DIR` or the
 * constructor). The object key's path segments are joined under the base dir and
 * parent directories are created on write.
 */
export class LocalDiskStorageProvider implements StorageProvider {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir =
      baseDir ??
      process.env.DATA_ROOM_LOCAL_DIR ??
      path.join(os.tmpdir(), 'daubert-data-room');
  }

  /** Resolve an object key to an absolute path, rejecting path traversal. */
  private resolve(objectKey: string): string {
    if (objectKey.includes('..')) {
      throw new Error(`Invalid object key (path traversal): ${objectKey}`);
    }
    return path.join(this.baseDir, ...objectKey.split('/'));
  }

  async upload(
    objectKey: string,
    body: Readable,
    _contentType: string,
  ): Promise<{ size: number }> {
    const target = this.resolve(objectKey);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });

    let size = 0;
    body.on('data', (chunk: Buffer | string) => {
      size += Buffer.byteLength(chunk);
    });

    await pipeline(body, fs.createWriteStream(target));
    return { size };
  }

  async download(
    objectKey: string,
  ): Promise<{ stream: Readable; size?: number }> {
    const target = this.resolve(objectKey);
    const { size } = fs.statSync(target);
    return { stream: fs.createReadStream(target), size };
  }

  async delete(objectKey: string): Promise<void> {
    const target = this.resolve(objectKey);
    await fs.promises.rm(target, { force: true });
  }
}
