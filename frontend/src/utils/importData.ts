import { TransactionEdge } from '../types/investigation';
import { toMinorUnits } from './formatAmount';

function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

export function parseCSVTransactions(csv: string): TransactionEdge[] {
  const lines = csv.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVRow(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, ''));

  const colIndex = (names: string[]) => {
    for (const name of names) {
      const idx = headers.indexOf(name);
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const iHash = colIndex(['txhash', 'hash', 'transactionhash']);
  const iFrom = colIndex(['from', 'sender']);
  const iTo = colIndex(['to', 'receiver', 'recipient']);
  const iChain = colIndex(['chain', 'network']);
  const iTimestamp = colIndex(['timestamp', 'time', 'date', 'datetime']);
  const iAmount = colIndex(['amount', 'value']);
  const iSymbol = colIndex(['tokensymbol', 'symbol', 'token']);
  const iTokenAddr = colIndex(['tokenaddress', 'contractaddress']);
  const iDecimals = colIndex(['tokendecimals', 'decimals']);
  const iUsdValue = colIndex(['usdvalue', 'usd', 'valueusd']);
  const iBlockNumber = colIndex(['blocknumber', 'block']);

  if (iFrom === -1 || iTo === -1) {
    throw new Error('CSV must have "from" and "to" columns');
  }

  const transactions: TransactionEdge[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVRow(lines[i]);
    if (cols.length < 2) continue;

    const get = (idx: number, fallback = '') => (idx >= 0 && idx < cols.length ? cols[idx] : fallback);

    const chain = get(iChain, 'ethereum');
    const isFiat = chain === 'fiat';
    const normAddr = (a: string) => (isFiat ? a : a.toLowerCase());

    const decimals = Number(get(iDecimals, isFiat ? '2' : '18')) || (isFiat ? 2 : 18);
    const rawAmount = get(iAmount, '0');
    // Fiat amounts are stored as integer minor units; convert '650000.00' here.
    const amount = isFiat && rawAmount.includes('.') ? (toMinorUnits(rawAmount, decimals) ?? rawAmount) : rawAmount;

    transactions.push({
      id: crypto.randomUUID(),
      from: normAddr(get(iFrom)),
      to: normAddr(get(iTo)),
      txHash: get(iHash, '0x'),
      chain,
      timestamp: get(iTimestamp) ? new Date(get(iTimestamp)).toISOString() : new Date().toISOString(),
      amount,
      token: {
        address: get(iTokenAddr, isFiat ? '' : '0x'),
        symbol: get(iSymbol, isFiat ? 'USD' : 'ETH'),
        decimals,
      },
      usdValue: iUsdValue >= 0 ? Number(get(iUsdValue)) || undefined : undefined,
      blockNumber: Number(get(iBlockNumber, '0')) || 0,
      notes: '',
      tags: [],
      crossTrace: false,
    });
  }

  return transactions;
}

export function parseJSONTransactions(json: string): TransactionEdge[] {
  const data = JSON.parse(json);
  const items = Array.isArray(data) ? data : data.transactions || data.edges || data.results || [];

  return items.map((item: any) => {
  const chain: string = item.chain || item.network || 'ethereum';
  const isFiat = chain === 'fiat';
  const normAddr = (a: string) => (isFiat ? a : a.toLowerCase());
  const decimals = Number(item.token?.decimals || item.tokenDecimals || item.decimals || (isFiat ? 2 : 18));
  const rawAmount = String(item.amount || item.value || '0');
  const amount = isFiat && rawAmount.includes('.') ? (toMinorUnits(rawAmount, decimals) ?? rawAmount) : rawAmount;
  return {
    id: item.id || crypto.randomUUID(),
    from: normAddr(item.from || item.sender || ''),
    to: normAddr(item.to || item.receiver || item.recipient || ''),
    txHash: item.txHash || item.hash || item.transactionHash || '0x',
    chain,
    timestamp: item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString(),
    amount,
    token: {
      address: item.token?.address || item.tokenAddress || item.contractAddress || (isFiat ? '' : '0x'),
      symbol: item.token?.symbol || item.tokenSymbol || item.symbol || (isFiat ? 'USD' : 'ETH'),
      decimals,
    },
    usdValue: item.usdValue != null ? Number(item.usdValue) : undefined,
    blockNumber: Number(item.blockNumber || item.block || 0),
    notes: item.notes || '',
    tags: item.tags || [],
    crossTrace: false,
  };
  });
}

export function importFile(file: File): Promise<TransactionEdge[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        if (file.name.endsWith('.csv')) {
          resolve(parseCSVTransactions(text));
        } else {
          resolve(parseJSONTransactions(text));
        }
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}
