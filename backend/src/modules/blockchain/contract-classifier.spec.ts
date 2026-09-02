import { ContractClassifier, EthCall } from './contract-classifier';

const USDC = '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359';
const NFT = '0x251be3a17af4892035c37ebf5890f4a4d889dcad';
const ROUTER = '0x07d79f0f6879f4d555431573320236628d16083e';
const EOA = '0x51c0d73faec63d6471e434a483e0874f6cb17203';

const TRUE_WORD = '0x0000000000000000000000000000000000000000000000000000000000000001';
const FALSE_WORD = '0x0000000000000000000000000000000000000000000000000000000000000000';
// abi.encode("USDC") — offset 0x20, length 4, then the bytes
const USDC_SYMBOL =
  '0x0000000000000000000000000000000000000000000000000000000000000020' +
  '0000000000000000000000000000000000000000000000000000000000000004' +
  '5553444300000000000000000000000000000000000000000000000000000000';
const SIX = '0x0000000000000000000000000000000000000000000000000000000000000006';

const SELECTOR = {
  supports721: `0x01ffc9a780ac58cd${'0'.repeat(56)}`,
  supports1155: `0x01ffc9a7d9b67a26${'0'.repeat(56)}`,
  decimals: '0x313ce567',
  symbol: '0x95d89b41',
};

/**
 * Builds an EthCall stub that dispatches on (address, full calldata). Keying on
 * the full calldata — rather than just the 4-byte selector — is required for
 * `supportsInterface`, whose two interface-id calls (0x80ac58cd for ERC-721,
 * 0xd9b67a26 for ERC-1155) share the same selector and are only distinguished
 * by the argument that follows it.
 */
function stubCall(table: Record<string, Record<string, string | Error>>): EthCall {
  return jest.fn(async (address: string, data: string) => {
    const answer = table[address.toLowerCase()]?.[data];
    if (answer === undefined) throw new Error('execution reverted');
    if (answer instanceof Error) throw answer;
    return answer;
  });
}

