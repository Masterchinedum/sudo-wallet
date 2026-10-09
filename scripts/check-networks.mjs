import { Interface } from 'ethers';
import { NETWORKS } from '../src/networks.ts';

const oracle = new Interface(['function getL1FeeUpperBound(uint256) view returns (uint256)', 'function getOperatorFee(uint256) view returns (uint256)']);
async function rpcCall(network, method, params) {
  const response = await fetch(network.rpc, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5175' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000),
  });
  const value = await response.json();
  if (!response.ok || value.error) throw new Error(value.error?.message ?? `HTTP ${response.status}`);
  const cors = response.headers.get('access-control-allow-origin');
  if (cors !== '*' && cors !== 'http://127.0.0.1:5175') throw new Error('RPC does not allow browser CORS requests');
  return value.result;
}
const results = await Promise.all(NETWORKS.map(async network => {
  try {
    const chainId = await rpcCall(network, 'eth_chainId', []);
    if (Number(BigInt(chainId)) !== network.chainId) throw new Error(`Incorrect chain ID: ${chainId}`);
    if (network.opStack) for (const method of ['getL1FeeUpperBound', 'getOperatorFee']) {
      const result = await rpcCall(network, 'eth_call', [{ to: '0x420000000000000000000000000000000000000F', data: oracle.encodeFunctionData(method, [method === 'getOperatorFee' ? 25200 : 100]) }, 'latest']);
      oracle.decodeFunctionResult(method, result);
    }
    return { network: network.name, chainId: network.chainId, status: 'ok', rollupFees: !!network.opStack };
  } catch (error) { return { network: network.name, status: 'failed', error: error.message }; }
}));
console.log(JSON.stringify(results, null, 2));
if (results.some(result => result.status !== 'ok')) process.exitCode = 1;
