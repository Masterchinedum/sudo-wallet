export type Network = {
  chainId: number;
  name: string;
  shortName: string;
  family: 'ethereum' | 'polygon' | 'base' | 'arbitrum';
  symbol: 'ETH' | 'POL';
  testnet: boolean;
  rpc: string;
  explorer: string;
  faucet?: string;
  opStack?: boolean;
};

export const NETWORKS: readonly Network[] = [
  { chainId: 80002, name: 'Polygon Amoy', shortName: 'Amoy', family: 'polygon', symbol: 'POL', testnet: true, rpc: 'https://polygon-amoy.drpc.org/', explorer: 'https://amoy.polygonscan.com', faucet: 'https://faucet.polygon.technology/' },
  { chainId: 11155111, name: 'Ethereum Sepolia', shortName: 'Sepolia', family: 'ethereum', symbol: 'ETH', testnet: true, rpc: 'https://ethereum-sepolia-rpc.publicnode.com/', explorer: 'https://sepolia.etherscan.io', faucet: 'https://ethereum.org/developers/docs/networks/#sepolia' },
  { chainId: 84532, name: 'Base Sepolia', shortName: 'Base Sepolia', family: 'base', symbol: 'ETH', testnet: true, rpc: 'https://sepolia.base.org/', explorer: 'https://sepolia.basescan.org', faucet: 'https://docs.base.org/base-chain/tools/network-faucets', opStack: true },
  { chainId: 421614, name: 'Arbitrum Sepolia', shortName: 'Arb Sepolia', family: 'arbitrum', symbol: 'ETH', testnet: true, rpc: 'https://sepolia-rollup.arbitrum.io/rpc', explorer: 'https://sepolia.arbiscan.io', faucet: 'https://docs.arbitrum.io/build-decentralized-apps/quickstart-solidity-remix' },
  { chainId: 1, name: 'Ethereum', shortName: 'Ethereum', family: 'ethereum', symbol: 'ETH', testnet: false, rpc: 'https://ethereum-rpc.publicnode.com/', explorer: 'https://etherscan.io' },
  { chainId: 137, name: 'Polygon', shortName: 'Polygon', family: 'polygon', symbol: 'POL', testnet: false, rpc: 'https://polygon-bor-rpc.publicnode.com/', explorer: 'https://polygonscan.com' },
  { chainId: 8453, name: 'Base', shortName: 'Base', family: 'base', symbol: 'ETH', testnet: false, rpc: 'https://mainnet.base.org/', explorer: 'https://basescan.org', opStack: true },
  { chainId: 42161, name: 'Arbitrum One', shortName: 'Arbitrum', family: 'arbitrum', symbol: 'ETH', testnet: false, rpc: 'https://arb1.arbitrum.io/rpc', explorer: 'https://arbiscan.io' },
];

export const DEFAULT_NETWORK = NETWORKS[0];
export function networkFor(chainId: number): Network {
  const network = NETWORKS.find(item => item.chainId === chainId);
  if (!network) throw new Error('This network is not supported. Choose a network from the selector.');
  return network;
}
export const networkLabel = (network: Network) => network.testnet ? 'Testnet' : 'Mainnet';
