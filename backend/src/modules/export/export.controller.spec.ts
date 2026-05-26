import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';
import { ProductionsService } from '../productions/productions.service';
import { InvestigationsService } from '../investigations/investigations.service';

/**
 * Build a minimal mock Response compatible with the controller's usage of
 * `res.setHeader()` and `res.send()`.
 */
function makeMockRes() {
  const headers: Record<string, string> = {};
  const res: any = {
    _headers: headers,
    _body: undefined as any,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    send(body: any) {
      res._body = body;
    },
  };
  return res;
}

/**
 * Build a minimal mock Request with an authenticated user.
 */
function makeMockReq(userId = 'user-1') {
  return { user: { id: userId } };
}

const FAKE_PDF = Buffer.from('%PDF-1.4 fake');
const FAKE_DOCX = Buffer.from('PK fake docx');
const FAKE_PNG = Buffer.from('\x89PNG fake');

describe('ExportController', () => {
  let controller: ExportController;
  let exportService: jest.Mocked<ExportService>;
  let productionsService: jest.Mocked<ProductionsService>;

  beforeEach(async () => {
    const mockExportService: Partial<jest.Mocked<ExportService>> = {
      htmlToPdf: jest.fn().mockResolvedValue(FAKE_PDF),
      htmlToDocx: jest.fn().mockResolvedValue(FAKE_DOCX),
      htmlToPng: jest.fn().mockResolvedValue(FAKE_PNG),
      pngToPdf: jest.fn().mockResolvedValue(FAKE_PDF),
    };

    const mockProductionsService: Partial<jest.Mocked<ProductionsService>> = {
      findOne: jest.fn(),
    };

    const mockInvestigationsService: Partial<jest.Mocked<InvestigationsService>> = {
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExportController],
      providers: [
        { provide: ExportService, useValue: mockExportService },
        { provide: ProductionsService, useValue: mockProductionsService },
        { provide: InvestigationsService, useValue: mockInvestigationsService },
      ],
    }).compile();

    controller = module.get<ExportController>(ExportController);
    exportService = module.get(ExportService);
    productionsService = module.get(ProductionsService);
  });

  // ── format gating: disallowed combinations return 400 ─────────────────────

  it('report + format "png" → 400 BadRequestException', async () => {
    (productionsService.findOne as jest.Mock).mockResolvedValue({
      id: 'prod-1',
      type: 'report',
      name: 'My Report',
      data: { content: '<p>Hello</p>' },
    });

    await expect(
      controller.exportProduction(
        'prod-1',
        { format: 'png' },
        makeMockReq(),
        makeMockRes(),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('chart + format "docx" → 400 BadRequestException', async () => {
    (productionsService.findOne as jest.Mock).mockResolvedValue({
      id: 'prod-2',
      type: 'chart',
      name: 'Volume Chart',
      data: {},
    });

    await expect(
      controller.exportProduction(
        'prod-2',
        { format: 'docx' },
        makeMockReq(),
        makeMockRes(),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('unknown format string → 400 BadRequestException', async () => {
    await expect(
      controller.exportProduction(
        'prod-3',
        { format: 'html' } as any,
        makeMockReq(),
        makeMockRes(),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // ── chronology + csv → reaches CSV branch ──────────────────────────────────

  it('chronology + format "csv" → returns text/csv with BOM and header row', async () => {
    (productionsService.findOne as jest.Mock).mockResolvedValue({
      id: 'prod-csv',
      type: 'chronology',
      name: 'Timeline',
      data: {
        entries: [
          {
            date: '2024-01-01',
            sourceUrl: 'https://etherscan.io/tx/0x1234567890abcdef',
            sourceLabel: '0x1234…',
            description: 'Initial transfer, of funds',
            details: 'Line one\nLine two',
            highlight: 'yellow',
          },
        ],
      },
    });

    const res = makeMockRes();
    await controller.exportProduction(
      'prod-csv',
      { format: 'csv' },
      makeMockReq(),
      res,
    );

    expect(res._headers['Content-Type']).toBe('text/csv; charset=utf-8');
    expect(res._headers['Content-Disposition']).toMatch(/\.csv"$/);
    const body = res._body as string;
    expect(body.charCodeAt(0)).toBe(0xfeff); // UTF-8 BOM
    expect(body).toContain('Date,Source URL,Source Label,Description,Details,Highlight');
    expect(body).toContain('"Initial transfer, of funds"'); // comma forces quoting
    expect(body).toContain('"Line one\nLine two"');         // newline forces quoting
    expect(body).toContain('yellow');
    // Did NOT touch any HTML pipeline
    expect(exportService.htmlToPdf).not.toHaveBeenCalled();
    expect(exportService.htmlToPng).not.toHaveBeenCalled();
    expect(exportService.htmlToDocx).not.toHaveBeenCalled();
  });

  it('report + format "csv" → 400 BadRequestException', async () => {
    (productionsService.findOne as jest.Mock).mockResolvedValue({
      id: 'prod-csv-bad',
      type: 'report',
      name: 'My Report',
      data: { content: '<p>x</p>' },
    });

    const res = makeMockRes();
    await expect(
      controller.exportProduction('prod-csv-bad', { format: 'csv' }, makeMockReq(), res),
    ).rejects.toThrow(BadRequestException);
  });

  // ── chronology + png → reaches PNG branch ─────────────────────────────────

  it('chronology + format "png" → reaches PNG branch (calls htmlToPng, returns image/png)', async () => {
    (productionsService.findOne as jest.Mock).mockResolvedValue({
      id: 'prod-4',
      type: 'chronology',
      name: 'Timeline',
      data: { rows: [] },
    });

    const res = makeMockRes();
    await controller.exportProduction(
      'prod-4',
      { format: 'png' },
      makeMockReq(),
      res,
    );

    expect(exportService.htmlToPng).toHaveBeenCalledTimes(1);
    expect(res._headers['Content-Type']).toBe('image/png');
    expect(res._headers['Content-Disposition']).toMatch(/\.png"$/);
    expect(res._body).toBe(FAKE_PNG);
  });

  // ── report + docx ──────────────────────────────────────────────────────────

  it('report + format "docx" → calls htmlToDocx, returns correct Content-Type', async () => {
    (productionsService.findOne as jest.Mock).mockResolvedValue({
      id: 'prod-5',
      type: 'report',
      name: 'Q1 Report',
      data: { content: '<p>Report content</p>' },
    });

    const res = makeMockRes();
    await controller.exportProduction(
      'prod-5',
      { format: 'docx' },
      makeMockReq(),
      res,
    );

    expect(exportService.htmlToDocx).toHaveBeenCalledTimes(1);
    expect(res._headers['Content-Type']).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(res._headers['Content-Disposition']).toMatch(/\.docx"$/);
    expect(res._body).toBe(FAKE_DOCX);
  });

  // ── filename field ─────────────────────────────────────────────────────────

  it('uses body.filename for Content-Disposition when provided', async () => {
    (productionsService.findOne as jest.Mock).mockResolvedValue({
      id: 'prod-6',
      type: 'chronology',
      name: 'Timeline',
      data: { rows: [] },
    });

    const res = makeMockRes();
    await controller.exportProduction(
      'prod-6',
      { format: 'pdf', filename: 'My Custom Filename' },
      makeMockReq(),
      res,
    );

    // Sanitized: spaces → _, lower-cased
    expect(res._headers['Content-Disposition']).toContain('my_custom_filename.pdf');
  });

  it('falls back to production.name for Content-Disposition when filename absent', async () => {
    (productionsService.findOne as jest.Mock).mockResolvedValue({
      id: 'prod-7',
      type: 'chronology',
      name: 'Smith Timeline',
      data: { rows: [] },
    });

    const res = makeMockRes();
    await controller.exportProduction(
      'prod-7',
      { format: 'pdf' },
      makeMockReq(),
      res,
    );

    expect(res._headers['Content-Disposition']).toContain('smith_timeline.pdf');
  });

  // ── exportGraph: filename field ────────────────────────────────────────────

  it('exportGraph uses body.filename for Content-Disposition when provided', async () => {
    const res = makeMockRes();
    const imageDataUrl = 'data:image/png;base64,iVBORw0KGgo='; // minimal valid data URL

    await controller.exportGraph(
      { name: 'graph', filename: 'Custom Graph Name', imageDataUrl },
      makeMockReq(),
      res,
    );

    expect(exportService.pngToPdf).toHaveBeenCalledTimes(1);
    expect(exportService.htmlToPdf).not.toHaveBeenCalled();
    expect(res._headers['Content-Disposition']).toContain('custom_graph_name.pdf');
  });

  it('exportGraph falls back to body.name when filename absent', async () => {
    const res = makeMockRes();
    const imageDataUrl = 'data:image/png;base64,iVBORw0KGgo=';

    await controller.exportGraph(
      { name: 'Wallet Trace Alpha', imageDataUrl },
      makeMockReq(),
      res,
    );

    expect(res._headers['Content-Disposition']).toContain('wallet_trace_alpha.pdf');
  });

  // ── exportGraph: orientation ───────────────────────────────────────────────

  it('exportGraph defaults to landscape when orientation omitted', async () => {
    const res = makeMockRes();
    const imageDataUrl = 'data:image/png;base64,iVBORw0KGgo=';

    await controller.exportGraph({ name: 'g', imageDataUrl }, makeMockReq(), res);

    expect(exportService.pngToPdf).toHaveBeenCalledWith(imageDataUrl, { landscape: true });
  });

  it('exportGraph honours orientation "portrait"', async () => {
    const res = makeMockRes();
    const imageDataUrl = 'data:image/png;base64,iVBORw0KGgo=';

    await controller.exportGraph(
      { name: 'g', imageDataUrl, orientation: 'portrait' },
      makeMockReq(),
      res,
    );

    expect(exportService.pngToPdf).toHaveBeenCalledWith(imageDataUrl, { landscape: false });
  });

  it('exportGraph honours orientation "landscape"', async () => {
    const res = makeMockRes();
    const imageDataUrl = 'data:image/png;base64,iVBORw0KGgo=';

    await controller.exportGraph(
      { name: 'g', imageDataUrl, orientation: 'landscape' },
      makeMockReq(),
      res,
    );

    expect(exportService.pngToPdf).toHaveBeenCalledWith(imageDataUrl, { landscape: true });
  });

  it('exportGraph rejects invalid orientation values', async () => {
    const res = makeMockRes();
    const imageDataUrl = 'data:image/png;base64,iVBORw0KGgo=';

    await expect(
      controller.exportGraph(
        { name: 'g', imageDataUrl, orientation: 'sideways' } as any,
        makeMockReq(),
        res,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // ── auth guard ─────────────────────────────────────────────────────────────

  it('exportProduction without authenticated user → ForbiddenException', async () => {
    await expect(
      controller.exportProduction(
        'prod-8',
        { format: 'pdf' },
        { user: undefined },
        makeMockRes(),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  // ── render options: fontFamily / fontSize / orientation ───────────────────

  describe('render options', () => {
    const chronology = {
      id: 'prod-c',
      type: 'chronology',
      name: 'Timeline',
      data: { entries: [{ date: '2026-01-01', description: 'a' }] },
    };
    const report = {
      id: 'prod-r',
      type: 'report',
      name: 'Report',
      data: { content: '<p>hi</p>' },
    };

    it('chronology pdf with orientation "landscape" → htmlToPdf called with landscape:true', async () => {
      (productionsService.findOne as jest.Mock).mockResolvedValue(chronology);
      await controller.exportProduction(
        'prod-c',
        { format: 'pdf', orientation: 'landscape' },
        makeMockReq(),
        makeMockRes(),
      );
      expect(exportService.htmlToPdf).toHaveBeenCalledWith(expect.any(String), { landscape: true });
    });

    it('chronology pdf without orientation → defaults to portrait', async () => {
      (productionsService.findOne as jest.Mock).mockResolvedValue(chronology);
      await controller.exportProduction(
        'prod-c',
        { format: 'pdf' },
        makeMockReq(),
        makeMockRes(),
      );
      expect(exportService.htmlToPdf).toHaveBeenCalledWith(expect.any(String), { landscape: false });
    });

    it('report pdf ignores orientation (always portrait)', async () => {
      (productionsService.findOne as jest.Mock).mockResolvedValue(report);
      await controller.exportProduction(
        'prod-r',
        { format: 'pdf', orientation: 'landscape' } as any,
        makeMockReq(),
        makeMockRes(),
      );
      expect(exportService.htmlToPdf).toHaveBeenCalledWith(expect.any(String), { landscape: false });
    });

    it('chronology pdf injects chosen font/size into the HTML passed to htmlToPdf', async () => {
      (productionsService.findOne as jest.Mock).mockResolvedValue(chronology);
      await controller.exportProduction(
        'prod-c',
        { format: 'pdf', fontFamily: 'georgia', fontSize: 14 },
        makeMockReq(),
        makeMockRes(),
      );
      const html = (exportService.htmlToPdf as jest.Mock).mock.calls[0][0];
      expect(html).toMatch(/font-family:\s*Georgia/);
      expect(html).toMatch(/font-size:\s*14pt/);
    });

    it('report docx injects chosen font/size into the HTML passed to htmlToDocx', async () => {
      (productionsService.findOne as jest.Mock).mockResolvedValue(report);
      await controller.exportProduction(
        'prod-r',
        { format: 'docx', fontFamily: 'times', fontSize: 12 },
        makeMockReq(),
        makeMockRes(),
      );
      const html = (exportService.htmlToDocx as jest.Mock).mock.calls[0][0];
      expect(html).toMatch(/font-family:\s*'Times New Roman'/);
      expect(html).toMatch(/font-size:\s*12pt/);
    });

    it('rejects an unknown fontFamily', async () => {
      (productionsService.findOne as jest.Mock).mockResolvedValue(report);
      await expect(
        controller.exportProduction(
          'prod-r',
          { format: 'pdf', fontFamily: 'comic-sans' } as any,
          makeMockReq(),
          makeMockRes(),
        ),
      ).rejects.toThrow(/fontFamily/);
    });

    it('rejects an unknown fontSize', async () => {
      (productionsService.findOne as jest.Mock).mockResolvedValue(report);
      await expect(
        controller.exportProduction(
          'prod-r',
          { format: 'pdf', fontSize: 99 } as any,
          makeMockReq(),
          makeMockRes(),
        ),
      ).rejects.toThrow(/fontSize/);
    });

    it('rejects an unknown orientation', async () => {
      (productionsService.findOne as jest.Mock).mockResolvedValue(chronology);
      await expect(
        controller.exportProduction(
          'prod-c',
          { format: 'pdf', orientation: 'sideways' } as any,
          makeMockReq(),
          makeMockRes(),
        ),
      ).rejects.toThrow(/orientation/);
    });
  });
});
