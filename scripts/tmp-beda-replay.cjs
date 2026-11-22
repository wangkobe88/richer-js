'use strict';
// 0xbeda 前期无信号重放：创建→首信号（14:45:37~14:54:00）逐 tick 评 14 腿，定位卡键
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');
const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');
const TOKEN = '0xbeda571060f81250615e1031bfea922b23067777';
(async () => {
  const sb = dbManager.getClient();
  const [{ data: ticks, error }, { data: pack }] = await Promise.all([
    sb.from('wss_price_ticks')
      .select('block_time,trade_type,bnb_amount,price_bnb,sender_address,trader_address,block_number,tx_hash,log_index,price_outlier')
      .eq('token_address', TOKEN)
      .gte('block_time', '2026-10-03T14:45:30Z').lte('block_time', '2026-10-03T14:54:10Z')
      .order('block_time', { ascending: true }).limit(8000),
    sb.from('strategy_library').select('definition').eq('name', 'trading-standard-v1').order('version', { ascending: false }).limit(1),
  ]);
  if (error) throw new Error(error.message);
  const legs = ((pack || [])[0].definition || {}).buyLegs || [];
  const ev = new ConditionEvaluator();
  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  fa.registerToken(TOKEN, { createdAtMs: Date.parse('2026-10-03T14:45:37Z'), totalSupply: 1e9, symbol: '花里奇', platform: 'flap', creatorAddress: null });
  const rows = (ticks || []).slice().sort((a, b) => (a.block_number - b.block_number) || ((a.log_index ?? 0) - (b.log_index ?? 0)));
  console.log(`喂食 ${rows.length} 行（创建 14:45:37 → 首信号 14:53:56）`);
  // 每 30s 一个采样点 + 每 tick 评「是否任意腿 true」找首个真窗
  let firstTrue = null, firstTrueLeg = null;
  let lastSample = -1;
  const CONDS = legs.map((l, i) => ({ i: i + 1, c: l.condition, mt: (l.signalGate || {}).maxTriggers ?? 1 }));
  for (const r of rows) {
    if (r.price_outlier || !r.price_bnb) continue;
    fa.processTick({
      token_address: TOKEN, trade_type: r.trade_type,
      trader_address: r.trader_address, sender_address: r.sender_address,
      price_bnb: r.price_bnb, price_usd: null,
      bnb_amount: Number(r.bnb_amount), token_amount: Number(r.bnb_amount) / Number(r.price_bnb),
      block_number: r.block_number, timestamp: Date.parse(r.block_time),
      tx_hash: r.tx_hash, log_index: r.log_index,
    }, {});
    const ts = Date.parse(r.block_time);
    const fm = fa.buildFactorMap(TOKEN, ts);
    if (!fm) continue;
    const hits = [];
    for (const L of CONDS) { try { if (ev.evaluate(L.c, fm)) hits.push('P' + L.i); } catch (e) { /* skip */ } }
    if (hits.length && !firstTrue) { firstTrue = r.block_time; firstTrueLeg = hits.join(','); }
    // 30s 采样
    const sec = Math.floor((ts - Date.parse('2026-10-03T14:45:37Z')) / 30000);
    if (sec > lastSample && sec <= 17) {
      lastSample = sec;
      console.log(`+${String(sec * 30).padStart(4)}s ${r.block_time.slice(11, 19)} tradeCount=${fm.tradeCount} ExDust=${fm.holdersExDust} buyVol=${Number(fm.buyVolumeBnb).toFixed(2)} curVs=${fm.currentVsLaunchPct === null ? 'null' : fm.currentVsLaunchPct.toFixed(1)} act=${Number(fm.actTotalBnb).toFixed(2)} ${hits.length ? '★真:' + hits.join(',') : ''}`);
    }
  }
  console.log(`\n任意腿首个 true 时刻: ${firstTrue} (${firstTrueLeg})`);
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message, e); process.exit(1); });
