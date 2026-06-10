import { Readable } from 'stream';

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

export interface StorageProvider {
  /** Streams `body` to `objectKey`. Returns the number of bytes written. */
  upload(
    objectKey: string,
    body: Readable,
    contentType: string,
  ): Promise<{ size: number }>;
  /** Opens a read stream for `objectKey`. `size` is the object size in bytes if known. */
  download(objectKey: string): Promise<{ stream: Readable; size?: number }>;
  /** Deletes `objectKey`. Idempotent — never throws if the object is absent. */
  delete(objectKey: string): Promise<void>;
}
