import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { DeclarantExtractionService } from './declarant-extraction.service';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ORG_ID = 'org-1';
const USER_ID = 'user-1';
const METER_CTX = { orgId: ORG_ID, userId: USER_ID };
const PDF = Buffer.from('%PDF-1.7 fake pdf bytes');

/** A well-formed provider `usage` object (non-beta Anthropic.Usage shape). */
function makeUsage(overrides: Record<string, unknown> = {}) {
  return {
    input_tokens: 100,
    output_tokens: 40,
    cache_read_input_tokens: 10,
    cache_creation_input_tokens: 0,
    ...overrides,
  };
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockProvider = {
  extractJson: jest.fn(),
};

const mockTokenUsage = {
  record: jest.fn(),
};

function makeService() {
  return new DeclarantExtractionService(mockProvider as any, mockTokenUsage as any);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTokenUsage.record.mockResolvedValue(undefined);
});

// ── Passthrough + coercion ──────────────────────────────────────────────────────

describe('DeclarantExtractionService — passthrough + coercion', () => {
  it('passes a well-formed draft through, normalizing qualifications into paragraph objects', async () => {
    mockProvider.extractJson.mockResolvedValue({
      input: {
        displayName: 'Dr. Jane Smith',
        title: 'Forensic Analyst',
        firm: 'Acme Forensics',
        qualifications: [{ text: 'I hold a PhD in chemistry.' }],
        priorTestimony: ['Case A', 'Case B'],
        hourlyRate: '$500/hr',
      },
      usage: makeUsage(),
      model: 'claude-sonnet-4-6',
    });

    const draft = await makeService().extract(PDF, 'cv', METER_CTX);

    expect(draft.displayName).toBe('Dr. Jane Smith');
    expect(draft.title).toBe('Forensic Analyst');
    expect(draft.firm).toBe('Acme Forensics');
    // qualifications coerced to well-formed paragraph objects
    expect(draft.qualifications).toEqual([
      expect.objectContaining({
        text: 'I hold a PhD in chemistry.',
        subItems: [],
        exhibitIds: [],
        footnotes: [],
      }),
    ]);
    expect((draft.qualifications as any[])[0].id).toEqual(expect.any(String));
    expect(draft.priorTestimony).toEqual(['Case A', 'Case B']);
    expect(draft.hourlyRate).toBe('$500/hr');
  });

  it('coerces malformed qualifications/priorTestimony via the normalizers', async () => {
    mockProvider.extractJson.mockResolvedValue({
      input: {
        displayName: 'Messy',
        qualifications: [[], { id: 'keep', subItems: [] }, 'nope'],
        priorTestimony: ['Case A', 42, null, { foo: 'bar' }, 'Case B'],
      },
      usage: makeUsage(),
      model: 'claude-sonnet-4-6',
    });

    const draft = await makeService().extract(PDF, 'prior_declaration', METER_CTX);

    // The array `[]` and the string `'nope'` are dropped; the object survives with
    // a defaulted `text` and array fields.
    expect(draft.qualifications).toEqual([
      { id: 'keep', text: '', subItems: [], exhibitIds: [], footnotes: [] },
    ]);
    expect(draft.priorTestimony).toEqual(['Case A', 'Case B']);
  });

  it('returns empty arrays when the provider returns a null input', async () => {
    mockProvider.extractJson.mockResolvedValue({
      input: null,
      usage: makeUsage(),
      model: 'claude-sonnet-4-6',
    });

    const draft = await makeService().extract(PDF, 'cv', METER_CTX);

    expect(draft.qualifications).toEqual([]);
    expect(draft.priorTestimony).toEqual([]);
    expect(draft.displayName).toBeUndefined();
  });
});

// ── Provider invocation ──────────────────────────────────────────────────────────

