import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Interface, Transaction, Wallet, getAddress, keccak256, parseEther } from 'ethers';
import type { JsonRpcProvider, TransactionRequest } from 'ethers';
import { STORAGE_KEY, amountInUnits, broadcastTransaction as broadcastForNetwork, createWallet, emptyVault, friendlyError, importWallet, prepareTransaction as prepareForNetwork, readVault, recipientAddress, saveVault, validateCalldata, validateRpc, verifyNetwork as verifyForNetwork, fundingError, parseVault, pendingActivityUpdates } from './wallet';
import type { Activity, Review, SendForm } from './wallet';
import { DEFAULT_NETWORK as NETWORK, NETWORKS, networkFor } from './networks';
import type { Network } from './networks';

const prepareTransaction = (provider: JsonRpcProvider, address: string, form: SendForm, network: Network = NETWORK) => prepareForNetwork(provider, address, form, network);
const broadcastTransaction = (provider: JsonRpcProvider, signer: Wallet | ReturnType<typeof Wallet.createRandom>, review: Review, network: Network = NETWORK) => broadcastForNetwork(provider, signer, review, network);
const verifyNetwork = (provider: JsonRpcProvider, network: Network = NETWORK) => verifyForNetwork(provider, network);

const address = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';
const tokenAddress = '0x3333333333333333333333333333333333333333';
const tokenABI = new Interface(['function decimals() view returns (uint8)', 'function symbol() view returns (string)', 'function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)']);
const form: SendForm = { kind: 'native', to: recipient, amount: '0.1', token: '', data: '' };

function mockProvider({ chain = '0x13882', balance = parseEther('10'), decimals = 6, tokenBalance = 1000000000n, transferResult = true, l1Fee = 1000n, operatorFee = 100n } = {}) {
  return {
    send: vi.fn(async () => chain), getBalance: vi.fn(async () => balance),
    getCode: vi.fn(async () => '0x6000'), getTransactionCount: vi.fn(async () => 0), estimateGas: vi.fn(async () => 21000n),
    getFeeData: vi.fn(async () => ({ maxFeePerGas: 3000000000n, maxPriorityFeePerGas: 1000000000n, gasPrice: 2000000000n })),
    call: vi.fn(async (tx: TransactionRequest) => {
      if (String(tx.to).toLowerCase() === '0x420000000000000000000000000000000000000f') {
        const oracle = new Interface(['function getL1FeeUpperBound(uint256) view returns (uint256)', 'function getOperatorFee(uint256) view returns (uint256)']);
        const name = oracle.parseTransaction({ data: String(tx.data) })!.name;
        return oracle.encodeFunctionResult(name, [name === 'getOperatorFee' ? operatorFee : l1Fee]);
      }
      if (String(tx.to).toLowerCase() !== tokenAddress.toLowerCase()) return '0x';
      const parsed = tokenABI.parseTransaction({ data: String(tx.data) });
      if (parsed?.name === 'decimals') return tokenABI.encodeFunctionResult('decimals', [decimals]);
      if (parsed?.name === 'symbol') return tokenABI.encodeFunctionResult('symbol', ['TEST']);
      if (parsed?.name === 'balanceOf') return tokenABI.encodeFunctionResult('balanceOf', [tokenBalance]);
      return tokenABI.encodeFunctionResult('transfer', [transferResult]);
    }),
  } as unknown as JsonRpcProvider;
}

describe('wallet creation and recovery', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  });
  it('creates a recoverable encrypted wallet without storing its keys or password', async () => {
    const password = 'test-only-strong-password';
    const wallet = await createWallet('Test wallet', password, password);
    const unlocked = await Wallet.fromEncryptedJson(wallet.keystore, password);
    expect(unlocked.address).toBe(wallet.address);
    expect(wallet.keystore).not.toContain(unlocked.privateKey.slice(2));
    if ('mnemonic' in unlocked && unlocked.mnemonic) expect(wallet.keystore).not.toContain(unlocked.mnemonic.phrase);
    saveVault({ ...emptyVault(), wallets: [wallet] });
    const stored = localStorage.getItem(STORAGE_KEY)!;
    expect(stored).not.toContain(password);
    expect(stored).not.toContain(unlocked.privateKey);
    expect(readVault().vault.wallets[0].address).toBe(unlocked.address);
    const recovered = await importWallet('Recovered', wallet.keystore, password);
    expect(recovered.address).toBe(wallet.address);
    await expect(Wallet.fromEncryptedJson(wallet.keystore, 'wrong-password')).rejects.toThrow();
  }, 30000);
  it('preserves a damaged saved vault rather than silently overwriting it', () => {
    localStorage.setItem(STORAGE_KEY, '{broken');
    expect(readVault().error).toContain('left untouched');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('{broken');
  });
  it('reports a storage failure so setup cannot falsely claim to have saved a wallet', () => {
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('Quota exceeded'); } });
    expect(() => saveVault(emptyVault())).toThrow('could not save');
  });
});

