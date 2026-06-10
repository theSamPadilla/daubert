import { PassThrough, Readable } from 'stream';

const createWriteStream = jest.fn();
const getMetadata = jest.fn();
const createReadStream = jest.fn();
const deleteFn = jest.fn();
const file = jest.fn();
const bucket = jest.fn();

jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn().mockImplementation(() => ({ bucket })),
}));

function collect(stream: Readable): Promise<Buffer> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c) => chunks.push(Buffer.from(c)));
    stream.on('end', () => res(Buffer.concat(chunks)));
    stream.on('error', rej);
  });
}

// Imported after the mock is registered.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GcsStorageProvider } = require('./gcs-storage.provider');

describe('GcsStorageProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    file.mockReturnValue({
      createWriteStream,
      getMetadata,
      createReadStream,
      delete: deleteFn,
    });
    bucket.mockReturnValue({ file });
  });

  it('uploads: pipes body and resolves with byte count', async () => {
    const ws = new PassThrough();
    createWriteStream.mockReturnValue(ws);
    // PassThrough emits `finish` once the source ends; drain it so it fires.
    ws.resume();

    const provider = new GcsStorageProvider('bkt');
    const payload = Buffer.from('hello world');
    const { size } = await provider.upload(
      'org/o1/k',
      Readable.from(payload),
      'text/plain',
    );

    expect(size).toBe(payload.length);
    expect(bucket).toHaveBeenCalledWith('bkt');
    expect(file).toHaveBeenCalledWith('org/o1/k');
    expect(createWriteStream).toHaveBeenCalledWith({
      resumable: true,
      contentType: 'text/plain',
    });
  });

  it('downloads: returns the stream and numeric size', async () => {
    getMetadata.mockResolvedValue([{ size: '11' }]);
    const rs = Readable.from(Buffer.from('hello world'));
    createReadStream.mockReturnValue(rs);

    const provider = new GcsStorageProvider('bkt');
    const { stream, size } = await provider.download('org/o1/k');

    expect(size).toBe(11);
    expect((await collect(stream)).toString()).toBe('hello world');
  });

  it('deletes: calls file.delete with ignoreNotFound', async () => {
    deleteFn.mockResolvedValue(undefined);

    const provider = new GcsStorageProvider('bkt');
    await provider.delete('org/o1/k');

    expect(deleteFn).toHaveBeenCalledWith({ ignoreNotFound: true });
  });
});
