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
});