describe('transaction validation', () => {
  it('retains exact smallest-unit precision and rejects excess decimals', () => {
    expect(amountInUnits('0.000000000000000001')).toBe(1n);
    expect(amountInUnits('1.000001', 6)).toBe(1000001n);
    expect(() => amountInUnits('1.0000001', 6)).toThrow('decimal places');
    for (const invalid of ['-1', '1e18', '0', 'NaN', '1,000', '']) expect(() => amountInUnits(invalid)).toThrow();
  });
  it('rejects the burn address and invalid checksums', () => {
    expect(() => recipientAddress('0x0000000000000000000000000000000000000000')).toThrow('zero address');
    expect(() => recipientAddress('invalid')).toThrow('valid 0x');
    expect(recipientAddress(recipient)).toBe(getAddress(recipient));
  });
  it('allows only complete calldata bytes and secure RPC URLs', () => {
    expect(validateCalldata('0xaabb')).toBe('0xaabb');
    expect(() => validateCalldata('0x123')).toThrow('complete');
    expect(() => validateRpc('http://example.com')).toThrow('HTTPS');
    expect(validateRpc('http://127.0.0.1:8545')).toBe('http://127.0.0.1:8545/');
  });
  it('refuses RPCs connected to another chain before constructing a quote', async () => {
    const provider = mockProvider({ chain: '0x89' });
    await expect(verifyNetwork(provider)).rejects.toThrow('not Polygon Amoy');
    await expect(prepareTransaction(provider, address, form)).rejects.toThrow('not Polygon Amoy');
    expect(provider.estimateGas).not.toHaveBeenCalled();
  });
  it('includes a gas buffer, a fixed Amoy chain ID, and the maximum fee in the quote', async () => {
    const quote = await prepareTransaction(mockProvider(), address, form);
    expect(quote.tx.chainId).toBe(NETWORK.chainId);
    expect(quote.tx.value).toBe(parseEther('0.1'));
    expect(quote.tx.gasLimit).toBe(25200n);
    expect(quote.fee).toBe(25200n * 3000000000n);
  });
  it('refuses a transfer that would leave too little POL to cover its fee', async () => {
    await expect(prepareTransaction(mockProvider({ balance: parseEther('0.1') }), address, form)).rejects.toThrow('network fee');
    const message = fundingError(NETWORK);
    expect(friendlyError(new Error(message))).toBe(message);
  });
  it('encodes ERC-20 quantities using token decimals and checks token balances', async () => {
    const tokenForm = { ...form, kind: 'token' as const, token: tokenAddress, amount: '1.000001' };
    const quote = await prepareTransaction(mockProvider(), address, tokenForm);
    const decoded = tokenABI.decodeFunctionData('transfer', String(quote.tx.data));
    expect(decoded[0]).toBe(getAddress(recipient));
    expect(decoded[1]).toBe(1000001n);
    expect(quote.tx.to).toBe(getAddress(tokenAddress));
    expect(quote.tx.value).toBe(0n);
    expect(quote.recipient).toBe(getAddress(recipient));
    await expect(prepareTransaction(mockProvider({ tokenBalance: 1n }), address, tokenForm)).rejects.toThrow('enough TEST');
  });
  it('supports tokens with more than 18 decimals and detects false-returning transfers', async () => {
    const tokenForm = { ...form, kind: 'token' as const, token: tokenAddress, amount: '0.000000000000000000000001' };
    const quote = await prepareTransaction(mockProvider({ decimals: 24 }), address, tokenForm);
    expect(tokenABI.decodeFunctionData('transfer', String(quote.tx.data))[1]).toBe(1n);
    await expect(prepareTransaction(mockProvider({ decimals: 24, transferResult: false }), address, tokenForm)).rejects.toThrow('rejected this transfer');
  });
  it('preserves contract calldata and attached value, including zero', async () => {
    const quote = await prepareTransaction(mockProvider(), address, { ...form, kind: 'contract', data: '0xaabbccdd', amount: '0' });
    expect(quote.tx.data).toBe('0xaabbccdd');
    expect(quote.tx.value).toBe(0n);
  });
});

