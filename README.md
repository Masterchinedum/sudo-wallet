# Sudo Wallet

A local-first **multichain EVM wallet** for Ethereum, Polygon, Base, and Arbitrum, including testnets. **Polygon Amoy is selected by default.** Create a wallet in three steps, restore an encrypted backup, and review and send native assets, ERC-20 tokens, or contract calls on the selected network.

## Run

Requires Node.js 22.12+ (Node.js 24 recommended).

```sh
cd /Users/masterchinedum/Desktop/creations/Compenset/sudo-wallet
npm ci
npm run dev
```

Open **http://127.0.0.1:5175**. The app has no backend or required API key.

```sh
npm test
npm run build
npm run preview
```

`dist/` contains the production static website. Serve it over HTTPS. Localhost works for local development; secure browser APIs are required for key generation and clipboard access.

## First transaction

1. Click **Create wallet**, enter a name and password of at least 12 characters.
2. Download the encrypted JSON backup, acknowledge that you saved it and your password, and finish setup.
3. Open **Receive**, copy your address, and request Amoy test POL from an available [Polygon faucet](https://faucet.polygon.technology/). Faucet availability and eligibility are controlled by the faucet provider. Alternatively, send test POL from an existing Amoy wallet.
4. Click **Send**, unlock using your password, and choose **Send POL**, **Send token**, or **Contract call**.
5. Enter the destination and amount, review the network and estimated fee budget, acknowledge the details, and confirm. Use **Activity** or the transaction's network explorer link to follow confirmation.

Token transfers require the token's contract address on the **selected network**, and enough of that network's native token for gas (POL on Polygon; ETH on Ethereum, Base, and Arbitrum). The app reads ERC-20 symbol, decimals, and balance from that contract. Contract calls accept ABI-encoded hexadecimal calldata and an optional native-token amount (enter `0` for none). The app simulates each transaction and estimates gas before confirmation.

## Supported networks

Use the network selector in the header. Amoy is the default for a fresh vault; your subsequent selection is remembered. Each wallet has the same EVM address across all supported chains. Switching networks does **not** transfer or bridge assets: balances, tokens, nonces, contracts, and transaction histories belong to their individual chains.

| Network | Chain ID | Gas token | Environment |
| --- | --- | --- | --- |
| Polygon Amoy | 80002 | POL | Testnet (default) |
| Ethereum Sepolia | 11155111 | ETH | Testnet |
| Base Sepolia | 84532 | ETH | Testnet |
| Arbitrum Sepolia | 421614 | ETH | Testnet |
| Ethereum | 1 | ETH | Mainnet |
| Polygon | 137 | POL | Mainnet |
| Base | 8453 | ETH | Mainnet |
| Arbitrum One | 42161 | ETH | Mainnet |

- Configure a custom HTTPS RPC for the selected network in **Settings**. Endpoints are saved separately per chain.
- The application verifies the endpoint's chain ID when saving settings, retrieving balances, polling receipts, preparing a transaction, and before signing.
- Switching chains locks the wallet and invalidates the current transaction session. Each review is bound to its sender and network; the nonce is obtained from that chain.
- Mainnets are clearly marked. The transaction confirmation identifies the selected chain and acknowledges that mainnet transactions send real assets.
- **Activity** has an all-networks view and a network filter. Recent activity is scoped to the selected wallet and chain. Pending transactions continue to be polled on their original chain every 12 seconds.
- Base fee budgets include buffered L1 data and operator fee estimates from its GasPriceOracle, in addition to execution gas. Extra fees are rechecked before signing. Arbitrum's RPC gas estimate includes its data-posting gas. Quotes expire after 90 seconds; fees can change before inclusion, so the displayed budget is an estimate rather than a guarantee.
- Public RPCs can rate-limit requests. Use a dedicated endpoint when needed. Browser RPC API keys are visible to the browser; use provider origin restrictions where available.
- This supports EVM networks. Bitcoin, Solana, cross-chain bridging, and WalletConnect are not implemented.

Network definitions are in `src/networks.ts`, following [Ethereum](https://ethereum.org/developers/docs/apis/json-rpc/), [Polygon](https://docs.polygon.technology/tools/dApp-development/common-tools/remix/), [Base](https://docs.base.org/base-chain/api-reference/ethereum-json-rpc-api/eth_chainId), and [Arbitrum](https://docs.arbitrum.io/chain-info) documentation. Base fee calculations use the [OP Stack GasPriceOracle interface](https://github.com/ethereum-optimism/optimism/blob/develop/packages/contracts-bedrock/src/L2/GasPriceOracle.sol). Key management and transaction signing use [ethers v6](https://docs.ethers.org/v6/).

## Key handling and storage

- These are ordinary Ethereum-compatible externally owned accounts (EOAs). “Sudo” is the website's name, not a custodial service or smart-account protocol.
- ethers generates keys with cryptographic randomness. Its default scrypt and AES keystore encryption is used; the application does not weaken KDF settings.
- Wallet names, addresses, encrypted keystores, per-chain outgoing activity, RPC settings, and the selected network are stored under `sudo-wallet.v1` in this browser's local storage. No plaintext private key, recovery phrase, or password is persisted.
- The keystore JSON contains the encrypted recovery information. A backup file **and its password** are required to restore. There is no password reset or server recovery.
- Unlocking decrypts keys into memory in the current tab. The wallet locks after five minutes, on switching wallets or networks, on leaving the tab, and on changes from another tab. Reloading starts locked.
- RPC services receive public addresses and signed transactions. They do not receive private keys or wallet passwords.
- Activity records only transactions sent through this app on this device. Incoming transfers and transactions made elsewhere are visible on the explorer. Pending receipts are checked every 12 seconds, including after reloading.
- Existing version-1 Amoy vaults are migrated in memory to version 2 without changing keystores. Old activity is assigned to chain 80002 and the original Amoy RPC is preserved. Storage is updated only on a subsequent successful save. Encrypted backup files remain compatible.
- Keep a backup before clearing browser data, switching browsers, or changing the site's origin/port. Storage is specific to the browser and origin.

The application supports mainnets as well as testnets. It has not received an independent security audit. Browser-based wallets share the security of the device, browser, extensions, and served application code.

## Validation

`npm test` runs 30 tests covering encrypted creation/recovery, wrong passwords, storage failures, exact monetary precision, addresses, network checks, fee coverage, ERC-20 calldata/decimals/balances, failed simulations, contract calls, expired quotes, decoded signed transactions on all eight chains, version-1 migration, separate RPC settings, wallet/chain changes, Base extra fees, and independent receipt polling.

RPC behavior in unit tests is mocked; signing uses real ethers cryptography. The tests do not broadcast transactions or spend assets.

```sh
node scripts/check-networks.mjs
```

This read-only check verifies the configured public endpoints' chain IDs and browser CORS access, plus Base's L1 data and operator fee oracle methods. All eight passed during implementation. Availability can change after this check.
