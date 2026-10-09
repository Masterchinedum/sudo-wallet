import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Wallet, formatEther } from 'ethers';
import type { HDNodeWallet } from 'ethers';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Check, CheckCircle2, ChevronRight, CircleHelp, Code2, Copy, Download, ExternalLink, Fingerprint, Globe2, History, KeyRound, Layers3, LoaderCircle, LockKeyhole, Plus, RefreshCw, Settings2, ShieldCheck, Sparkles, Terminal, Upload, WalletCards, X } from 'lucide-react';
import { AUTO_LOCK_MS, STORAGE_KEY, broadcastTransaction, createWallet, displayAmount, downloadBackup, feeDisplay, friendlyError, importWallet, pendingActivityUpdates, prepareTransaction, providerFor, readVault, saveVault, shortAddress, validateRpc, verifyNetwork } from './wallet';
import type { Review, SavedWallet, SendForm, Vault } from './wallet';
import { NETWORKS, networkFor, networkLabel } from './networks';
import type { Network } from './networks';

type Page = 'wallets' | 'activity' | 'settings';
type ModalKind = 'create' | 'import' | 'receive' | 'send' | 'unlock' | 'guide' | null;
type Signer = Wallet | HDNodeWallet;

function Modal({ title, eyebrow, children, onClose, busy = false }: { title: string; eyebrow?: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const element = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  useEffect(() => {
    if (element.current && !element.current.contains(document.activeElement)) element.current.focus();
  });
  function keyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape' && !busy) closeRef.current();
    if (event.key === 'Tab') {
      const nodes = element.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]');
      if (!nodes?.length) { event.preventDefault(); return; }
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === element.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === element.current)) { event.preventDefault(); first.focus(); }
    }
  }
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabIndex={-1} ref={element} onKeyDown={keyDown}>
      <div className="modal-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2 id="modal-title">{title}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose} disabled={busy}><X size={20}/></button></div>
      {children}
    </div>
  </div>;
}

function ErrorMessage({ message }: { message: string }) { return message ? <div className="error" role="alert">{message}</div> : null; }
function Spinner() { return <LoaderCircle size={17} className="spin" aria-hidden="true"/>; }
function ChainIcon({ network, small = false }: { network: Network; small?: boolean }) { const Icon = network.family === 'polygon' ? Layers3 : Globe2; return <span className={`polygon-icon chain-${network.family} ${small ? 'small' : ''}`}><Icon size={small ? 14 : 21}/></span>; }

function CreateFlow({ network, onClose, onSave }: { network: Network; onClose: () => void; onSave: (wallet: SavedWallet) => void }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('My first wallet');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [wallet, setWallet] = useState<SavedWallet | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const created = await createWallet(name, password, confirm, setProgress);
      setWallet(created); setPassword(''); setConfirm(''); setStep(2);
    } catch (error) { setError(friendlyError(error)); }
    finally { setBusy(false); }
  }
  function finish() {
    try { onSave(wallet!); setStep(3); }
    catch (error) { setError(friendlyError(error)); }
  }
  return <Modal title={step === 1 ? 'Make it yours.' : step === 2 ? 'Keep a way back in.' : 'Your wallet is ready.'} eyebrow="CREATE A WALLET" onClose={onClose} busy={busy}>
    <div className="stepper">{['Create', 'Back up', 'Ready'].map((label, index) => <div className={step >= index + 1 ? 'active' : ''} key={label}><span>{step > index + 1 ? <Check size={12}/> : index + 1}</span>{label}</div>)}</div>
    {step === 1 && <form onSubmit={submit}>
      <p className="modal-intro">One wallet. All yours. Create it here and use it across all supported EVM networks.</p>
      <label>Wallet name<input value={name} onChange={e => setName(e.target.value)} maxLength={32} required autoComplete="off" disabled={busy}/></label>
      <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={12} required autoComplete="new-password" placeholder="At least 12 characters" disabled={busy}/></label>
      <label>Confirm password<input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required autoComplete="new-password" placeholder="Enter your password again" disabled={busy}/></label>
      <div className="info-note"><LockKeyhole size={17}/><span>Your password encrypts your keys on this device. Keep it safe — it cannot be reset.</span></div>
      <ErrorMessage message={error}/><button className="button primary full" disabled={busy}>{busy ? <><Spinner/>Encrypting wallet · {Math.round(progress * 100)}%</> : <>Create wallet<ArrowRight size={17}/></>}</button>
    </form>}
    {step === 2 && wallet && <>
      <p className="modal-intro">Download your encrypted backup. You’ll need this file and your password if you change devices or clear your browser.</p>
      <div className="backup-file"><span className="feature-icon"><Download size={23}/></span><div><strong>Encrypted wallet backup</strong><span>JSON keystore · protected by your password</span></div><ShieldCheck size={21}/></div>
      <button className="button secondary full" onClick={() => { downloadBackup(wallet); setDownloaded(true); }}>{downloaded ? <Check size={17}/> : <Download size={17}/>} {downloaded ? 'Download backup again' : 'Download backup'}</button>
      <label className="checkbox"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)}/>I have saved the backup file and my password somewhere safe.</label>
      <ErrorMessage message={error}/><button className="button primary full" disabled={!downloaded || !acknowledged} onClick={finish}>Finish setup<ArrowRight size={17}/></button>
      <p className="fine-print">Closing before finishing discards this setup. A downloaded backup can still restore the wallet.</p>
    </>}
    {step === 3 && wallet && <div className="success-state"><span className="success-icon"><Check size={30}/></span><h3>Hello, {wallet.name}.</h3><p>Your wallet has been saved on this device.<br/>Your address works across all supported networks. Fund it on {network.name} to make your first transaction.</p><code className="address-block">{wallet.address}</code><div className="network-inline"><ChainIcon network={network} small/>{network.name} · {networkLabel(network)}</div><button className="button primary full" onClick={onClose}>Open wallet<ArrowRight size={17}/></button></div>}
  </Modal>;
}