describe('ContractClassifier', () => {
  it('classifies a contract that answers supportsInterface(0x80ac58cd) as erc721', async () => {
    const call = stubCall({
      [NFT]: {
        [SELECTOR.supports721]: TRUE_WORD,
        [SELECTOR.symbol]:
          '0x0000000000000000000000000000000000000000000000000000000000000020' +
          '0000000000000000000000000000000000000000000000000000000000000009' +
          '434f555254594152440000000000000000000000000000000000000000000000',
      },
    });
    const c = new ContractClassifier(async () => '0x60806040', call);
    const out = await c.classify('polygon', NFT);
    expect(out.addressType).toBe('contract');
    expect(out.tokenStandard).toBe('erc721');
    expect(out.symbol).toBe('COURTYARD');
  });

  it('classifies a reverting-supportsInterface token with decimals() as erc20', async () => {
    const call = stubCall({
      [USDC]: { '0x313ce567': SIX, '0x95d89b41': USDC_SYMBOL },
    });
    const c = new ContractClassifier(async () => '0x60806040', call);
    const out = await c.classify('polygon', USDC);
    expect(out).toMatchObject({
      addressType: 'contract',
      tokenStandard: 'erc20',
      decimals: 6,
      symbol: 'USDC',
    });
  });

  it('classifies a contract that returns false everywhere as a plain contract', async () => {
    const call = stubCall({
      [ROUTER]: {
        [SELECTOR.supports721]: FALSE_WORD,
        [SELECTOR.supports1155]: FALSE_WORD,
      },
    });
    const c = new ContractClassifier(async () => '0x60806040', call);
    const out = await c.classify('polygon', ROUTER);
    expect(out.addressType).toBe('contract');
    expect(out.tokenStandard).toBeUndefined();
    expect(out.symbol).toBeUndefined();
  });

  it('classifies a contract answering false for 721 and true for 1155 as erc1155', async () => {
    // The stub table used to key on the 4-byte selector alone, so the two
    // supportsInterface calls (721 vs 1155) were indistinguishable and this
    // branch had no coverage at all.
    const call = stubCall({
      [ROUTER]: {
        [SELECTOR.supports721]: FALSE_WORD,
        [SELECTOR.supports1155]: TRUE_WORD,
      },
    });
    const c = new ContractClassifier(async () => '0x60806040', call);
    const out = await c.classify('polygon', ROUTER);
    expect(out.addressType).toBe('contract');
    expect(out.tokenStandard).toBe('erc1155');
  });

  it('classifies an address with no code as a wallet without probing', async () => {
    const call = stubCall({});
    const c = new ContractClassifier(async () => '0x', call);
    const out = await c.classify('polygon', EOA);
    expect(out).toEqual({ addressType: 'wallet' });
    expect(call).not.toHaveBeenCalled();
  });

  it('caches by chain and address so a second classify makes no further calls', async () => {
    const getCode = jest.fn(async () => '0x60806040');
    const call = stubCall({ [USDC]: { '0x313ce567': SIX, '0x95d89b41': USDC_SYMBOL } });
    const c = new ContractClassifier(getCode, call);
    await c.classify('polygon', USDC);
    const callsAfterFirst = (call as jest.Mock).mock.calls.length;
    await c.classify('polygon', USDC.toUpperCase());
    expect(getCode).toHaveBeenCalledTimes(1);
    expect((call as jest.Mock).mock.calls.length).toBe(callsAfterFirst);
  });

  it('decodes a bytes32 symbol from tokens that predate the string ABI', async () => {
    const call = stubCall({
      [USDC]: {
        '0x313ce567': SIX,
        // "MKR" packed into a bare bytes32, no offset/length header
        '0x95d89b41':
          '0x4d4b520000000000000000000000000000000000000000000000000000000000',
      },
    });
    const c = new ContractClassifier(async () => '0x60806040', call);
    expect((await c.classify('polygon', USDC)).symbol).toBe('MKR');
  });

  it('does not cache a classification the chain could not answer', async () => {
    // A transient RPC failure must not pin a token contract as a plain wallet
    // for the process lifetime: the graph would go on asserting that as fact.
    let failNext = true;
    const getCode = jest.fn(async () => {
      if (failNext) {
        failNext = false;
        throw new Error('network down');
      }
      return '0x60806040';
    });
    const call = stubCall({ [USDC]: { '0x313ce567': SIX, '0x95d89b41': USDC_SYMBOL } });
    const c = new ContractClassifier(getCode, call);

    expect(await c.classify('polygon', USDC)).toEqual({ addressType: 'wallet' });

    // Second call re-probes rather than serving the failed result from cache.
    expect(await c.classify('polygon', USDC)).toMatchObject({
      addressType: 'contract',
      tokenStandard: 'erc20',
      symbol: 'USDC',
    });
    expect(getCode).toHaveBeenCalledTimes(2);
  });

  it('returns a plain contract rather than throwing when every probe fails', async () => {
    const call: EthCall = jest.fn(async () => {
      throw new Error('network down');
    });
    const c = new ContractClassifier(async () => '0x60806040', call);
    await expect(c.classify('polygon', ROUTER)).resolves.toEqual({ addressType: 'contract' });
  });

  it('does not classify a malformed (non-32-byte) decimals() response as erc20', async () => {
    // Routers and proxies with a non-reverting fallback can return data that
    // isn't a properly padded 32-byte word. `decodeUint` would happily parse
    // a short hex string like this as 0 — the length guard is what rejects it.
    const call = stubCall({
      [ROUTER]: {
        [SELECTOR.supports721]: FALSE_WORD,
        [SELECTOR.supports1155]: FALSE_WORD,
        [SELECTOR.decimals]: '0x0',
      },
    });
    const c = new ContractClassifier(async () => '0x60806040', call);
    const out = await c.classify('polygon', ROUTER);
    expect(out.tokenStandard).toBeUndefined();
    expect(out.decimals).toBeUndefined();
  });

  // A well-formed 32-byte zero word is legitimately ambiguous: it is exactly
  // what a fallback with no matching selector returns, AND it is exactly what
  // a real ERC-20 with 0 decimals returns. The length guard above only rejects
  // malformed (wrong-length) responses — it cannot and does not attempt to
  // resolve this case, which is why a well-formed zero word is still read as
  // decimals=0 here. Not solvable from this probe alone.
  it('reads a well-formed zero-decimals response as legitimate erc20 (known false-positive risk for non-reverting fallbacks)', async () => {
    const call = stubCall({
      [ROUTER]: {
        [SELECTOR.supports721]: FALSE_WORD,
        [SELECTOR.supports1155]: FALSE_WORD,
        [SELECTOR.decimals]: FALSE_WORD,
      },
    });
    const c = new ContractClassifier(async () => '0x60806040', call);
    const out = await c.classify('polygon', ROUTER);
    expect(out.tokenStandard).toBe('erc20');
    expect(out.decimals).toBe(0);
  });

  // Regression: Etherscan reports rate-limiting and auth failures in a
  // non-JSON-RPC envelope whose `result` is a human-readable string. If such a
  // string reaches the classifier it is not `0x`, so a naive has-code test reads
  // it as bytecode and asserts an ordinary wallet is a contract — permanently,
  // once results are persisted.
  it('treats a non-hex getCode payload as undetermined, not as bytecode', async () => {
    const call = stubCall({});
    const c = new ContractClassifier(async () => 'Max rate limit reached', call);
    const out = await c.classify('polygon', EOA);
    expect(out).toEqual({ addressType: 'wallet' });
    // Never cached: an undetermined probe must be retryable.
    const second = await c.classify('polygon', EOA);
    expect(second).toEqual({ addressType: 'wallet' });
    expect(call).not.toHaveBeenCalled();
  });

  it('does not cache an undetermined non-hex result, so a later good probe wins', async () => {
    let bad = true;
    const getCode = jest.fn(async () => {
      if (bad) { bad = false; return 'Invalid API Key (#err2)'; }
      return '0x60806040';
    });
    const call = stubCall({
      [USDC]: { [SELECTOR.decimals]: SIX, [SELECTOR.symbol]: USDC_SYMBOL },
    });
    const c = new ContractClassifier(getCode, call);
    expect(await c.classify('polygon', USDC)).toEqual({ addressType: 'wallet' });
    expect(await c.classify('polygon', USDC)).toMatchObject({
      addressType: 'contract',
      tokenStandard: 'erc20',
    });
    expect(getCode).toHaveBeenCalledTimes(2);
  });

  it('still reads an empty-code EOA as a determined wallet', async () => {
    const getCode = jest.fn(async () => '0x');
    const c = new ContractClassifier(getCode, stubCall({}));
    expect(await c.classify('polygon', EOA)).toEqual({ addressType: 'wallet' });
    // Determined, so cached: the second call must not re-probe.
    await c.classify('polygon', EOA);
    expect(getCode).toHaveBeenCalledTimes(1);
  });
});
