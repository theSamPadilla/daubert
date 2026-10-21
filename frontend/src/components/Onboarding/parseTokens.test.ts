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

  it('ignores blank lines', () => {
    expect(parseTokens(`\n${A}\n\n${B}\n`)).toHaveLength(2);
  });
});
