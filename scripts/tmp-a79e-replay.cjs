require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const { buildSnapshotFromRows } = require('../src/market-analysis/cheat-snapshot');
const TOKEN = '0xa79e736482f55c89e42000151e04af630f2b7777';
const ANCHOR = '2026-10-04T12:15:19+00:00';
async function main() {
  const sb = dbManager.getClient();
  const { data: rows, error } = await sb.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,trader_address,sender_address,price_bnb,bnb_amount,token_amount,tx_hash')
    .eq('token_address', TOKEN).lte('block_time', ANCHOR)
    .order('block_time', { ascending: true }).limit(1000);
  if (error) throw new Error(JSON.stringify(error));
  const tokenMeta = { platform: 'flap', createdAt: '2026-10-04T12:11:50+00:00' };
  const snap = buildSnapshotFromRows(rows, tokenMeta);
  const d = snap.derived || snap;
  const keys = ['burstLastGapSec','burstExitWaveFromDt','burstExitWaveEndDt','burstExitWaveBuyBnb','burstExitWaveWallets','burstSecSinceWaveEnd','burstWaveWalletNetBnb','burstWaveSellBackPct','burstWaveWalletAvgBnb','burstWaveWalletMedianBnb','burstWaveBuyBnb','burstWaveWallets','burstExitVsLaunchPct'];
  for (const k of keys) console.log(k, '=', d[k] !== undefined ? d[k] : (snap[k] !== undefined ? snap[k] : '(n/a)'));
  // 出口价与锚时刻现价位置
  const exitRows = rows.filter(r => r.block_time >= '2026-10-04T12:15:18' && r.block_time <= ANCHOR);
  for (const r of exitRows) console.log('exit row:', r.block_time, r.trade_type, Number(r.bnb_amount).toFixed(4), 'price', r.price_bnb ? r.price_bnb.toExponential(4) : '-');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
