import { Contract, FetchRequest, Interface, JsonRpcProvider, Transaction, Wallet, ZeroAddress, formatEther, getAddress, getBytes, isAddress, isKeystoreJson, parseUnits } from 'ethers';
import type { TransactionRequest } from 'ethers';
import { DEFAULT_NETWORK, NETWORKS, networkFor } from './networks';
import type { Network } from './networks';

export const STORAGE_KEY = 'sudo-wallet.v1';
export const AUTO_LOCK_MS = 5 * 60 * 1000;
export type SavedWallet = { id: string; name: string; address: string; keystore: string; createdAt: string };
export type Activity = { chainId: number; hash: string; wallet: string; to: string; amount: string; asset: string; kind: 'native' | 'token' | 'contract'; status: 'pending' | 'confirmed' | 'failed'; createdAt: string };
export type Vault = { version: 2; wallets: SavedWallet[]; activity: Activity[]; selectedChainId: number; rpcs: Record<string, string> };
export type SendForm = { kind: 'native' | 'token' | 'contract'; to: string; amount: string; token: string; data: string };
export type Review = { chainId: number; from: string; tx: TransactionRequest; amount: string; asset: string; recipient: string; kind: SendForm['kind']; fee: bigint; l1Fee: bigint; operatorFee: bigint; createdAt: number; token?: string };
const ERC20_ABI = ['function decimals() view returns (uint8)', 'function symbol() view returns (string)', 'function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)'];
export const emptyVault = (): Vault => ({ version: 2, wallets: [], activity: [], selectedChainId: DEFAULT_NETWORK.chainId, rpcs: Object.fromEntries(NETWORKS.map(network => [network.chainId, network.rpc])) });

export function parseVault(raw: string): Vault {
  const value = JSON.parse(raw);
  if (![1, 2].includes(value.version) || !Array.isArray(value.wallets) || !Array.isArray(value.activity)) throw new Error('Invalid vault');
  for (const wallet of value.wallets) {
    if (typeof wallet.id !== 'string' || typeof wallet.name !== 'string' || !isAddress(wallet.address) || typeof wallet.keystore !== 'string' || !isKeystoreJson(wallet.keystore)) throw new Error('Invalid wallet');
    if (getAddress('0x' + JSON.parse(wallet.keystore).address.replace(/^0x/, '')) !== getAddress(wallet.address)) throw new Error('Address mismatch');
  }
  const migrated: Vault = value.version === 1 ? {
    ...emptyVault(), wallets: value.wallets,
    activity: value.activity.map((item: Omit<Activity, 'chainId'>) => ({ ...item, chainId: DEFAULT_NETWORK.chainId })),
    rpcs: { ...emptyVault().rpcs, [DEFAULT_NETWORK.chainId]: validateRpc(value.rpc) },
  } : value;
  networkFor(migrated.selectedChainId);
  if (!migrated.rpcs || typeof migrated.rpcs !== 'object' || Array.isArray(migrated.rpcs)) throw new Error('Invalid RPC settings');
  migrated.rpcs = Object.fromEntries(NETWORKS.map(network => [network.chainId, validateRpc(migrated.rpcs[network.chainId] ?? network.rpc)]));
  for (const item of migrated.activity) {
    networkFor(item.chainId);
    if (!/^0x[0-9a-fA-F]{64}$/.test(item.hash) || !isAddress(item.wallet) || !isAddress(item.to) || !['pending', 'confirmed', 'failed'].includes(item.status) || !['native', 'token', 'contract'].includes(item.kind) || typeof item.amount !== 'string' || typeof item.asset !== 'string' || !Number.isFinite(Date.parse(item.createdAt))) throw new Error('Invalid activity');
  }
  return migrated;
}

export function validateRpc(rpc: string): string {
  const url = new URL(rpc);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Use an HTTPS RPC endpoint (HTTP is allowed only on localhost).');
  }
  if (url.username || url.password) throw new Error('Use an RPC URL without embedded login credentials.');
  return url.toString();
}

