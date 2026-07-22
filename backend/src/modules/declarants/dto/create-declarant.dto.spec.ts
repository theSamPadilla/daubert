import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateDeclarantDto } from './create-declarant.dto';
import { UpdateDeclarantDto } from './update-declarant.dto';

/**
 * Regression coverage for the class-transformer collapse bug: under the
 * global `ValidationPipe({ whitelist: true, transform: true, transformOptions:
 * { enableImplicitConversion: true } })` (see `src/main.ts`), class-transformer
 * recursed into each object element of the top-level `qualifications`/
 * `priorTestimony` arrays and re-attached each paragraph's properties directly
 * onto the array element as named (non-index) properties, instead of leaving
 * a plain object at that index. Direct property access (`el.text`) still
 * "worked" in JS, which is why a naive unit test could miss this — but the
 * array element is no longer JSON-serializable as an object: `JSON.stringify`
 * (and therefore `pg`'s jsonb driver, which the TypeORM Postgres driver uses to
 * write `jsonb` columns) only serializes an array's integer-indexed elements,
 * so each paragraph silently became `{}`/`[]` on the wire to Postgres. That is
 * exactly what the QA report observed: the HTTP request body carried a
 * populated `qualifications` array, but `jsonb_array_length(qualifications)`
 * came back `0` after save.
 *
 * These tests replicate the pipe's exact transform step (same
 * `transformOptions`) and assert on the JSON-round-tripped shape (mirroring
 * what actually gets written to Postgres), rather than calling the service
 * directly — a service-level unit test bypasses class-transformer entirely
 * and cannot catch this class of bug.
 */
const PIPE_TRANSFORM_OPTIONS = { enableImplicitConversion: true };

/** Mirrors what TypeORM's `pg` driver does when writing a `jsonb` column. */
function asStoredJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe('CreateDeclarantDto — ValidationPipe transform', () => {
  it('does not collapse qualifications paragraph objects when JSON-serialized (as jsonb would be)', () => {
    const plain = {
      displayName: 'X',
      qualifications: [
        { id: 'a', text: 'I have over eight years...', subItems: [], exhibitIds: [], footnotes: [] },
      ],
    };

    const result = plainToInstance(CreateDeclarantDto, plain, PIPE_TRANSFORM_OPTIONS);
    const stored = asStoredJson(result.qualifications);

    expect(stored).toEqual([
      { id: 'a', text: 'I have over eight years...', subItems: [], exhibitIds: [], footnotes: [] },
    ]);
  });

  it('does not collapse priorTestimony string entries', () => {
    const plain = {
      displayName: 'X',
      priorTestimony: ['Case A', 'Case B'],
    };

    const result = plainToInstance(CreateDeclarantDto, plain, PIPE_TRANSFORM_OPTIONS);

    expect(asStoredJson(result.priorTestimony)).toEqual(['Case A', 'Case B']);
  });

  it('passes class-validator with a well-formed qualification and no whitelist stripping', async () => {
    const plain = {
      displayName: 'X',
      qualifications: [
        { id: 'a', text: 'hi', subItems: [], exhibitIds: [], footnotes: [] },
      ],
    };

    const result = plainToInstance(CreateDeclarantDto, plain, PIPE_TRANSFORM_OPTIONS);
    const errors = await validate(result, { whitelist: true });

    expect(errors).toEqual([]);
    expect(asStoredJson(result.qualifications)).toEqual([
      { id: 'a', text: 'hi', subItems: [], exhibitIds: [], footnotes: [] },
    ]);
  });
});

describe('UpdateDeclarantDto — ValidationPipe transform', () => {
  it('does not collapse qualifications paragraph objects when JSON-serialized (as jsonb would be)', () => {
    const plain = {
      qualifications: [
        { id: 'a', text: 'updated text', subItems: [], exhibitIds: [], footnotes: [] },
      ],
    };

    const result = plainToInstance(UpdateDeclarantDto, plain, PIPE_TRANSFORM_OPTIONS);

    expect(asStoredJson(result.qualifications)).toEqual([
      { id: 'a', text: 'updated text', subItems: [], exhibitIds: [], footnotes: [] },
    ]);
  });

  it('does not collapse priorTestimony string entries', () => {
    const plain = { priorTestimony: ['Case A'] };

    const result = plainToInstance(UpdateDeclarantDto, plain, PIPE_TRANSFORM_OPTIONS);

    expect(asStoredJson(result.priorTestimony)).toEqual(['Case A']);
  });
});
