#!/usr/bin/env node
/**
 * d46b1b6c 补充分析 v3：回测窗口 / 亏损票退出腿 / sameName 细分 / 买时追高
 */
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');

const EXP_ID = 'd46b1b6c-7752-4d89-a5ad-309b06312bab';
const sum = a => a.reduce((x, y) => x + y, 0);
const fmt = (v, d = 3) => v == null ? 'null' : (typeof v === 'number' ? v.toFixed(d) : v);

(async () => {
  const c = dbManager.getClient();
  const detail = JSON.parse(fs.readFileSync(require('path').join(__dirname, '../data/analysis-d46b1b6c-per-token.json'), 'utf8'));

  const { data: exp } = await c.from('experiments').select('config').eq('id', EXP_ID).single();
  const cfg = exp.config || {};
  const bt = cfg.backtest || {};
  console.log('===== 回测窗口配置 =====');
  console.log(JSON.stringify({ ...bt, platform: cfg.platform }, null, 1).slice(0, 800));

  // 退出腿分析：trades(sell).signal_id → signal.metadata.strategyName
  const { data: sells } = await c.from('trades').select('id,token_address,signal_id,input_amount,output_amount,created_at').eq('experiment_id', EXP_ID).eq('trade_direction', 'sell').limit(2000);
  const sellSigIds = [...new Set(sells.map(s => s.signal_id).filter(Boolean))];
  const sigMeta = new Map();
  for (let i = 0; i < sellSigIds.length; i += 100) {
    const { data } = await c.from('strategy_signals').select('id,metadata').in('id', sellSigIds.slice(i, i + 100));
    (data || []).forEach(s => sigMeta.set(s.id, (s.metadata || {}).strategyName || (s.metadata || {}).strategyId || '?'));
  }
  console.log('\n===== 亏损票（netBnb<-0.001）最后一笔卖出的腿 =====');
  const losses = detail.filter(t => t.outcome === 'loss');
  const lastSellByToken = new Map();
  sells.forEach(s => {
    const prev = lastSellByToken.get(s.token_address);
    if (!prev || s.created_at > prev.created_at) lastSellByToken.set(s.token_address, s);
  });
  const exitDist = {};
  for (const t of losses) {
    const ls = lastSellByToken.get(t.addr);
    const leg = ls && ls.signal_id ? (sigMeta.get(ls.signal_id) || '?') : '强平/无信号卖';
    exitDist[leg] = (exitDist[leg] || 0) + 1;
  }
  console.log(JSON.stringify(exitDist, null, 1));
  // 每退出腿的平均亏损
  const legNet = {};
  for (const t of losses) {
    const ls = lastSellByToken.get(t.addr);
    const leg = ls && ls.signal_id ? (sigMeta.get(ls.signal_id) || '?') : '强平/无信号卖';
    (legNet[leg] = legNet[leg] || []).push(t.netBnb);
  }
  for (const [leg, arr] of Object.entries(legNet)) console.log(`${leg}: n=${arr.length} 合计=${sum(arr).toFixed(3)} 均值=${(sum(arr) / arr.length).toFixed(4)}`);

  // sameName 5-9 细分
  console.log('\n===== sameName 逐值细分（0..12+） =====');
  for (const v of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    const arr = detail.filter(t => t.pbc.strictSameNameTokenCount === v);
    if (!arr.length) continue;
    const w = arr.filter(t => t.outcome === 'win').length;
    console.log(`sameName=${v}: n=${arr.length} win=${w}(${(100 * w / arr.length).toFixed(0)}%) 净额=${sum(arr.map(t => t.netBnb)).toFixed(3)}`);
  }
  const arr13 = detail.filter(t => t.pbc.strictSameNameTokenCount >= 13);
  if (arr13.length) { const w = arr13.filter(t => t.outcome === 'win').length; console.log(`sameName>=13: n=${arr13.length} win=${w}(${(100 * w / arr13.length).toFixed(0)}%) 净额=${sum(arr13.map(t => t.netBnb)).toFixed(3)}`); }

  // 买时追高 earlyReturn 分布（亏 vs 赢）
  console.log('\n===== earlyReturn（买时涨幅%）分箱 =====');
  for (const [lo, hi] of [[-100, 20], [20, 50], [50, 80], [80, 120], [120, 200], [200, 9999]]) {
    const arr = detail.filter(t => t.tf.earlyReturn != null && t.tf.earlyReturn >= lo && t.tf.earlyReturn < hi);
    if (!arr.length) continue;
    const w = arr.filter(t => t.outcome === 'win').length;
    console.log(`er [${lo},${hi}): n=${arr.length} win=${w}(${(100 * w / arr.length).toFixed(0)}%) 净额=${sum(arr.map(t => t.netBnb)).toFixed(3)}`);
  }

  // 首买之后走势速查：赢票/亏票的卖出笔数与持有时长
  console.log('\n===== 持有时长（首买→末卖，分钟） =====');
  const { data: buys } = await c.from('trades').select('token_address,created_at').eq('experiment_id', EXP_ID).eq('trade_direction', 'buy').limit(500);
  const firstBuy = new Map();
  buys.forEach(b => { const p = firstBuy.get(b.token_address); if (!p || b.created_at < p) firstBuy.set(b.token_address, b.created_at); });
  for (const oc of ['win', 'loss']) {
    const durs = detail.filter(t => t.outcome === oc).map(t => {
      const fb = firstBuy.get(t.addr), ls = lastSellByToken.get(t.addr);
      if (!fb || !ls) return null;
      return (new Date(ls.created_at) - new Date(fb)) / 60000;
    }).filter(v => v != null && isFinite(v)).sort((a, b) => a - b);
    const q = p => durs.length ? durs[Math.floor(durs.length * p)] : null;
    console.log(`${oc}: n=${durs.length} 持时 p25=${fmt(q(0.25), 1)} 中位=${fmt(q(0.5), 1)} p75=${fmt(q(0.75), 1)} p95=${fmt(q(0.95), 1)}min`);
  }

  // 候选门最终汇总（含门槛变体）
  console.log('\n===== 候选门最终汇总 =====');
  const gates = [
    ['sameName >= 5（拦孤本票 sameName<=4）', t => t.pbc.strictSameNameTokenCount != null && t.pbc.strictSameNameTokenCount <= 4],
    ['sameName >= 8', t => t.pbc.strictSameNameTokenCount != null && t.pbc.strictSameNameTokenCount <= 7],
    ['uniqueWallets >= 15', t => t.pbc.earlyTradesUniqueWallets != null && t.pbc.earlyTradesUniqueWallets <= 14],
    ['sameName>=5 ∪ uw>=15', t => (t.pbc.strictSameNameTokenCount != null && t.pbc.strictSameNameTokenCount <= 4) || (t.pbc.earlyTradesUniqueWallets != null && t.pbc.earlyTradesUniqueWallets <= 14)],
    ['sameName>=5 ∪ uw>=15 ∪ tpa>2.5', t => (t.pbc.strictSameNameTokenCount != null && t.pbc.strictSameNameTokenCount <= 4) || (t.pbc.earlyTradesUniqueWallets != null && t.pbc.earlyTradesUniqueWallets <= 14) || (t.tpa.TPAPre_tokenScore != null && t.tpa.TPAPre_tokenScore <= 2.5)],
  ];
  for (const [name, fn] of gates) {
    const blocked = detail.filter(fn);
    const w = blocked.filter(t => t.outcome === 'win').length;
    const net = sum(blocked.map(t => t.netBnb));
    console.log(`${name}: 拦 ${blocked.length}/254（亏 ${blocked.length - w}/赢 ${w}）避亏 ${(-net).toFixed(3)} | 保留票数 ${254 - blocked.length} 净额 ${7.536 - net >= 0 ? '+' : ''}${(7.536 - net).toFixed(3)}`);
  }

  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
