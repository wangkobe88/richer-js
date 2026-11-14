const { dbManager } = require('../src/services/dbManager.js');
const EXP = 'f0898589-58f1-4101-a648-0dc9cad41f3a';
const TOKS = ['0x1f54d5e1b8be12b049d5e5328b484701640a7777', '0xd245fb1634f5dac63c864b43683cf25d2daf7777'];
async function main() {
  const c = await dbManager.getClient();
  const { data: exps } = await c.from('experiments').select('config').eq('id', EXP).limit(1);
  const wallet = ((exps[0] || {}).config || {}).wallet || {};
  const walletAddr = wallet.address || wallet;
  const { JsonRpcProvider, Contract } = require('ethers');
  const provider = new JsonRpcProvider('https://bsc-dataseed.binance.org');
  const erc20 = ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'];
  for (const addr of TOKS) {
    const ct = new Contract(addr, erc20, provider);
    const [bal, dec] = await Promise.all([ct.balanceOf(walletAddr), ct.decimals()]);
    const v = Number(bal) / 10 ** Number(dec);
    console.log(`${addr.slice(0, 12)}… 链上余额=${v} ${v < 1 ? '✅ 归零' : '⚠️ 非零'}`);
  }
  await dbManager.close?.();
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
