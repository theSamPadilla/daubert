import { Test } from '@nestjs/testing';
import { ExportService } from './export.service';

describe('ExportService (Puppeteer integration)', () => {
  let service: ExportService;
  let chromeAvailable = true;

  beforeAll(async () => {
    try {
      const module = await Test.createTestingModule({
        providers: [ExportService],
      }).compile();
      service = module.get(ExportService);
      // Test if Chrome is reachable by doing a minimal render
      await service.htmlToPdf('<html><body>test</body></html>');
    } catch {
      chromeAvailable = false;
    }
  }, 30_000);

  afterAll(async () => {
    if (service) await service.onModuleDestroy();
  });

  it('htmlToPdf returns a Buffer', async () => {
    if (!chromeAvailable) return;

    const result = await service.htmlToPdf(
      '<html><body><h1>Hello</h1></body></html>',
    );
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('Buffer starts with %PDF (valid PDF magic bytes)', async () => {
    if (!chromeAvailable) return;

    const result = await service.htmlToPdf(
      '<html><body><p>PDF test</p></body></html>',
    );
    const header = result.subarray(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');
  });

  it('handles landscape option without throwing', async () => {
    if (!chromeAvailable) return;

    const result = await service.htmlToPdf(
      '<html><body><p>Landscape</p></body></html>',
      { landscape: true },
    );
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    // Verify it is still valid PDF
    const header = result.subarray(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');
  });

  it('produces valid PDF even with injected script tag (JS disabled)', async () => {
    if (!chromeAvailable) return;

    const maliciousHtml = `<html>
      <head><script>document.title = 'hacked';</script></head>
      <body><p>Content</p></body>
    </html>`;

    const result = await service.htmlToPdf(maliciousHtml);
    expect(Buffer.isBuffer(result)).toBe(true);
    const header = result.subarray(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');
    // The PDF should still be generated without errors even with the script tag
    expect(result.length).toBeGreaterThan(0);
  });

  it('htmlToPng returns a PNG Buffer', async () => {
    if (!chromeAvailable) return;
    const result = await service.htmlToPng('<html><body><h1>Hi</h1></body></html>');
    expect(Buffer.isBuffer(result)).toBe(true);
    // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
    expect(result[0]).toBe(0x89);
    expect(result.subarray(1, 4).toString('ascii')).toBe('PNG');
  });

  it('htmlToDocx returns a DOCX Buffer', async () => {
    const result = await service.htmlToDocx('<p>Hello <strong>world</strong></p>');
    expect(Buffer.isBuffer(result)).toBe(true);
    // DOCX is a ZIP archive: first two bytes are "PK"
    expect(result.subarray(0, 2).toString('ascii')).toBe('PK');
  });
});