describe('DeclarantExtractionService — provider invocation', () => {
  it('passes a base64 document block for the PDF plus a text prompt', async () => {
    mockProvider.extractJson.mockResolvedValue({
      input: {},
      usage: makeUsage(),
      model: 'claude-sonnet-4-6',
    });

    await makeService().extract(PDF, 'cv', METER_CTX);

    const params = mockProvider.extractJson.mock.calls[0][0];
    const content = params.messages[0].content;
    const docBlock = content.find((b: any) => b.type === 'document');
    const textBlock = content.find((b: any) => b.type === 'text');

    expect(params.messages[0].role).toBe('user');
    expect(docBlock).toEqual({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: PDF.toString('base64'),
      },
    });
    expect(textBlock).toBeDefined();
    expect(typeof textBlock.text).toBe('string');
    // Forced tool whose input schema is the draft shape
    expect(params.tool.name).toBe('draft_declarant');
    expect(params.tool.input_schema.type).toBe('object');
  });

  it('uses a different prompt for cv vs prior_declaration', async () => {
    mockProvider.extractJson.mockResolvedValue({
      input: {},
      usage: makeUsage(),
      model: 'claude-sonnet-4-6',
    });
    const service = makeService();

    await service.extract(PDF, 'cv', METER_CTX);
    const cvPrompt = mockProvider.extractJson.mock.calls[0][0].messages[0].content.find(
      (b: any) => b.type === 'text',
    ).text;

    jest.clearAllMocks();
    mockProvider.extractJson.mockResolvedValue({
      input: {},
      usage: makeUsage(),
      model: 'claude-sonnet-4-6',
    });
    mockTokenUsage.record.mockResolvedValue(undefined);

    await service.extract(PDF, 'prior_declaration', METER_CTX);
    const priorPrompt = mockProvider.extractJson.mock.calls[0][0].messages[0].content.find(
      (b: any) => b.type === 'text',
    ).text;

    expect(cvPrompt).not.toEqual(priorPrompt);
  });
});

// ── Metering ─────────────────────────────────────────────────────────────────────

describe('DeclarantExtractionService — metering', () => {
  it('records token usage mapped from the provider usage', async () => {
    mockProvider.extractJson.mockResolvedValue({
      input: {},
      usage: makeUsage({ input_tokens: 321, output_tokens: 12, cache_read_input_tokens: 7 }),
      model: 'claude-sonnet-4-6',
    });

    await makeService().extract(PDF, 'cv', METER_CTX);

    expect(mockTokenUsage.record).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG_ID,
        userId: USER_ID,
        caseId: null,
        conversationId: null,
        messageId: null,
        surface: 'declarant-extraction',
        model: 'claude-sonnet-4-6',
        inputTokens: 321,
        outputTokens: 12,
        cacheReadInputTokens: 7,
        cacheCreation5mInputTokens: 0,
        cacheCreation1hInputTokens: 0,
      }),
    );
  });

  it('defaults missing usage counts to zero', async () => {
    mockProvider.extractJson.mockResolvedValue({
      input: {},
      usage: {},
      model: 'claude-sonnet-4-6',
    });

    await makeService().extract(PDF, 'cv', METER_CTX);

    expect(mockTokenUsage.record).toHaveBeenCalledWith(
      expect.objectContaining({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
      }),
    );
  });
});

// ── Error wrapping ────────────────────────────────────────────────────────────────

describe('DeclarantExtractionService — error wrapping', () => {
  it('wraps a generic provider failure in BadGatewayException', async () => {
    mockProvider.extractJson.mockRejectedValue(new Error('connection reset'));

    await expect(makeService().extract(PDF, 'cv', METER_CTX)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(mockTokenUsage.record).not.toHaveBeenCalled();
  });

  it('maps an Anthropic "too large" error to BadRequestException', async () => {
    mockProvider.extractJson.mockRejectedValue(
      new Error('Request too large: the PDF exceeds the maximum allowed size'),
    );

    await expect(makeService().extract(PDF, 'cv', METER_CTX)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('maps an Anthropic page-count error to BadRequestException', async () => {
    mockProvider.extractJson.mockRejectedValue(
      new Error('The document has too many pages (exceeds the maximum of 100 pages)'),
    );

    await expect(makeService().extract(PDF, 'cv', METER_CTX)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