export function readVault(): { vault: Vault; error: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { vault: emptyVault(), error: '' };
    return { vault: parseVault(raw), error: '' };
  } catch {
    return { vault: emptyVault(), error: 'The saved vault could not be read. Your stored data has been left untouched. Restore an encrypted backup in a different browser profile.' };
  }
}

export function saveVault(vault: Vault) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(vault)); }
  catch { throw new Error('This browser could not save your wallet. Enable local storage or free up space, and keep your backup.'); }
}

export function validatePassword(password: string, confirmation: string) {
  if (password.length < 12) throw new Error('Use a password with at least 12 characters.');
  if (password !== confirmation) throw new Error('Your passwords do not match.');
}

export async function createWallet(name: string, password: string, confirmation: string, progress?: (value: number) => void): Promise<SavedWallet> {
  validatePassword(password, confirmation);
  if (!name.trim() || name.trim().length > 32) throw new Error('Give your wallet a name between 1 and 32 characters.');
  const wallet = Wallet.createRandom();
  const keystore = await wallet.encrypt(password, progress);
  return { id: crypto.randomUUID(), name: name.trim(), address: wallet.address, keystore, createdAt: new Date().toISOString() };
}

export async function importWallet(name: string, keystore: string, password: string): Promise<SavedWallet> {
  if (!name.trim() || name.trim().length > 32) throw new Error('Give your wallet a name between 1 and 32 characters.');
  if (keystore.length > 200_000 || !isKeystoreJson(keystore)) throw new Error('Choose a valid Ethereum V3 encrypted keystore JSON file.');
  const wallet = await Wallet.fromEncryptedJson(keystore, password);
  // Re-encrypt with library defaults so imported KDF settings are not persisted.
  validatePassword(password, password);
  const encrypted = await wallet.encrypt(password);
  return { id: crypto.randomUUID(), name: name.trim(), address: wallet.address, keystore: encrypted, createdAt: new Date().toISOString() };
}