function ImportFlow({ onClose, onSave }: { onClose: () => void; onSave: (wallet: SavedWallet) => void }) {
  const [name, setName] = useState('Restored wallet');
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (!file || file.size > 200_000) throw new Error('Choose an encrypted keystore JSON file smaller than 200 KB.');
      const imported = await importWallet(name, await file.text(), password);
      onSave(imported); setPassword(''); onClose();
    } catch (error) { setError(friendlyError(error)); } finally { setBusy(false); }
  }
  return <Modal title="Welcome back." eyebrow="RESTORE A WALLET" onClose={onClose} busy={busy}><form onSubmit={submit}>
    <p className="modal-intro">Restore a wallet using an encrypted Ethereum V3 keystore and its password. Keys stay on this device.</p>
    <label>Wallet name<input value={name} onChange={e => setName(e.target.value)} maxLength={32} required disabled={busy}/></label>
    <label>Encrypted backup file<input type="file" accept=".json,application/json" onChange={e => setFile(e.target.files?.[0] ?? null)} required disabled={busy}/></label>
    <label>Backup password<input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password used to encrypt this backup" minLength={12} autoComplete="current-password" required disabled={busy}/></label>
    <ErrorMessage message={error}/><button className="button primary full" disabled={busy}>{busy ? <><Spinner/>Restoring wallet…</> : <>Restore wallet<Upload size={17}/></>}</button>
  </form></Modal>;
}

function UnlockForm({ wallet, onUnlock }: { wallet: SavedWallet; onUnlock: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onUnlock(password); setPassword(''); }
    catch (error) { setError(friendlyError(error)); } finally { setBusy(false); }
  }
  return <form onSubmit={submit}><div className="unlock-wallet"><span className="feature-icon"><LockKeyhole size={23}/></span><div><strong>{wallet.name}</strong><code>{shortAddress(wallet.address)}</code></div></div><p className="modal-intro">Enter your password to unlock this wallet for five minutes. It stays unlocked only in this tab.</p><label>Wallet password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="Enter your password" disabled={busy}/></label><ErrorMessage message={error}/><button className="button primary full" disabled={busy}>{busy ? <><Spinner/>Unlocking…</> : <>Unlock wallet<KeyRound size={17}/></>}</button></form>;
}

