import { ConfigService } from '@nestjs/config';
import { Provider } from '@nestjs/common';
import { STORAGE_PROVIDER, StorageProvider } from './storage-provider.interface';
import { GcsStorageProvider } from './gcs-storage.provider';
import { LocalDiskStorageProvider } from './local-disk-storage.provider';

/**
 * Selects the StorageProvider implementation at module init:
 * - `GCS_DATA_ROOM_BUCKET` set → GCS.
 * - otherwise, non-production → local disk.
 * - production with no bucket → fatal (data must not live on ephemeral disk).
 */
export const storageProvider: Provider = {
  provide: STORAGE_PROVIDER,
  useFactory: (config: ConfigService): StorageProvider => {
    const bucket = config.get<string>('GCS_DATA_ROOM_BUCKET');
    if (bucket) {
      return new GcsStorageProvider(bucket);
    }
    if (config.get<string>('NODE_ENV') !== 'production') {
      return new LocalDiskStorageProvider();
    }
    throw new Error('GCS_DATA_ROOM_BUCKET required in production');
  },
  inject: [ConfigService],
};
