import { TokenStandard } from './types';

/**
 * Identifies what a contract IS, from the chain rather than from a list.
 *
 * `token-resolver.ts` can only answer for addresses somebody hard-coded, which
 * is why native USDC on Polygon (0x3c499c54…) resolves to nothing today while
 * the bridged USDC.e sitting next to it in the table resolves fine. Receipt-log
 * decoding makes that gap load-bearing: logs carry no symbol or decimals, so
 * without an on-chain probe every non-listed token renders as raw base units.
 *
 * Probe order matters. ERC-20 has no ERC-165 interface id, so it can only be
 * identified by successfully calling `decimals()` — which means the ERC-165
 * questions must be asked first, or an ERC-721 with a `decimals()` extension
 * would be misfiled. A REVERT is a legitimate negative answer, not a failure:
 * USDC reverts on `supportsInterface` because it predates ERC-165 entirely.
 *
 * Bytecode is immutable, so a classification the chain answered is permanently
 * valid and is cached for the process lifetime. A probe the chain could NOT
 * answer is deliberately not cached — see `classify`.
 */

const SELECTOR = {
  supportsInterface: '0x01ffc9a7',
  decimals: '0x313ce567',
  symbol: '0x95d89b41',
  name: '0x06fdde03',
} as const;

const INTERFACE_ID = {
  erc721: '80ac58cd',
  erc1155: 'd9b67a26',
} as const;

export interface ContractClassification {
  addressType: 'wallet' | 'contract';
  tokenStandard?: TokenStandard;
  symbol?: string;
  decimals?: number;
  name?: string;
}

export type GetCode = (address: string) => Promise<string>;
export type EthCall = (address: string, data: string) => Promise<string>;

function supportsInterfaceCalldata(interfaceId: string): string {
  return `${SELECTOR.supportsInterface}${interfaceId}${'0'.repeat(56)}`;
}

/** Decodes an ABI string return, tolerating the bare-bytes32 form old tokens use. */
function decodeString(raw: string): string | undefined {
  const body = raw.startsWith('0x') ? raw.slice(2) : raw;
  if (body.length === 0) return undefined;

  // Exactly one word and no dynamic header — a packed bytes32.
  if (body.length === 64) {
    const bytes = Buffer.from(body.replace(/(00)+$/, ''), 'hex').toString('utf8');
    const trimmed = bytes.replace(/\0/g, '').trim();
    return trimmed || undefined;
  }

  try {
    const length = Number(BigInt(`0x${body.slice(64, 128)}`));
    if (!Number.isFinite(length) || length === 0) return undefined;
    const chars = body.slice(128, 128 + length * 2);
    const decoded = Buffer.from(chars, 'hex').toString('utf8').replace(/\0/g, '').trim();
    return decoded || undefined;
  } catch {
    return undefined;
  }
}

function decodeUint(raw: string): number | undefined {
  try {
    const n = Number(BigInt(raw));
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

function isTrueWord(raw: string): boolean {
  try {
    return BigInt(raw) === 1n;
  } catch {
    return false;
  }
}

export class ContractClassifier {
  private cache = new Map<string, ContractClassification>();

  constructor(
    private readonly getCode: GetCode,
    private readonly ethCall: EthCall,
  ) {}

  async classify(chain: string, address: string): Promise<ContractClassification> {
    const { classification } = await this.classifyDetailed(chain, address);
    return classification;
  }

  /** Like `classify`, but also reports whether the chain actually answered. */
  async classifyDetailed(
    chain: string,
    address: string,
  ): Promise<{ classification: ContractClassification; determined: boolean }> {
    const key = `${chain}:${address.toLowerCase()}`;
    const cached = this.cache.get(key);
    if (cached) return { classification: cached, determined: true };

    const result = await this.probe(address);
    // Only cache an answer the chain actually gave. The unreachable-RPC fallback
    // below is a placeholder, not a finding: caching it would pin a token
    // contract as a plain wallet for the rest of the process, and the graph
    // would go on asserting that as fact.
    if (result.determined) this.cache.set(key, result.classification);
    return result;
  }

  private async probe(
    address: string,
  ): Promise<{ classification: ContractClassification; determined: boolean }> {
    let code: string;
    try {
      code = await this.getCode(address);
    } catch {
      // The chain did not answer, so this is a fallback rather than a result.
      return { classification: { addressType: 'wallet' }, determined: false };
    }
    if (!code || code === '0x' || code === '0x0') {
      return { classification: { addressType: 'wallet' }, determined: true };
    }

    const result: ContractClassification = { addressType: 'contract' };

    // A revert here is a negative answer, so every probe is individually guarded.
    const tryCall = async (data: string): Promise<string | undefined> => {
      try {
        return await this.ethCall(address, data);
      } catch {
        return undefined;
      }
    };

    const is721 = await tryCall(supportsInterfaceCalldata(INTERFACE_ID.erc721));
    if (is721 && isTrueWord(is721)) {
      result.tokenStandard = 'erc721';
    } else {
      const is1155 = await tryCall(supportsInterfaceCalldata(INTERFACE_ID.erc1155));
      if (is1155 && isTrueWord(is1155)) {
        result.tokenStandard = 'erc1155';
      } else {
        const decimalsRaw = await tryCall(SELECTOR.decimals);
        // A bare 32-byte zero word is what a non-reverting fallback returns for
        // an unknown selector, so require a well-formed word AND a value inside
        // uint8 — ERC-20 `decimals()` is definitionally uint8. Note that `0` is
        // also a legal ERC-20 decimals value, so the zero-word-from-a-fallback
        // case and a legitimate zero-decimals token are indistinguishable by
        // value alone — the `length !== 66` guard is what separates malformed
        // from legitimate, and a fallback that happens to return a well-formed
        // zero word will still be misread as decimals=0. Not solvable from this
        // probe alone, so left as-is.
        const decimals =
          decimalsRaw === undefined || decimalsRaw.length !== 66
            ? undefined
            : decodeUint(decimalsRaw);
        if (decimals !== undefined && decimals <= 255) {
          result.tokenStandard = 'erc20';
          result.decimals = decimals;
        }
      }
    }

    if (!result.tokenStandard) return { classification: result, determined: true };

    const [symbolRaw, nameRaw] = await Promise.all([
      tryCall(SELECTOR.symbol),
      tryCall(SELECTOR.name),
    ]);
    const symbol = symbolRaw === undefined ? undefined : decodeString(symbolRaw);
    const name = nameRaw === undefined ? undefined : decodeString(nameRaw);
    if (symbol) result.symbol = symbol;
    if (name) result.name = name;

    return { classification: result, determined: true };
  }
}
