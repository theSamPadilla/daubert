import { DecodedTransfer, TokenStandard } from './types';

/**
 * Decodes token transfers out of a transaction receipt's logs.
 *
 * This exists because Etherscan's `account/tokentx` family cannot answer the
 * question we actually have. It is ERC-20 only (NFT transfers live at
 * `tokennfttx`/`token1155tx`), and it is keyed by ADDRESS — so answering "what
 * moved in this transaction?" requires already knowing a party to the transfer.
 * For a relayed contract call the sender is party to nothing, and the query
 * returns zero rows while the transaction plainly moved value.
 *
 * The receipt logs have neither limitation. They are also what Etherscan derives
 * those endpoints from, so decoding locally is strictly more authoritative and
 * costs no extra network call — `getTransaction` already fetches the receipt.
 */

/** `Transfer(address,address,uint256)` — shared by ERC-20 and ERC-721. */
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
/** `TransferSingle(address,address,address,uint256,uint256)` */
const TRANSFER_SINGLE = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';
/** `TransferBatch(address,address,address,uint256[],uint256[])` */
const TRANSFER_BATCH = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb';

export interface RawLog {
  address: string;
  topics: string[];
  data: string;
  logIndex?: string;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Right-most 20 bytes of a 32-byte topic, lowercased. */
function topicToAddress(topic: string): string {
  return `0x${topic.slice(-40)}`.toLowerCase();
}

/** Splits `0x`-prefixed ABI data into 32-byte words as hex strings. */
function words(data: string): string[] {
  const body = data.startsWith('0x') ? data.slice(2) : data;
  const out: string[] = [];
  for (let i = 0; i + 64 <= body.length; i += 64) out.push(body.slice(i, i + 64));
  return out;
}

function toDecimal(word: string): string {
  return BigInt(`0x${word}`).toString();
}

/**
 * Decodes `(uint256[] ids, uint256[] values)` from TransferBatch data. The head
 * holds two byte-offsets into the same buffer; each points at a length word
 * followed by that many value words.
 */
function decodeBatchArrays(data: string): { ids: string[]; values: string[] } {
  const w = words(data);
  if (w.length < 2) return { ids: [], values: [] };

  const readArray = (headWord: string): string[] => {
    const wordIndex = Number(BigInt(`0x${headWord}`) / 32n);
    const lengthWord = w[wordIndex];
    if (lengthWord === undefined) return [];
    const length = Number(BigInt(`0x${lengthWord}`));
    const items: string[] = [];
    for (let i = 0; i < length; i++) {
      const item = w[wordIndex + 1 + i];
      if (item === undefined) return items;
      items.push(toDecimal(item));
    }
    return items;
  };

  return { ids: readArray(w[0]), values: readArray(w[1]) };
}

/**
 * Returns every token transfer in `logs`, in log order.
 *
 * Zero-value transfers are RETAINED. They are real on-chain events (approvals
 * settling, refund legs) and dropping them here would hide them from the details
 * panel; choosing which leg to feature is the caller's job.
 */
export function decodeTransferLogs(logs: RawLog[]): DecodedTransfer[] {
  const out: DecodedTransfer[] = [];

  logs.forEach((log, position) => {
    const topic0 = log.topics?.[0]?.toLowerCase();
    if (!topic0) return;

    const logIndex = log.logIndex ? Number(BigInt(log.logIndex)) : position;
    const contractAddress = log.address.toLowerCase();
    const base = { contractAddress, logIndex };

    if (topic0 === TRANSFER) {
      // The ERC-20 / ERC-721 discriminator is arity, not signature: ERC-721
      // indexes tokenId as a fourth topic and leaves data empty, whereas ERC-20
      // leaves value unindexed in data.
      if (log.topics.length === 4) {
        out.push({
          ...base,
          standard: 'erc721' as TokenStandard,
          from: topicToAddress(log.topics[1]),
          to: topicToAddress(log.topics[2]),
          value: '1',
          tokenId: toDecimal(log.topics[3].replace(/^0x/, '')),
        });
        return;
      }
      if (log.topics.length === 3) {
        const [valueWord] = words(log.data);
        if (valueWord === undefined) return;
        out.push({
          ...base,
          standard: 'erc20' as TokenStandard,
          from: topicToAddress(log.topics[1]),
          to: topicToAddress(log.topics[2]),
          value: toDecimal(valueWord),
        });
      }
      return;
    }

    if (topic0 === TRANSFER_SINGLE && log.topics.length === 4) {
      const [idWord, valueWord] = words(log.data);
      if (idWord === undefined || valueWord === undefined) return;
      out.push({
        ...base,
        standard: 'erc1155' as TokenStandard,
        from: topicToAddress(log.topics[2]),
        to: topicToAddress(log.topics[3]),
        value: toDecimal(valueWord),
        tokenId: toDecimal(idWord),
      });
      return;
    }

    if (topic0 === TRANSFER_BATCH && log.topics.length === 4) {
      const { ids, values } = decodeBatchArrays(log.data);
      const from = topicToAddress(log.topics[2]);
      const to = topicToAddress(log.topics[3]);
      ids.forEach((tokenId, i) => {
        if (values[i] === undefined) return;
        out.push({
          ...base,
          standard: 'erc1155' as TokenStandard,
          from,
          to,
          value: values[i],
          tokenId,
        });
      });
    }
  });

  return out;
}

/** True when a transfer mints from, or burns to, the zero address. */
export function isMintOrBurn(transfer: DecodedTransfer): boolean {
  return transfer.from === ZERO_ADDRESS || transfer.to === ZERO_ADDRESS;
}
