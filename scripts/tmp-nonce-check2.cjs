const { ethers } = require('ethers');
(async () => {
  const p = new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org', 56, { staticNetwork: true });
  for (const [label, hash] of Object.entries({
    '首发A(0x1b0a?)': '0xf34dabd0c3c11eacb0808d00a92712876dc439fa62d673280c4c4c67bce53132',
    '首发B(7d92?)': '0x43ac9e9865297fc622f17ebe8dc72cc11bc17ccddad32e3c1c9635949a53fd0f',
  })) {
    const tx = await p.getTransaction(hash);
    if (!tx) { console.log(label, '→ 链上不存在（确实未上链）'); continue; }
    const rc = await p.getTransactionReceipt(hash);
    console.log(label, '→ nonce=' + tx.nonce, 'status=' + rc?.status, 'block=' + rc?.blockNumber, 'value=' + ethers.formatEther(tx.value));
  }
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