function SendFlow({ wallet, signer, onUnlock, rpc, network, onClose, onSent }: { network: Network; wallet: SavedWallet; signer: Signer | null; onUnlock: (password: string) => Promise<void>; rpc: string; onClose: () => void; onSent: (review: Review, hash: string) => void }) {
  const [form, setForm] = useState<SendForm>({ kind: 'native', to: '', amount: '', token: '', data: '' });
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [sentHash, setSentHash] = useState('');
  const mounted = useRef(true);
  const liveSigner = useRef(signer);
  liveSigner.current = signer;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const provider = useRef<ReturnType<typeof providerFor> | null>(null);
  useEffect(() => {
    const instance = providerFor(rpc); provider.current = instance;
    return () => { instance.destroy(); provider.current = null; };
  }, [rpc]);
  useEffect(() => { if (!signer) { setReview(null); setConfirmed(false); } }, [signer]);
  async function prepare(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const quote = await prepareTransaction(provider.current!, wallet.address, form, network);
      if (mounted.current && liveSigner.current) { setReview(quote); setConfirmed(false); }
    } catch (error) { if (mounted.current) setError(friendlyError(error, network)); } finally { if (mounted.current) setBusy(false); }
  }
  async function send() {
    if (!review || !signer || busy) return;
    setBusy(true); setError('');
    try {
      const tx = await broadcastTransaction(provider.current!, signer, review, network);
      // Record a broadcast even if the tab becomes locked while awaiting its RPC response.
      onSent(review, tx.hash); setSentHash(tx.hash);
    } catch (error) { setError(friendlyError(error, network)); }
    finally { setBusy(false); }
  }
  function change(field: keyof SendForm, value: string) { setForm(previous => ({ ...previous, [field]: value })); setError(''); }
  return <Modal title={sentHash ? 'On its way.' : review ? 'One final check.' : 'Make your next move.'} eyebrow={`${network.name.toUpperCase()} TRANSACTION`} onClose={onClose} busy={busy}>
    {sentHash ? <div className="success-state"><span className="success-icon"><ArrowUpRight size={30}/></span><h3>Transaction submitted</h3><p>Your transaction is pending on {network.name}. Its confirmation will appear in your activity.</p><a className="button secondary full" href={`${network.explorer}/tx/${sentHash}`} target="_blank" rel="noreferrer">View on explorer<ExternalLink size={16}/></a><button className="button primary full" onClick={onClose}>Done<Check size={17}/></button></div> : !signer ? <UnlockForm wallet={wallet} onUnlock={onUnlock}/> : review ? <>
      <p className="modal-intro">Check every detail. Confirming signs and broadcasts this transaction to {network.name}.</p>
      <div className="review-amount">{review.amount} <span>{review.asset}</span></div>
      <div className="review-details"><div><span>Network</span><strong>{network.name} <span className={`tiny-badge ${network.testnet ? '' : 'mainnet-badge'}`}>{networkLabel(network)}</span></strong></div><div><span>From</span><code>{wallet.address}</code></div><div><span>{review.kind === 'contract' ? 'Contract' : 'Recipient'}</span><code>{review.recipient}</code></div>{review.token && <div><span>Token contract</span><code>{review.token}</code></div>}<div><span>Estimated fee budget</span><strong>{feeDisplay(review.fee)} {network.symbol}</strong></div>{network.opStack && <><div><span>L1 data fee (included)</span><strong>{feeDisplay(review.l1Fee)} {network.symbol}</strong></div><div><span>Operator fee (included)</span><strong>{feeDisplay(review.operatorFee)} {network.symbol}</strong></div></>}{review.kind === 'contract' && <div><span>Calldata</span><code>{String(review.tx.data)}</code></div>}</div>
      <p className="fine-print">Includes a 20% gas limit buffer{network.opStack ? ' and buffered rollup fees' : ''}. Fees can change before inclusion. This quote expires after 90 seconds.</p>
      <label className="checkbox"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={busy}/>I have checked the destination and {network.name} network{network.testnet ? '' : ', and understand this sends real assets'}.</label>
      <ErrorMessage message={error}/><div className="button-row"><button className="button secondary" onClick={() => { setReview(null); setError(''); }} disabled={busy}>Go back</button><button className="button primary" onClick={send} disabled={!confirmed || busy}>{busy ? <><Spinner/>Submitting…</> : <>Confirm & send<ArrowUpRight size={17}/></>}</button></div>
    </> : <form onSubmit={prepare}>
      <div className="segmented" aria-label="Transaction type">{(['native', 'token', 'contract'] as const).map(kind => <button key={kind} type="button" className={form.kind === kind ? 'active' : ''} onClick={() => change('kind', kind)} disabled={busy}>{kind === 'native' ? `Send ${network.symbol}` : kind === 'token' ? 'Send token' : 'Contract call'}</button>)}</div>
      <div className="from-wallet"><span>From</span><strong>{wallet.name}</strong><code>{shortAddress(wallet.address)}</code></div>
      {form.kind === 'token' && <label>Token contract address<input value={form.token} onChange={e => change('token', e.target.value)} placeholder={`0x… on ${network.name}`} required disabled={busy}/></label>}
      <label>{form.kind === 'contract' ? 'Contract address' : 'Recipient address'}<input value={form.to} onChange={e => change('to', e.target.value)} placeholder="0x…" required disabled={busy} autoComplete="off" spellCheck={false}/></label>
      <label>{form.kind === 'contract' ? `${network.symbol} to attach (enter 0 for none)` : 'Amount'}<div className="input-with-unit"><input value={form.amount} onChange={e => change('amount', e.target.value)} placeholder="0.00" inputMode="decimal" required disabled={busy}/><span>{form.kind === 'token' ? 'TOKEN' : network.symbol}</span></div></label>
      {form.kind === 'contract' && <label>Encoded calldata<textarea value={form.data} onChange={e => change('data', e.target.value)} placeholder="0x…" required spellCheck={false} disabled={busy}/><span className="field-help">Advanced: use the ABI-encoded data for the contract function you want to call.</span></label>}
      <div className="info-note"><Globe2 size={17}/><span>{network.name} · {network.testnet ? 'Test assets' : 'Real assets'}. You’ll review the transaction and fee before sending.</span></div><ErrorMessage message={error}/><button className="button primary full" disabled={busy}>{busy ? <><Spinner/>Checking transaction…</> : <>Review transaction<ArrowRight size={17}/></>}</button>
    </form>}
  </Modal>;
}

