const { ethers } = require('ethers');
(async () => {
  const p = new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org', 56, { staticNetwork: true });
  const tx = await p.getTransaction('0xea3c65a2f8a84a44f5fcfec924176ae9dae312251d893871111c66de13aad8e2');
  const rc = await p.getTransactionReceipt('0xea3c65a2f8a84a44f5fcfec924176ae9dae312251d893871111c66de13aad8e2');
  console.log('0x1b0a revert tx: nonce=' + tx.nonce, 'gasPrice=' + ethers.formatUnits(tx.gasPrice,'gwei') + 'gwei', 'gasLimit=' + tx.gasLimit, 'status=' + rc.status, 'block=' + rc.blockNumber, 'gasUsed=' + rc.gasUsed);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
