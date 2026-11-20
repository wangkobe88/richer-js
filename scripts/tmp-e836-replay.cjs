// 零 DB 重放：把 DB 拉出的锚窗 rows 喂 buildSnapshotFromRows，验证 D3.79 波族九键
require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const { buildSnapshotFromRows } = require('../src/market-analysis/cheat-snapshot');

const TOKEN = '0xe83626c404ee63b68ae2a7cdb17fd7d4d2c77777';
const ANCHOR = '2026-10-04T11:01:51+00:00';

async function main() {
  const sb = dbManager.getClient();
  const { data: rows, error } = await sb.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,trader_address,sender_address,price_bnb,bnb_amount,token_amount,tx_hash')
    .eq('token_address', TOKEN)
    .lte('block_time', ANCHOR)
    .order('block_time', { ascending: true }).limit(1000);
  if (error) throw new Error(JSON.stringify(error));
  const tokenMeta = { platform: 'flap', createdAt: '2026-10-04T10:59:42+00:00' };
  const snap = buildSnapshotFromRows(rows, tokenMeta);
  const d = snap.derived || snap;
  const keys = ['burstLastGapSec','burstExitWaveFromDt','burstExitWaveEndDt','burstExitWaveBuyBnb','burstExitWaveWallets','burstSecSinceWaveEnd','burstWaveWalletNetBnb','burstWaveSellBackPct','burstWaveWalletAvgBnb','burstWaveWalletMedianBnb','burstWaveBuyBnb','burstWaveWallets','burstExitVsLaunchPct','burstExitSegBuyBnb','burstExitSegSellBnb','burstExitSegSellPct'];
  for (const k of keys) console.log(k, '=', d[k] !== undefined ? d[k] : (snap[k] !== undefined ? snap[k] : '(key not on obj)'));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
