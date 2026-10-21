import { parseTokens } from './parseTokens';

const A = '0xe708f17240732bbfa1baa8513f66b665fbc7ce10';
const B = '0x665660f65e94454a64b96693a67a41d440155617';

describe('parseTokens', () => {
  it('splits addresses on newlines', () => {
    const tokens = parseTokens(`${A}\n${B}`);
    expect(tokens.map((t) => t.address)).toEqual([A, B]);
    expect(tokens.every((t) => t.valid)).toBe(true);
  });

  it('splits addresses on commas and spaces', () => {
    expect(parseTokens(`${A}, ${B}`).map((t) => t.address)).toEqual([A, B]);
  });

  it('accepts a transaction hash as a valid seed input', () => {
    const hash = '0xed2c72ef1a552ddaec6dd1f5cddf0b59a8f37f82bdda5257d9c7c37db7bb9b08';
    const [tok] = parseTokens(hash);
    expect(tok).toMatchObject({ address: hash, isTxHash: true, valid: true, family: 'evm' });
  });

  it('ignores blank lines', () => {
    expect(parseTokens(`\n${A}\n\n${B}\n`)).toHaveLength(2);
  });
});
