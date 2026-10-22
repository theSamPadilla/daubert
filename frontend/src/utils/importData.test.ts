import { parseCSVTransactions, parseJSONTransactions } from './importData';

const ACCT = '1A2b3C4d5E6f7G8h9JkLmNoPqRsTuVwXy';
const EVM = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';

describe('parseCSVTransactions', () => {
  it('keeps fiat from/to case and defaults token address to empty', () => {
    const csv = `from,to,chain,amount,symbol\n${ACCT},Acct-XyZ-9,fiat,100,USD`;
    const [tx] = parseCSVTransactions(csv);
    expect(tx.from).toBe(ACCT);
    expect(tx.to).toBe('Acct-XyZ-9');
    expect(tx.token.address).toBe('');
    expect(tx.token.decimals).toBe(2);
  });

  it('converts a decimal fiat amount to minor units', () => {
    const csv = `from,to,chain,amount,symbol\nacct-1,acct-2,fiat,650000.00,USD`;
    const [tx] = parseCSVTransactions(csv);
    expect(tx.amount).toBe('65000000');
  });

  it('still lowercases EVM rows', () => {
    const csv = `from,to,chain,amount\n${EVM},${EVM},ethereum,1`;
    const [tx] = parseCSVTransactions(csv);
    expect(tx.from).toBe(EVM.toLowerCase());
    expect(tx.to).toBe(EVM.toLowerCase());
    expect(tx.token.address).toBe('0x');
  });
});

describe('parseJSONTransactions', () => {
  it('keeps fiat from/to case and defaults token address to empty', () => {
    const [tx] = parseJSONTransactions(
      JSON.stringify([{ from: ACCT, to: 'Acct-XyZ-9', chain: 'fiat', amount: '100', tokenSymbol: 'USD' }]),
    );
    expect(tx.from).toBe(ACCT);
    expect(tx.to).toBe('Acct-XyZ-9');
    expect(tx.token.address).toBe('');
    expect(tx.token.decimals).toBe(2);
  });

  it('converts a decimal fiat amount to minor units', () => {
    const [tx] = parseJSONTransactions(
      JSON.stringify([{ from: 'a-1', to: 'a-2', chain: 'fiat', amount: '650000.00' }]),
    );
    expect(tx.amount).toBe('65000000');
  });

  it('still lowercases EVM rows', () => {
    const [tx] = parseJSONTransactions(JSON.stringify([{ from: EVM, to: EVM }]));
    expect(tx.from).toBe(EVM.toLowerCase());
    expect(tx.chain).toBe('ethereum');
  });
});
