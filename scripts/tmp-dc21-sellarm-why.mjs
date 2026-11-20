// 临时取证 IV：精确重放 sinceEntry 三因子（校验入场锚 vs fire 快照）
import { dbManager } from '../src/services/dbManager.js';

const EXP = '9b31baf4-bdd3-4ebb-9031-2a1603f34633';
const TOKEN = '0xdc212d5b12e6d8a7691656964a791c8ab71a7777';
const c = await dbManager.getClient();

// fire 快照里的全史累计（校验锚）
const { data: sig } = await c.from('strategy_signals')
  .select('metadata').eq('experiment_id', EXP).eq('id', '1ff9466c-c37a-459f-a7d7-a49774afa0a8').single();
const tf = (sig.metadata || {}).trendFactors || {};
console.log('fire 快照: buyVolumeBnb=', tf.buyVolumeBnb, 'sellVolumeBnb=', tf.sellVolumeBnb, 'tradeCount=', tf.tradeCount);

const rows = [];
let from = 0;
while (true) {
  const { data, error } = await c.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,bnb_amount').eq('token_address', TOKEN)
    .order('block_number', { ascending: true }).order('log_index', { ascending: true })
    .range(from, from + 999);
  if (error) throw new Error(error.message);
  rows.push(...data); if (data.length < 1000) break; from += 1000;
}

const DUST = 0.001;
const ENTRY_TS = Date.parse('2026-10-12T07:53:18Z');
const ENTRY_BLK = 127174309; // 入场秒所在块
let tBuy = 0, tSell = 0, n = 0, entryBuy = null, entrySell = null, entryN = null;
const stats = [];
for (const r of rows) {
  const bnb = Number(r.bnb_amount) || 0;
  if (bnb < DUST) continue; // 尘 tick 不进 FA
  const isBuy = r.trade_type === 'buy';
  n++;
  if (isBuy) tBuy += bnb; else tSell += bnb;
  if (entryBuy === null && r.block_number > ENTRY_BLK) { entryBuy = tBuy; entrySell = tSell; entryN = n; }
  const ts = Date.parse(r.block_time);
  if (ts >= ENTRY_TS - 2000 && ts <= ENTRY_TS + 130000) {
    const dt = (ts - ENTRY_TS) / 1000;
    if (entryBuy !== null) {
      const seB = tBuy - entryBuy, seS = tSell - entrySell;
      const ratio = (seB + seS) > 0 ? (seB - seS) / (seB + seS) * 100 : null;
      stats.push({ dt, isBuy, bnb, seB, seS, ratio, tBuy, tSell });
    }
  }
}
console.log(`\n入场锚（>块${ENTRY_BLK} 首行前累计）: entryBuy=${entryBuy.toFixed(4)} entrySell=${entrySell.toFixed(4)} ticks=${entryN}`);
console.log(`fire 快照对照: buy=${tf.buyVolumeBnb} sell=${tf.sellVolumeBnb}`);

// 持仓期关键时点三因子 + ratio 峰值
let peak = { ratio: -Infinity };
const marks = [10, 20, 30, 35, 40, 50, 60, 70, 80, 90, 100, 105, 110, 118, 119];
let lastPerDt = new Map();
for (const s of stats) if (s.ratio != null && s.ratio > peak.ratio) peak = { ...s };
for (const s of stats) {
  const bucket = Math.round(s.dt);
  if (!marks.includes(bucket)) continue;
  lastPerDt.set(bucket, s);
}
console.log('\n== 持仓期各时点（该秒末 tick 后）:');
console.log('dt(s) | sinceEntryBuy | sinceEntrySell | netBuyRatio% | realHold>=30? | buyBnb>=1? | ratio>=90?');
for (const m of marks) {
  const s = lastPerDt.get(m); if (!s) continue;
  console.log(String(m).padStart(5), ' |', s.seB.toFixed(4).padStart(11), '|', s.seS.toFixed(4).padStart(11),
    '|', s.ratio.toFixed(1).padStart(10), '|', m >= 30 ? '  Y' : '  N', '     |', s.seB >= 1 ? ' Y' : ' N', '     |', s.ratio >= 90 ? ' Y' : ' N');
}
console.log('\nratio 全持仓期峰值:', peak.ratio.toFixed(2), '% @ t+' + peak.dt.toFixed(0) + 's（seBuy=' + peak.seB.toFixed(3) + ' seSell=' + peak.seS.toFixed(3) + '）');
