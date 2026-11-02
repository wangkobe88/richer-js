// 零网络探针：NonceManager 并发双发是否重复 nonce（7d92 案机制验证）
const { ethers } = require('ethers');

const PENDING_COUNT = 2133;
const seenNonces = [];

// mock provider：pending count 恒定；broadcast 解 raw 记录 nonce
const mockProvider = {
  getTransactionCount: async () => PENDING_COUNT,
  getNetwork: async () => ethers.Network.from(56),
  getFeeData: async () => ({ gasPrice: 50000000n, maxFeePerGas: null, maxPriorityFeePerGas: null }),
  broadcastTransaction: async (raw) => {
    const tx = ethers.Transaction.from(raw);
    seenNonces.push({ nonce: tx.nonce, data: tx.data });
    return {
      hash: tx.hash, blockNumber: null, from: tx.from, nonce: tx.nonce,
      wait: async () => ({}),
    };
  },
};

const wallet = new ethers.Wallet(ethers.id('test-key-7d92')).connect(mockProvider);
const nm = new ethers.NonceManager(wallet);

(async () => {
  // 场景1：同一 tick Promise.all 并发两笔
  const [a, b] = await Promise.all([
    nm.sendTransaction({ to: '0x1111111111111111111111111111111111111111', value: 1n, data: '0x01', gasLimit: 21000n, gasPrice: 50000000n, chainId: 56, type: 0 }),
    nm.sendTransaction({ to: '0x2222222222222222222222222222222222222222', value: 2n, data: '0x02', gasLimit: 21000n, gasPrice: 50000000n, chainId: 56, type: 0 }),
  ]);
  console.log('场景1 并发双发 nonce:', JSON.stringify(seenNonces));
  const nonces = seenNonces.map(x => x.nonce);
  console.log('重复?', nonces.length !== new Set(nonces).size ? '❌ 是——双发同 nonce' : '✅ 否——串行安全');

  // 场景2：populate 慢（模拟 0x1b0a estimateGas 失败慢路径）交错
  seenNonces.length = 0;
  const nm2 = new ethers.NonceManager(wallet);
  // 包装 populateTransaction 人为延迟：第二笔 populate 先完成、第一笔后完成
  const origPopulate = nm2.signer.populateTransaction.bind(nm2.signer);
  let callIdx = 0;
  nm2.signer.populateTransaction = async (tx) => {
    const idx = callIdx++;
    const delay = idx === 0 ? 100 : 0; // 第一笔 populate 慢 100ms
    await new Promise(r => setTimeout(r, delay));
    return origPopulate(tx);
  };
  await Promise.all([
    nm2.sendTransaction({ to: '0x1111111111111111111111111111111111111111', value: 1n, data: '0x01', gasLimit: 21000n, gasPrice: 50000000n, chainId: 56, type: 0 }),
    nm2.sendTransaction({ to: '0x2222222222222222222222222222222222222222', value: 2n, data: '0x02', gasLimit: 21000n, gasPrice: 50000000n, chainId: 56, type: 0 }),
  ]);
  console.log('场景2 populate 交错 nonce:', JSON.stringify(seenNonces));
  const n2 = seenNonces.map(x => x.nonce);
  console.log('重复?', n2.length !== new Set(n2).size ? '❌ 是' : '✅ 否');

  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