export function downloadBackup(wallet: SavedWallet) {
  const blob = new Blob([wallet.keystore], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `sudo-${wallet.address}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function providerFor(rpc: string) {
  const request = new FetchRequest(validateRpc(rpc));
  request.timeout = 15_000;
  return new JsonRpcProvider(request, undefined, { batchMaxCount: 1, pollingInterval: 6000 });
}

export async function verifyNetwork(provider: JsonRpcProvider, network: Network) {
  const id = await provider.send('eth_chainId', []);
  if (BigInt(id) !== BigInt(network.chainId)) throw new Error(`This RPC is not ${network.name}. Use an endpoint with chain ID ${network.chainId}.`);
}

export async function pendingActivityUpdates(activity: Activity[], rpcs: Record<string, string>, factory: (rpc: string) => JsonRpcProvider = providerFor) {
  const chains = [...new Set(activity.filter(item => item.status === 'pending').map(item => item.chainId))];
  const results = await Promise.allSettled(chains.map(async chainId => {
    const network = networkFor(chainId);
    const provider = factory(rpcs[chainId] ?? network.rpc);
    try {
      await verifyNetwork(provider, network);
      const receipts = await Promise.allSettled(activity.filter(item => item.status === 'pending' && item.chainId === chainId).map(async item => {
        const receipt = await provider.getTransactionReceipt(item.hash);
        return receipt ? { chainId, hash: item.hash, status: receipt.status === 1 ? 'confirmed' as const : 'failed' as const } : null;
      }));
      return receipts.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []);
    } finally { provider.destroy(); }
  }));
  return results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}

export function fundingError(network: Network) {
  return `Not enough ${network.testnet ? 'test ' : ''}${network.symbol} for the amount and network fee. ${network.testnet ? `Receive ${network.symbol} on ${network.name} from a faucet or another wallet first.` : `Fund your wallet with ${network.symbol} on ${network.name} first.`}`;
}

export async function estimateRollupFees(provider: JsonRpcProvider, tx: TransactionRequest, network: Network): Promise<{ l1Fee: bigint; operatorFee: bigint }> {
  if (!network.opStack) return { l1Fee: 0n, operatorFee: 0n };
  const oracle = new Contract('0x420000000000000000000000000000000000000F', ['function getL1FeeUpperBound(uint256) view returns (uint256)', 'function getOperatorFee(uint256) view returns (uint256)'], provider);
  const serialized = Transaction.from({
    type: tx.maxFeePerGas != null ? 2 : 0,
    chainId: network.chainId, nonce: tx.nonce!, to: String(tx.to),
    value: BigInt(tx.value?.toString() ?? '0'), data: String(tx.data ?? '0x'),
    gasLimit: BigInt(tx.gasLimit!.toString()),
    ...(tx.maxFeePerGas != null ? { maxFeePerGas: BigInt(tx.maxFeePerGas.toString()), maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas!.toString()) } : { gasPrice: BigInt(tx.gasPrice!.toString()) }),
  }).unsignedSerialized;
  const [l1Fee, operatorFee] = await Promise.all([oracle.getL1FeeUpperBound(getBytes(serialized).length), oracle.getOperatorFee(tx.gasLimit)]);
  // Buffer rollup fee estimates; they can change between review and inclusion.
  return { l1Fee: (BigInt(l1Fee) * 120n + 99n) / 100n, operatorFee: (BigInt(operatorFee) * 120n + 99n) / 100n };
}

export function recipientAddress(value: string) {
  const address = value.trim();
  if (!isAddress(address)) throw new Error('Enter a valid 0x wallet or contract address.');
  if (getAddress(address) === ZeroAddress) throw new Error('The zero address cannot receive this transaction.');
  return getAddress(address);
}

export function amountInUnits(value: string, decimals = 18, allowZero = false) {
  const text = value.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error('Enter an amount using numbers and a decimal point.');
  let amount: bigint;
  try { amount = parseUnits(text, decimals); }
  catch { throw new Error(`This asset supports up to ${decimals} decimal places.`); }
  if (amount < 0n || (!allowZero && amount === 0n)) throw new Error('The amount must be greater than zero.');
  return amount;
}

export function validateCalldata(value: string) {
  const data = value.trim();
  if (!/^0x([0-9a-fA-F]{2})+$/.test(data)) throw new Error('Enter calldata as 0x followed by complete hexadecimal bytes.');
  if (data.length > 131074) throw new Error('Calldata is too large (maximum 64 KB).');
  return data;
}

export async function prepareTransaction(provider: JsonRpcProvider, address: string, form: SendForm, network: Network): Promise<Review> {
  const recipient = recipientAddress(form.to);
  await verifyNetwork(provider, network);
  let asset: string = network.symbol;
  let tx: TransactionRequest = { to: recipient, value: form.kind === 'token' ? 0n : amountInUnits(form.amount, 18, form.kind === 'contract'), chainId: network.chainId };
  let tokenAddress: string | undefined;
  if (form.kind === 'token') {
    tokenAddress = recipientAddress(form.token);
    if (await provider.getCode(tokenAddress) === '0x') throw new Error(`There is no token contract at this address on ${network.name}.`);
    const token = new Contract(tokenAddress, ERC20_ABI, provider);
    const decimals = Number(await token.decimals());
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Unsupported token decimals.');
    const amount = amountInUnits(form.amount, decimals);
    const [symbol, balance] = await Promise.all([token.symbol(), token.balanceOf(address)]);
    asset = String(symbol).slice(0, 24);
    if (balance < amount) throw new Error(`You do not have enough ${asset} for this transfer.`);
    tx = { to: tokenAddress, value: 0n, data: new Interface(ERC20_ABI).encodeFunctionData('transfer', [recipient, amount]), chainId: network.chainId };
  } else if (form.kind === 'contract') {
    tx.data = validateCalldata(form.data);
    if (await provider.getCode(recipient) === '0x') throw new Error(`There is no contract at this address on ${network.name}.`);
  }
  const available = await provider.getBalance(address, 'pending');
  if (available === 0n || available < BigInt(tx.value?.toString() ?? '0')) {
    throw new Error(fundingError(network));
  }
  const simulation = await provider.call({ ...tx, from: address });
  if (form.kind === 'token' && simulation !== '0x' && !new Interface(ERC20_ABI).decodeFunctionResult('transfer', simulation)[0]) {
    throw new Error('The token contract rejected this transfer. No transaction was sent.');
  }
  const [estimate, feeData, balance, nonce] = await Promise.all([provider.estimateGas({ ...tx, from: address }), provider.getFeeData(), provider.getBalance(address, 'pending'), provider.getTransactionCount(address, 'pending')]);
  const gasLimit = (estimate * 120n + 99n) / 100n;
  let fee: bigint;
  if (feeData.maxFeePerGas !== null && feeData.maxPriorityFeePerGas !== null) {
    tx = { ...tx, nonce, gasLimit, maxFeePerGas: feeData.maxFeePerGas, maxPriorityFeePerGas: feeData.maxPriorityFeePerGas };
    fee = gasLimit * feeData.maxFeePerGas;
  } else if (feeData.gasPrice !== null) {
    tx = { ...tx, nonce, gasLimit, gasPrice: feeData.gasPrice };
    fee = gasLimit * feeData.gasPrice;
  } else throw new Error('The network could not estimate the fee. Try again.');
  const { l1Fee, operatorFee } = await estimateRollupFees(provider, tx, network);
  fee += l1Fee + operatorFee;
  if (balance < BigInt(tx.value?.toString() ?? '0') + fee) throw new Error(fundingError(network));
  return { chainId: network.chainId, from: getAddress(address), tx, amount: form.amount.trim(), asset, recipient, kind: form.kind, fee, l1Fee, operatorFee, createdAt: Date.now(), token: tokenAddress };
}

export async function broadcastTransaction(provider: JsonRpcProvider, signer: Wallet | Awaited<ReturnType<typeof Wallet.fromEncryptedJson>>, review: Review, network: Network) {
  if (review.chainId !== network.chainId || BigInt(review.tx.chainId?.toString() ?? '0') !== BigInt(network.chainId)) throw new Error('The selected network changed. Review your transaction again.');
  if (getAddress(signer.address) !== review.from) throw new Error('The selected wallet changed. Review your transaction again.');
  if (Date.now() - review.createdAt > 90_000) throw new Error('The fee quote expired. Review your transaction again.');
  await verifyNetwork(provider, network);
  const latestExtraFees = await estimateRollupFees(provider, review.tx, network);
  if (latestExtraFees.l1Fee + latestExtraFees.operatorFee > review.l1Fee + review.operatorFee) throw new Error('The network fee changed. Review your transaction again.');
  const balance = await provider.getBalance(signer.address, 'pending');
  if (balance < BigInt(review.tx.value?.toString() ?? '0') + review.fee) throw new Error('Your balance changed. Review your transaction again.');
  return signer.connect(provider).sendTransaction(review.tx);
}

export function displayAmount(value: string | null, digits = 5) {
  if (value === null) return '—';
  const [whole, fraction = ''] = value.split('.');
  return `${whole}.${fraction.slice(0, digits).padEnd(digits, '0')}`;
}

export const feeDisplay = (value: bigint) => formatEther(value);
export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
export function friendlyError(error: unknown, network?: Network) {
  const value = error as { code?: string; shortMessage?: string; message?: string };
  if (value.code === 'INSUFFICIENT_FUNDS') return network ? fundingError(network) : 'Not enough funds for the amount and network fee on the selected network.';
  if (value.code === 'CALL_EXCEPTION') return 'The contract simulation failed. Check the recipient, token balance, and calldata.';
  if (/incorrect password|invalid password|invalid utf/i.test(value.message ?? '')) return 'The password is incorrect. Please try again.';
  if (['NETWORK_ERROR', 'SERVER_ERROR', 'TIMEOUT'].includes(value.code ?? '') || /failed to fetch|network request|timeout|timed out|429|server_error/i.test(value.message ?? '')) return `The ${network?.name ?? 'network'} RPC is unavailable or busy. Try again or change the RPC endpoint in Settings.`;
  return (value.shortMessage || value.message || 'Something went wrong. Please try again.').slice(0, 240);
}
