import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider } from '../ai/providers/anthropic.provider';
import { TokenUsageService } from '../superadmin/token-usage/token-usage.service';
import { normalizeQualifications, normalizePriorTestimony } from './declarants.service';

/** The PDF source a declarant draft is extracted from. */
export type DeclarantExtractionSource = 'cv' | 'prior_declaration';

/** Metering context: who ran the extraction (org + user), for token accounting. */
export interface ExtractionMeterContext {
  orgId: string | null;
  userId: string | null;
}

/**
 * The draft the extraction produces — the optional fields of a create-declarant
 * request. Every field is optional: unknown fields stay absent (the model is
 * told never to invent). Arrays are coerced through the shared normalizers so
 * `qualifications` are well-formed paragraph objects and `priorTestimony` is a
 * plain string[] before the draft ever reaches the review form.
 */
export interface DeclarantDraft {
  displayName?: string;
  title?: string;
  firm?: string;
  qualifications: Record<string, unknown>[];
  priorTestimony: string[];
  hourlyRate?: string;
  nonContingencyDisclosure?: string;
  dateOfBirth?: string;
  address?: string;
  cvExhibit?: string;
}

const MAX_TOKENS = 4096;

/**
 * The forced-tool input schema — the draft shape the model must return. Kept
 * loose (all optional, no `required`) so the model omits fields it can't source
 * rather than inventing values. `qualifications` is an array of paragraph
 * objects `{ text }`; the service normalizes each into the full stored shape.
 */
const DRAFT_TOOL: Anthropic.Tool = {
  name: 'draft_declarant',
  description:
    'Return the declarant profile fields extracted from the document. Omit any field you cannot source from the document — never invent a value.',
  input_schema: {
    type: 'object',
    properties: {
      displayName: { type: 'string', description: "The declarant's full name." },
      title: { type: 'string', description: 'Professional title, if stated.' },
      firm: { type: 'string', description: 'Employer / firm, if stated.' },
      qualifications: {
        type: 'array',
        description:
          'Credential / background paragraphs, first-person and declaration-ready.',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'One qualification paragraph.' },
          },
          required: ['text'],
        },
      },
      priorTestimony: {
        type: 'array',
        description: 'Prior expert-testimony matters mentioned in the document.',
        items: { type: 'string' },
      },
      hourlyRate: { type: 'string', description: 'Hourly rate, if stated.' },
      nonContingencyDisclosure: {
        type: 'string',
        description: 'Non-contingency / independence disclosure, if recited.',
      },
      dateOfBirth: { type: 'string', description: 'Date of birth, if recited.' },
      address: { type: 'string', description: 'Address, if recited.' },
      cvExhibit: { type: 'string', description: 'CV exhibit reference, if stated.' },
    },
  },
};

const CV_PROMPT = `You are extracting a testifying-expert profile from a curriculum vitae (CV / resume).

Extract:
- The person's full name (displayName), professional title, and firm/employer.
- Their credentials, education, employment history, publications, and relevant background as first-person, declaration-ready qualification paragraphs — e.g. "I hold a Ph.D. in Chemistry from...", "I have been employed as...", "I have testified as an expert...". Each paragraph is one qualifications entry.
- Any list of prior expert testimony (priorTestimony).
- The hourly rate, if stated.

Leave any field you cannot source from the CV absent — never invent a name, credential, rate, or testimony entry. Return only what the document supports.`;

const PRIOR_DECLARATION_PROMPT = `You are extracting a testifying-expert profile from a previously filed expert declaration or affidavit.

Extract:
- The declarant's full name (displayName), professional title, and firm/employer.
- The declarant's qualifications section, lifting each paragraph near-verbatim (they are already first-person and declaration-ready). Each paragraph is one qualifications entry.
- Date of birth and address if recited in the jurat / preamble (common in Texas-style declarations).
- Any prior-testimony mentions (priorTestimony).
- The hourly rate and any non-contingency / independence disclosure, if recited.

EXCLUDE everything matter-specific: the opinions, findings, analysis, and exhibits about the particular case. You are capturing only the reusable profile (who the declarant is and why they are qualified), not their opinions in that matter. Leave any field you cannot source absent — never invent.`;

/**
 * Turn an uploaded PDF into a reviewable declarant draft via a single forced-tool
 * Anthropic call. Persists nothing — the draft prefills the create form for human
 * review. Token usage is metered like every other LLM call in the codebase.
 */
@Injectable()
export class DeclarantExtractionService {
  constructor(
    private readonly provider: AnthropicProvider,
    private readonly tokenUsageService: TokenUsageService,
  ) {}

  async extract(
    pdf: Buffer,
    source: DeclarantExtractionSource,
    meterCtx: ExtractionMeterContext,
  ): Promise<DeclarantDraft> {
    const prompt = source === 'cv' ? CV_PROMPT : PRIOR_DECLARATION_PROMPT;

    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdf.toString('base64'),
            },
          },
          { type: 'text', text: prompt },
        ],
      },
    ];

    let result: Awaited<ReturnType<AnthropicProvider['extractJson']>>;
    try {
      result = await this.provider.extractJson({
        maxTokens: MAX_TOKENS,
        messages,
        tool: DRAFT_TOOL,
      });
    } catch (err) {
      throw this.wrapProviderError(err);
    }

    // Meter the call — extraction is billed like any other LLM call.
    await this.tokenUsageService.record({
      orgId: meterCtx.orgId,
      userId: meterCtx.userId,
      caseId: null,
      conversationId: null,
      messageId: null,
      surface: 'declarant-extraction',
      model: result.model,
      inputTokens: result.usage.input_tokens ?? 0,
      outputTokens: result.usage.output_tokens ?? 0,
      cacheReadInputTokens: result.usage.cache_read_input_tokens ?? 0,
      cacheCreation5mInputTokens: 0,
      cacheCreation1hInputTokens: 0,
    });

    const raw = result.input ?? {};
    return this.toDraft(raw);
  }

  /** Coerce the raw tool input into a well-formed draft with normalized arrays. */
  private toDraft(raw: Record<string, unknown>): DeclarantDraft {
    const draft: DeclarantDraft = {
      qualifications: normalizeQualifications(raw.qualifications),
      priorTestimony: normalizePriorTestimony(raw.priorTestimony),
    };
    if (typeof raw.displayName === 'string') draft.displayName = raw.displayName;
    if (typeof raw.title === 'string') draft.title = raw.title;
    if (typeof raw.firm === 'string') draft.firm = raw.firm;
    if (typeof raw.hourlyRate === 'string') draft.hourlyRate = raw.hourlyRate;
    if (typeof raw.nonContingencyDisclosure === 'string') {
      draft.nonContingencyDisclosure = raw.nonContingencyDisclosure;
    }
    if (typeof raw.dateOfBirth === 'string') draft.dateOfBirth = raw.dateOfBirth;
    if (typeof raw.address === 'string') draft.address = raw.address;
    if (typeof raw.cvExhibit === 'string') draft.cvExhibit = raw.cvExhibit;
    return draft;
  }

  /**
   * Wrap provider failures. Anthropic size/page errors (the request or PDF is
   * too big) are the user's problem → 400; anything else is an upstream failure
   * → 502.
   */
  private wrapProviderError(err: unknown): BadRequestException | BadGatewayException {
    const message = err instanceof Error ? err.message : String(err);
    if (/size|page|too large|maximum/i.test(message)) {
      return new BadRequestException(
        'The PDF is too large or has too many pages to process. Please upload a smaller file.',
      );
    }
    return new BadGatewayException('The extraction service is temporarily unavailable. Please try again.');
  }
}
