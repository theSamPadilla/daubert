import { Readable } from 'stream';
import { Storage } from '@google-cloud/storage';
import { StorageProvider } from './storage-provider.interface';

/**
 * Google Cloud Storage-backed StorageProvider.
 *
 * Authenticates via Application Default Credentials (`new Storage()` with no
 * explicit keys) — set `GOOGLE_APPLICATION_CREDENTIALS` or run on GCP with a
 * service account attached.
 */
export class GcsStorageProvider implements StorageProvider {
  private readonly storage: Storage;
  private readonly bucketName: string;

  constructor(bucketName: string) {
    this.bucketName = bucketName;
    this.storage = new Storage();
  }

  private bucket() {
    return this.storage.bucket(this.bucketName);
  }

  upload(
    objectKey: string,
    body: Readable,
    contentType: string,
  ): Promise<{ size: number }> {
    return new Promise((resolve, reject) => {
      let size = 0;
      body.on('data', (chunk: Buffer | string) => {
        size += Buffer.byteLength(chunk);
      });

      const writeStream = this.bucket()
        .file(objectKey)
        .createWriteStream({ resumable: true, contentType });

      body.on('error', reject);
      writeStream.on('error', reject);
      writeStream.on('finish', () => resolve({ size }));

      body.pipe(writeStream);
    });
  }

  async download(
    objectKey: string,
  ): Promise<{ stream: Readable; size?: number }> {
    const file = this.bucket().file(objectKey);
    const [meta] = await file.getMetadata();
    return { stream: file.createReadStream(), size: Number(meta.size) };
  }

  async delete(objectKey: string): Promise<void> {
    await this.bucket().file(objectKey).delete({ ignoreNotFound: true });
  }
}
