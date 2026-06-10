import { LocalDiskStorageProvider } from './local-disk-storage.provider';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function collect(stream: Readable): Promise<Buffer> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c) => chunks.push(Buffer.from(c)));
    stream.on('end', () => res(Buffer.concat(chunks)));
    stream.on('error', rej);
  });
}

describe('LocalDiskStorageProvider', () => {
  const base = path.join(os.tmpdir(), `dr-test-${Date.now()}`);
  const provider = new LocalDiskStorageProvider(base);
  const key = 'org/o1/case/c1/f1';

  afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

  it('uploads, reports byte size, downloads identical bytes, deletes', async () => {
    const payload = Buffer.from('hello data room');
    const { size } = await provider.upload(key, Readable.from(payload), 'text/plain');
    expect(size).toBe(payload.length);

    const { stream, size: dlSize } = await provider.download(key);
    expect(dlSize).toBe(payload.length);
    expect((await collect(stream)).equals(payload)).toBe(true);

    await provider.delete(key);
    await expect(provider.download(key)).rejects.toBeDefined();
  });

  it('delete is idempotent on a missing key', async () => {
    await expect(provider.delete('org/o1/case/c1/missing')).resolves.toBeUndefined();
  });

  it('rejects path traversal keys', async () => {
    await expect(provider.upload('../escape', Readable.from(Buffer.from('x')), 'text/plain')).rejects.toBeDefined();
  });
});