describe('signing safeguards', () => {
  it('blocks expired quotes, wrong-chain quotes, and RPC chain changes before signing', async () => {
    const quote = await prepareTransaction(mockProvider(), address, form);
    const connect = vi.fn();
    const signer = { address, connect } as unknown as Wallet;
    await expect(broadcastTransaction(mockProvider(), signer, { ...quote, createdAt: Date.now() - 91_000 })).rejects.toThrow('expired');
    await expect(broadcastTransaction(mockProvider(), signer, { ...quote, tx: { ...quote.tx, chainId: 1 } })).rejects.toThrow('selected network changed');
    await expect(broadcastTransaction(mockProvider({ chain: '0x1' }), signer, quote)).rejects.toThrow('not Polygon Amoy');
    await expect(broadcastTransaction(mockProvider({ balance: 0n }), signer, quote)).rejects.toThrow('balance changed');
    expect(connect).not.toHaveBeenCalled();
  });
  it('signs and broadcasts the exact reviewed amount, recipient, and Amoy chain', async () => {
    const signer = Wallet.createRandom();
    const quote: Review = await prepareTransaction(mockProvider(), signer.address, form);
    const provider = mockProvider();
    provider.getTransactionCount = vi.fn(async () => 0);
    provider.getNetwork = vi.fn(async () => ({ chainId: 80002n }) as never);
    const broadcast = vi.fn(async (signed: string) => {
      const decoded = Transaction.from(signed);
      expect(decoded.from).toBe(signer.address);
      expect(decoded.to).toBe(getAddress(recipient));
      expect(decoded.chainId).toBe(80002n);
      expect(decoded.value).toBe(parseEther('0.1'));
      return { hash: keccak256(signed) } as never;
    });
    provider.broadcastTransaction = broadcast;
    const tx = await broadcastTransaction(provider, signer, quote);
    expect(tx.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(broadcast).toHaveBeenCalledOnce();
  });
});

describe('multichain vault migration and isolation', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  });
  const oldItem = { hash: '0x' + 'a'.repeat(64), wallet: address, to: recipient, amount: '1', asset: 'POL', kind: 'native' as const, status: 'pending' as const, createdAt: new Date().toISOString() };
  it('migrates original Amoy wallets and history without changing keystores or overwriting storage on read', async () => {
    const wallet = await createWallet('Original', 'Original-test-password!', 'Original-test-password!');
    const legacy = JSON.stringify({ version: 1, wallets: [wallet], activity: [oldItem], rpc: 'https://custom-amoy.example/' });
    localStorage.setItem(STORAGE_KEY, legacy);
    const result = readVault();
    expect(result.error).toBe('');
    expect(result.vault.version).toBe(2);
    expect(result.vault.wallets[0]).toEqual(wallet);
    expect(result.vault.selectedChainId).toBe(80002);
    expect(result.vault.activity[0].chainId).toBe(80002);
    expect(result.vault.rpcs[80002]).toBe('https://custom-amoy.example/');
    expect(localStorage.getItem(STORAGE_KEY)).toBe(legacy);
    saveVault(result.vault);
    expect(readVault().vault.wallets[0].keystore).toBe(wallet.keystore);
  }, 15000);
  it('keeps separate endpoints and the selected network when restoring a v2 vault', () => {
    const vault = emptyVault();
    vault.selectedChainId = 8453;
    vault.rpcs[8453] = 'https://custom-base.example/';
    vault.rpcs[80002] = 'https://custom-amoy.example/';
    saveVault(vault);
    expect(readVault().vault).toEqual(vault);
  });
  it('rejects unknown network IDs in saved selection and activity', () => {
    expect(() => parseVault(JSON.stringify({ ...emptyVault(), selectedChainId: 999 }))).toThrow('not supported');
    expect(() => parseVault(JSON.stringify({ ...emptyVault(), activity: [{ ...oldItem, chainId: 999 }] }))).toThrow('not supported');
  });
  it('polls the same hash independently on its original networks and isolates RPC failures', async () => {
    const hash = oldItem.hash;
    const activity: Activity[] = [{ ...oldItem, chainId: 80002 }, { ...oldItem, chainId: 1 }, { ...oldItem, chainId: 137 }];
    const providers = new Map<string, JsonRpcProvider>();
    for (const chainId of [80002, 1, 137]) {
      const provider = mockProvider({ chain: '0x' + chainId.toString(16) });
      provider.getTransactionReceipt = chainId === 137 ? vi.fn(async () => { throw new Error('RPC outage'); }) : vi.fn(async () => ({ status: chainId === 80002 ? 1 : 0 }) as never);
      provider.destroy = vi.fn();
      providers.set(networkFor(chainId).rpc, provider);
    }
    const updates = await pendingActivityUpdates(activity, emptyVault().rpcs, rpc => providers.get(rpc)!);
    expect(updates).toEqual(expect.arrayContaining([{ chainId: 80002, hash, status: 'confirmed' }, { chainId: 1, hash, status: 'failed' }]));
    expect(updates).toHaveLength(2);
    for (const provider of providers.values()) expect(provider.destroy).toHaveBeenCalledOnce();
  });
  it('never accepts a receipt from an endpoint on the wrong network', async () => {
    const provider = mockProvider({ chain: '0x1' });
    provider.getTransactionReceipt = vi.fn(); provider.destroy = vi.fn();
    expect(await pendingActivityUpdates([{ ...oldItem, chainId: 80002 }], emptyVault().rpcs, () => provider)).toEqual([]);
    expect(provider.getTransactionReceipt).not.toHaveBeenCalled();
    expect(provider.destroy).toHaveBeenCalledOnce();
  });
});

