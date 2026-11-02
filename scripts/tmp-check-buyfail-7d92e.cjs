// 单票买入失败排查 e：上链查 tx nonce 归属
const { ethers } = require('ethers');
require('dotenv').config({ path: 'config/.env' });

const RPCS = [
  (process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org').trim(),
  'https://bsc-dataseed1.defibit.io',
  'https://rpc.ankr.com/bsc',
];
const WALLET = '0xc3c9a4f7fe43115d282d086610e9f21f2ed2cf20';
const TXS = {
  'b3d4买 07:55': '0xb2415d0364799726979acb743b1cd52e5963932209cd73973d5153db20199279',
  'b3d4卖 07:59': '0x89311c892a46b579d1d6c68426a13c840cb95a12e21dc3bc23a74042ec6458e6',
  '7d92买成功 09:19:15': '0xb608b3f2d6f5bc27a2622a01494d7fbe098162209aece9135fe2db120ba04af7',
};

(async () => {
  let provider = null;
  for (const url of RPCS) {
    try {
      const p = new ethers.JsonRpcProvider(url, 56, { staticNetwork: true });
      const block = await Promise.race([p.getBlockNumber(), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 8000))]);
      console.log('RPC 可用:', url, 'block:', block);
      provider = p;
      break;
    } catch (e) { console.log('RPC 不可用:', url, e.message); }
  }
  if (!provider) throw new Error('无可用 RPC');

  const nc = await provider.getTransactionCount(WALLET, 'latest');
  console.log('\n钱包 latest nonce:', nc);

  for (const [label, hash] of Object.entries(TXS)) {
    try {
      const tx = await provider.getTransaction(hash);
      if (!tx) { console.log(label, '→', hash.slice(0, 14), '未上链'); continue; }
      const rc = await provider.getTransactionReceipt(hash);
      console.log(`${label} → nonce=${tx.nonce} gasPrice=${ethers.formatUnits(tx.gasPrice, 'gwei')}gwei status=${rc?.status} block=${rc?.blockNumber}`);
    } catch (e) {
      console.log(label, '查询失败:', e.message);
    }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