export default function App() {
  const [initial] = useState(readVault);
  const [vault, setVault] = useState(initial.vault);
  const vaultRef = useRef(vault);
  const network = networkFor(vault.selectedChainId);
  const rpc = vault.rpcs[network.chainId];
  const [storageError, setStorageError] = useState(initial.error);
  const [selectedId, setSelectedId] = useState(vault.wallets[0]?.id ?? '');
  const [page, setPage] = useState<Page>('wallets');
  const [activityFilter, setActivityFilter] = useState('all');
  const [modal, setModal] = useState<ModalKind>(null);
  const [signer, setSigner] = useState<Signer | null>(null);
  const sessionEpoch = useRef(0);
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceBusy, setBalanceBusy] = useState(false);
  const [balanceError, setBalanceError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [toast, setToast] = useState('');
  const [rpcInput, setRpcInput] = useState(rpc);
  const [rpcError, setRpcError] = useState('');
  const [rpcBusy, setRpcBusy] = useState(false);
  const selected = vault.wallets.find(wallet => wallet.id === selectedId) ?? vault.wallets[0];
  const unlocked = !!selected && signer?.address === selected.address;
  const lock = useCallback(() => { sessionEpoch.current++; setSigner(null); }, []);
  const commit = useCallback((value: Vault) => {
    if (storageError) throw new Error(storageError);
    saveVault(value); vaultRef.current = value; setVault(value);
  }, [storageError]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (!signer) return;
    const timer = setTimeout(() => { lock(); setToast('Wallet locked after five minutes.'); }, AUTO_LOCK_MS);
    return () => clearTimeout(timer);
  }, [signer, lock]);
  useEffect(() => {
    function hidden() { if (document.visibilityState === 'hidden') lock(); }
    function changed(event: StorageEvent) {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      lock(); setModal(null);
      const result = readVault(); vaultRef.current = result.vault; setVault(result.vault); setStorageError(result.error); setBalance(null); setBalanceError('');
    }
    window.addEventListener('storage', changed); document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('storage', changed); document.removeEventListener('visibilitychange', hidden); };
  }, [lock]);
  useEffect(() => {
    setBalance(null); setBalanceError('');
    if (!selected) { setBalanceBusy(false); return; }
    let alive = true;
    const provider = providerFor(rpc);
    setBalanceBusy(true);
    (async () => {
      try { await verifyNetwork(provider, network); const amount = await provider.getBalance(selected.address); if (alive) setBalance(formatEther(amount)); }
      catch (error) { if (alive) setBalanceError(friendlyError(error, network)); }
      finally { if (alive) setBalanceBusy(false); }
    })();
    return () => { alive = false; provider.destroy(); };
  }, [selected?.address, rpc, network, refresh]);
  useEffect(() => { setRpcInput(rpc); setRpcError(''); }, [rpc, network.chainId]);
  const pendingChains = [...new Set(vault.activity.filter(item => item.status === 'pending').map(item => item.chainId))].sort().join(',');
  useEffect(() => {
    if (!pendingChains) return;
    let alive = true, running = false;
    async function check() {
      if (running) return; running = true;
      try {
        const updates = await pendingActivityUpdates(vaultRef.current.activity, vaultRef.current.rpcs);
        if (!alive || !updates.length) return;
        const current = vaultRef.current;
        commit({ ...current, activity: current.activity.map(item => {
          const update = updates.find(value => value.chainId === item.chainId && value.hash === item.hash);
          return update ? { ...item, status: update.status } : item;
        }) });
        setRefresh(value => value + 1);
      } catch { /* Keep pending records during RPC or storage outages. */ }
      finally { running = false; }
    }
    void check(); const interval = setInterval(check, 12_000);
    return () => { alive = false; clearInterval(interval); };
  }, [pendingChains, vault.rpcs, commit]);
  function changeNetwork(chainId: number) {
    if (chainId === vaultRef.current.selectedChainId) return;
    try {
      const next = networkFor(chainId);
      commit({ ...vaultRef.current, selectedChainId: chainId });
      lock(); setModal(null); setBalance(null); setBalanceError(''); setBalanceBusy(!!selected);
      setToast(`${next.name} selected. Your wallet address stays the same.`);
    } catch (error) { setToast(friendlyError(error)); }
  }
  async function unlock(password: string) {
    if (!selected) return;
    const epoch = sessionEpoch.current;
    const wallet = await Wallet.fromEncryptedJson(selected.keystore, password);
    if (epoch !== sessionEpoch.current || document.visibilityState === 'hidden') throw new Error('The wallet was locked while unlocking. Please try again.');
    if (wallet.address !== selected.address) throw new Error('The backup address does not match this wallet.');
    setSigner(wallet);
  }
  function addWallet(wallet: SavedWallet) {
    const current = vaultRef.current;
    if (current.wallets.some(item => item.address === wallet.address)) throw new Error('This wallet is already on this device.');
    commit({ ...current, wallets: [...current.wallets, wallet] }); lock(); setSelectedId(wallet.id); setPage('wallets'); setToast('Wallet saved. Your next move is yours.');
  }
  async function copy(address: string) {
    try { await navigator.clipboard.writeText(address); setToast('Wallet address copied.'); }
    catch { setToast('Copy was unavailable. Select and copy the full address in Receive.'); }
  }
  function sent(review: Review, hash: string) {
    const current = vaultRef.current;
    const activity = { chainId: review.chainId, hash, wallet: review.from, to: review.recipient, amount: review.amount, asset: review.asset, kind: review.kind, status: 'pending' as const, createdAt: new Date().toISOString() };
    const next = { ...current, activity: [activity, ...current.activity] };
    try { commit(next); }
    catch { vaultRef.current = next; setVault(next); setToast(`Transaction sent, but history could not be saved. Keep the hash: ${hash}`); }
    setRefresh(value => value + 1);
  }
  async function saveRpc(event: FormEvent) {
    event.preventDefault(); setRpcBusy(true); setRpcError(''); let provider;
    try { const nextRpc = validateRpc(rpcInput.trim()); provider = providerFor(nextRpc); await verifyNetwork(provider, network); if (vaultRef.current.selectedChainId !== network.chainId) throw new Error('The selected network changed. Check the RPC again.'); commit({ ...vaultRef.current, rpcs: { ...vaultRef.current.rpcs, [network.chainId]: nextRpc } }); setRpcInput(nextRpc); setBalance(null); lock(); setToast(`${network.name} RPC endpoint updated.`); }
    catch (error) { setRpcError(friendlyError(error, network)); }
    finally { provider?.destroy(); setRpcBusy(false); }
  }
  const activity = page === 'activity' ? vault.activity.filter(item => activityFilter === 'all' || item.chainId === Number(activityFilter)) : vault.activity.filter(item => item.wallet === selected?.address && item.chainId === network.chainId).slice(0, 4);
  function ActivityList() { return activity.length ? <div className="activity-list">{activity.map(item => <a key={`${item.chainId}:${item.hash}`} className="activity-item" href={`${networkFor(item.chainId).explorer}/tx/${item.hash}`} target="_blank" rel="noreferrer"><span className="transaction-icon">{item.kind === 'contract' ? <Code2 size={19}/> : <ArrowUpRight size={19}/>}</span><div><strong>{item.kind === 'contract' ? 'Contract interaction' : `Sent ${item.asset}`}</strong><span>{networkFor(item.chainId).name} · To {shortAddress(item.to)} · {new Date(item.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div><div className="activity-value"><strong>{item.kind === 'contract' ? '' : '−'}{item.amount} {item.asset}</strong><span className={`status ${item.status}`}>{item.status}</span></div><ExternalLink size={14}/></a>)}</div> : <div className="activity-empty"><span className="empty-circle"><History size={22}/></span><div><strong>Your story starts here</strong><p>Transactions you send from Sudo will appear here.</p></div></div>; }
  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="#" onClick={event => { event.preventDefault(); setPage('wallets'); }}><span className="brand-mark"><Terminal size={24} strokeWidth={2.6}/></span>sudo<span className="brand-dot">.</span></a><div className="workspace-label">YOUR WORKSPACE</div><nav aria-label="Main navigation">{([{ id: 'wallets', label: 'Wallets', icon: WalletCards }, { id: 'activity', label: 'Activity', icon: History }, { id: 'settings', label: 'Settings', icon: Settings2 }] as const).map(item => <button key={item.id} onClick={() => setPage(item.id)} className={page === item.id ? 'nav-item active' : 'nav-item'}><item.icon size={19}/>{item.label}{item.id === 'wallets' && <span className="nav-count">{vault.wallets.length}</span>}</button>)}</nav><div className="sidebar-bottom"><div className="ownership-note"><span className="ownership-icon"><Fingerprint size={27}/></span><strong>Yours. By design.</strong><p>Your keys live on your device.<br/>You’re always in control.</p></div><button className="help-link" onClick={() => setModal('guide')}><CircleHelp size={17}/>A little help<ArrowUpRight size={15}/></button><div className="sidebar-footer"><span className="live-dot"/>Built for your next move</div></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb">Workspace<ChevronRight size={14}/><strong>{page === 'wallets' ? 'Wallets' : page === 'activity' ? 'Activity' : 'Settings'}</strong></div><div className="topbar-right"><div className={`network-picker ${network.testnet ? '' : 'is-mainnet'}`}><ChainIcon network={network} small/><select aria-label="Active network" value={network.chainId} onChange={event => changeNetwork(Number(event.target.value))} disabled={modal !== null || rpcBusy || !!storageError}><optgroup label="Testnets">{NETWORKS.filter(item => item.testnet).map(item => <option key={item.chainId} value={item.chainId}>{item.name}</option>)}</optgroup><optgroup label="Mainnets">{NETWORKS.filter(item => !item.testnet).map(item => <option key={item.chainId} value={item.chainId}>{item.name}</option>)}</optgroup></select><span className={`tiny-badge ${network.testnet ? '' : 'mainnet-badge'}`}>{networkLabel(network)}</span></div><span className="profile-icon" title="Self-custody workspace"><Fingerprint size={21}/></span></div></header>
      <main><ErrorMessage message={storageError}/>
      <div className="page-heading"><div><span className="eyebrow">A LITTLE FREEDOM, ONCHAIN</span><h1>{page === 'wallets' ? 'Your wallets' : page === 'activity' ? 'Your activity' : 'Your settings'}<span className="heading-dot">.</span></h1><p>{page === 'wallets' ? 'Create a wallet. Keep your keys. Make your next move.' : page === 'activity' ? 'Follow the transactions you send from this device.' : 'Make this workspace work for you.'}</p></div>{page === 'wallets' && <div className="heading-actions"><button className="button secondary" onClick={() => setModal('import')} disabled={!!storageError}><Upload size={16}/>Import wallet</button><button className="button primary" onClick={() => setModal('create')} disabled={!!storageError}><Plus size={18}/>Create wallet</button></div>}</div>
      {page === 'wallets' && <>
        {!vault.wallets.length ? <>
          <section className="welcome-banner"><div className="welcome-content"><span className="welcome-tag"><Sparkles size={14}/>WEB3, WITHOUT THE EXTRA STEPS</span><h2>Your keys.<br/>Your next move.</h2><p>One wallet. A world of networks.<br/>Start on Amoy, then explore your next chain.</p><button className="button primary" onClick={() => setModal('create')} disabled={!!storageError}>Create your first wallet<ArrowRight size={17}/></button><span className="welcome-caption"><ShieldCheck size={14}/>Self-custody. No sign-up needed.</span></div><div className="wallet-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><span className="floating-spark sparkle-one">✦</span><span className="floating-spark sparkle-two">✧</span><div className="art-card back"><div className="art-card-top"><Terminal size={22}/><span>YOUR NEXT MOVE</span></div><span className="art-chip"/><div className="art-card-bottom"><span>MULTICHAIN WALLET</span><Layers3 size={26}/></div></div><div className="art-card front"><div className="art-card-top"><span className="art-logo">sudo.</span><Fingerprint size={29}/></div><div className="art-wallet-symbol"><WalletCards size={31}/></div><div className="art-card-bottom"><span>YOUR KEYS. YOUR WORLD.</span><span className="art-dots">••••</span></div></div><span className="art-key"><KeyRound size={25}/></span><span className="art-shield"><ShieldCheck size={27}/></span><span className="art-caption"><span className="live-dot"/>OWN YOUR NEXT CHAPTER</span></div></section>
          <section className="getting-started"><div className="section-heading"><h2>Three steps. You’re in.</h2><span>A minute to set up. Yours to explore.</span></div><div className="steps-grid">{[{ number: '01', title: 'Create your wallet', text: 'Give it a name and a password. Your keys are generated right here.', icon: WalletCards }, { number: '02', title: 'Save your backup', text: 'Download your encrypted backup. Keep it and your password safe.', icon: KeyRound }, { number: '03', title: 'Make your first move', text: 'Choose a network, add its gas token, then send funds or call a contract.', icon: ArrowUpRight }].map(step => <article className="step-card" key={step.number}><div className="step-top"><span className="feature-icon"><step.icon size={21}/></span><span className="step-number">{step.number}</span></div><h3>{step.title}</h3><p>{step.text}</p></article>)}</div></section>
          <div className="testnet-note"><ChainIcon network={network}/><div><strong>{network.testnet ? 'A real network. A little room to experiment.' : 'Your wallet. On the network you choose.'}</strong><p>You’re on {network.name}. {network.testnet ? 'Test tokens have no monetary value.' : 'Mainnet transactions use real assets.'} Switching networks keeps your address; balances stay on each chain.</p></div><a href={network.faucet ?? network.explorer} target="_blank" rel="noreferrer">{network.testnet ? 'Find test tokens' : 'Open explorer'}<ArrowUpRight size={16}/></a></div>
        </> : <>
          <div className="wallet-section-top"><h2>My wallets <span className="count-badge">{vault.wallets.length}</span></h2><span><LockKeyhole size={14}/>Encrypted on this device</span></div>
          <div className="wallet-grid">{vault.wallets.map((wallet, index) => <button key={wallet.id} className={`wallet-card ${selected?.id === wallet.id ? 'selected' : ''}`} onClick={() => { if (selected?.id !== wallet.id) { lock(); setSelectedId(wallet.id); } }} aria-pressed={selected?.id === wallet.id}><div className="wallet-card-top"><span className={`wallet-avatar avatar-${index % 3}`}><WalletCards size={21}/></span><span className="selected-indicator">{selected?.id === wallet.id ? <Check size={13}/> : ''}</span></div><strong>{wallet.name}</strong><code>{shortAddress(wallet.address)}</code><div className="wallet-card-footer"><span><Globe2 size={13}/>Multichain</span><span>{selected?.id === wallet.id && unlocked ? 'Unlocked' : 'Locked'}<LockKeyhole size={12}/></span></div></button>)}<button className="add-wallet-card" onClick={() => setModal('create')} disabled={!!storageError}><span><Plus size={21}/></span>Create another wallet</button></div>
          {selected && <section className="balance-panel"><div><div className="balance-label">Wallet balance<button className="icon-button" onClick={() => setRefresh(value => value + 1)} aria-label="Refresh wallet balance" disabled={balanceBusy}><RefreshCw size={14} className={balanceBusy ? 'spin' : ''}/></button></div><div className="balance-amount">{balanceBusy ? <span className="balance-loading">Loading…</span> : displayAmount(balance)}<span>{network.symbol}</span></div><span className="balance-description">{balance !== null && Number(balance) > 0 && Number(balance) < 0.00001 ? `${balance} ${network.symbol} · ` : ''}{network.name} · {network.testnet ? 'Test tokens' : 'Mainnet assets'}</span>{balanceError && <p className="balance-error" role="status">{balanceError}</p>}</div><div className="balance-actions"><button className="button primary" onClick={() => setModal('send')} disabled={!!storageError}><ArrowUpRight size={18}/>Send</button><button className="button secondary" onClick={() => setModal('receive')}><ArrowDownLeft size={18}/>Receive</button><button className="button secondary" onClick={() => { downloadBackup(selected); setToast('Encrypted backup download started.'); }}><Download size={17}/>Back up</button><button className="button text-button" onClick={() => { if (unlocked) lock(); else setModal('unlock'); }} disabled={!!storageError}>{unlocked ? <LockKeyhole size={16}/> : <KeyRound size={16}/>} {unlocked ? 'Lock wallet' : 'Unlock wallet'}</button></div></section>}
          <div className="dashboard-bottom"><section className="activity-panel"><div className="section-heading"><h2>Recent activity</h2><button className="link-button" onClick={() => setPage('activity')}>View all<ArrowRight size={14}/></button></div><ActivityList/></section><aside className="fund-panel"><span className="feature-icon"><Sparkles size={21}/></span><h3>{network.testnet ? 'Fuel your first move.' : 'Same wallet. New network.'}</h3><p>{network.testnet ? `Find test ${network.symbol} for ${network.name}, then try your first transaction.` : `Receive ${network.symbol} on ${network.name} to pay network fees. Switching networks does not move your funds.`}</p>{network.testnet ? <a className="button secondary" href={network.faucet} target="_blank" rel="noreferrer">Find test {network.symbol}<ArrowUpRight size={16}/></a> : <button className="button secondary" onClick={() => setModal('receive')}>Receive {network.symbol}<ArrowDownLeft size={16}/></button>}</aside></div>
        </>}
      </>}
      {page === 'activity' && <section className="activity-panel full-activity"><div className="section-heading"><h2>Outgoing transactions <span className="count-badge">{activity.length}</span></h2><button className="link-button" onClick={() => setPage('wallets')}>Back to wallets<ArrowRight size={14}/></button></div><label className="activity-filter">Show transactions<select aria-label="Activity network filter" value={activityFilter} onChange={event => setActivityFilter(event.target.value)}><option value="all">All networks</option>{NETWORKS.map(item => <option key={item.chainId} value={item.chainId}>{item.name}</option>)}</select></label><ActivityList/><p className="activity-footnote">History contains transactions sent from Sudo on this device. Incoming transfers and transactions sent elsewhere are available on each network’s explorer. Pending transactions are checked on their original network every 12 seconds, even when you switch chains.</p></section>}
      {page === 'settings' && <div className="settings-grid"><section className="settings-panel"><span className="feature-icon"><Globe2 size={22}/></span><h2>Your network connection</h2><p>Connect to {network.name} using its public RPC, or use your own endpoint. RPC settings are saved separately for each network.</p><form onSubmit={saveRpc}><label>{network.name} RPC endpoint<input type="url" value={rpcInput} onChange={e => setRpcInput(e.target.value)} required disabled={rpcBusy || !!storageError}/></label><div className="network-details"><span>Network <strong>{network.name}</strong></span><span>Chain ID <strong>{network.chainId}</strong></span><span>Gas token <strong>{network.symbol}</strong></span></div><ErrorMessage message={rpcError}/><div className="button-row"><button type="button" className="button secondary" onClick={() => setRpcInput(network.rpc)} disabled={rpcBusy}>Use default</button><button className="button primary" disabled={rpcBusy || !!storageError}>{rpcBusy ? <><Spinner/>Checking…</> : 'Check & save'}</button></div></form><p className="fine-print">RPC providers receive public addresses and signed transactions. The site checks the selected chain ID ({network.chainId}) before each transaction.</p></section><section className="settings-panel"><span className="feature-icon"><ShieldCheck size={22}/></span><h2>Always in your hands</h2><p>Wallets are encrypted with your password and saved in this browser. Unlocked keys stay in memory in this tab.</p><ul className="security-list"><li><CheckCircle2 size={17}/>Locks when you change networks</li><li><CheckCircle2 size={17}/>Auto-locks after five minutes</li><li><CheckCircle2 size={17}/>Locks when you leave this tab</li><li><CheckCircle2 size={17}/>No private keys sent to a server</li><li><CheckCircle2 size={17}/>Backup file + password to restore</li></ul><button className="button secondary" onClick={() => setModal('guide')}>Read the quick guide<ArrowRight size={16}/></button><p className="fine-print">Keep your backup before clearing browser data. Your wallet password cannot be recovered or reset.</p></section></div>}
      <footer className="main-footer"><span><ShieldCheck size={14}/>Self-custody, from the first click.</span><a href={network.explorer} target="_blank" rel="noreferrer">{network.name} explorer<ArrowUpRight size={13}/></a></footer>
      </main>
    </div>
    {toast && <div className="toast" role="status"><CheckCircle2 size={18}/><span>{toast}</span><button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={15}/></button></div>}
    {modal === 'create' && <CreateFlow network={network} onClose={() => setModal(null)} onSave={addWallet}/>}
    {modal === 'import' && <ImportFlow onClose={() => setModal(null)} onSave={addWallet}/>}
    {modal === 'unlock' && selected && <Modal title="Unlock your wallet." eyebrow="YOUR KEYS, YOUR CONTROL" onClose={() => setModal(null)}><UnlockForm wallet={selected} onUnlock={async password => { await unlock(password); setModal(null); }}/></Modal>}
    {modal === 'send' && selected && <SendFlow wallet={selected} signer={unlocked ? signer : null} onUnlock={unlock} rpc={rpc} network={network} onClose={() => setModal(null)} onSent={sent}/>}
    {modal === 'receive' && selected && <Modal title={`A place for your ${network.symbol}.`} eyebrow={`RECEIVE ON ${network.name.toUpperCase()}`} onClose={() => setModal(null)}><p className="modal-intro">Send {network.testnet ? 'test ' : ''}{network.symbol} or tokens on {network.name} to this address. This address works across supported networks, but each chain has its own balance.</p><div className="receive-card"><ChainIcon network={network}/><strong>{selected.name}</strong><span>{network.name} · Chain ID {network.chainId} · {networkLabel(network)}</span><code className="address-block">{selected.address}</code><button className="button secondary full" onClick={() => copy(selected.address)}><Copy size={16}/>Copy address</button></div>{network.testnet && <a className="button primary full" href={network.faucet} target="_blank" rel="noreferrer">Find test {network.symbol}<ArrowUpRight size={17}/></a>}<a className="inline-explorer" href={`${network.explorer}/address/${selected.address}`} target="_blank" rel="noreferrer">View wallet on explorer<ExternalLink size={14}/></a></Modal>}
    {modal === 'guide' && <Modal title="A little help goes a long way." eyebrow="THE QUICK GUIDE" onClose={() => setModal(null)}><div className="guide-list"><div><span>01</span><section><h3>Create & back up</h3><p>Name your wallet and set a password of at least 12 characters. Save the encrypted JSON file and your password separately. You need both to restore it.</p></section></div><div><span>02</span><section><h3>Choose a network & fund it</h3><p>Use the network selector. Open Receive and fund your address on that chain. Testnets have faucets; mainnets use real assets. POL pays gas on Polygon, and ETH pays gas on Ethereum, Base, and Arbitrum.</p></section></div><div><span>03</span><section><h3>Send & explore</h3><p>Open Send and unlock your wallet. Choose the native asset, an ERC-20 token, or a contract call. Review the network, destination, and fee, then confirm. Your address stays the same across networks; assets do not move automatically.</p></section></div></div><div className="info-note"><KeyRound size={19}/><span>Self-custody means you hold the keys. We cannot recover a forgotten password or a lost backup.</span></div><button className="button primary full" onClick={() => setModal(null)}>Got it<Check size={17}/></button></Modal>}
  </div>;
}