describe('multichain signing and fees', () => {
  it.each(NETWORKS)('signs the correct chain ID and native asset on $name', async network => {
    const signer = Wallet.createRandom();
    const provider = mockProvider({ chain: '0x' + network.chainId.toString(16) });
    provider.getNetwork = vi.fn(async () => ({ chainId: BigInt(network.chainId) }) as never);
    provider.broadcastTransaction = vi.fn(async signed => {
      const decoded = Transaction.from(signed);
      expect(decoded.chainId).toBe(BigInt(network.chainId));
      expect(decoded.from).toBe(signer.address);
      expect(decoded.to).toBe(getAddress(recipient));
      expect(decoded.value).toBe(parseEther('0.1'));
      return { hash: keccak256(signed) } as never;
    });
    const review = await prepareTransaction(provider, signer.address, form, network);
    expect(review.chainId).toBe(network.chainId);
    expect(review.asset).toBe(network.symbol);
    expect(review.from).toBe(signer.address);
    await broadcastTransaction(provider, signer, review, network);
    expect(provider.broadcastTransaction).toHaveBeenCalledOnce();
  });
  it('refuses an old review after the selected chain or wallet changes', async () => {
    const signer = Wallet.createRandom();
    const quote = await prepareTransaction(mockProvider(), signer.address, form);
    await expect(broadcastTransaction(mockProvider({ chain: '0x1' }), signer, quote, networkFor(1))).rejects.toThrow('selected network changed');
    await expect(broadcastTransaction(mockProvider(), Wallet.createRandom(), quote)).rejects.toThrow('selected wallet changed');
  });
  it('includes Base L1 data and operator fees and rechecks them before signing', async () => {
    const base = networkFor(8453);
    const signer = Wallet.createRandom();
    const provider = mockProvider({ chain: '0x2105', l1Fee: 1000n, operatorFee: 100n });
    const quote = await prepareTransaction(provider, signer.address, form, base);
    expect(quote.l1Fee).toBe(1200n);
    expect(quote.operatorFee).toBe(120n);
    expect(quote.fee).toBe(25200n * 3000000000n + 1320n);
    await expect(broadcastTransaction(mockProvider({ chain: '0x2105', l1Fee: 1001n }), signer, quote, base)).rejects.toThrow('network fee changed');
  });
  it('reports the correct native gas asset and network when funds are missing', async () => {
    const ethereum = networkFor(1);
    await expect(prepareTransaction(mockProvider({ chain: '0x1', balance: 0n }), address, form, ethereum)).rejects.toThrow('Fund your wallet with ETH on Ethereum');
    expect(friendlyError({ code: 'INSUFFICIENT_FUNDS' }, ethereum)).toContain('ETH');
    expect(friendlyError({ code: 'NETWORK_ERROR' }, networkFor(84532))).toContain('Base Sepolia');
  });
});
