// 临时脚本：btv104-trades set 80 点位复盘上下文（signal metadata 判定段 + 卖出腿结局）
// 182 跑：node scripts/buy-point/tmp-btv104-context.mjs
// ⚠️ set[].signalId 在 trades 源下实为 tradeId（build-set 组装 line 412 覆盖）——真 signal_id
// 须用 trade.buyTradeId 反查 trades.signal_id 再查 signals。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const sb = dbManager.getClient();

const EXP = '18db4a3e-b25d-44f3-9fc6-32d3c2f2857b';
const set = JSON.parse(readFileSync(path.join(HERE, 'sets', 'btv104-trades.json'), 'utf8'));
const points = set.points;
console.log(`points=${points.length}`);

// 1) buyTradeId → trades.signal_id
const tradeIds = points.map((p) => p.trade?.buyTradeId).filter(Boolean);
const sigIdOf = new Map();
for (let i = 0; i < tradeIds.length; i += 50) {
  const { data, error } = await sb.from('trades').select('id,signal_id').in('id', tradeIds.slice(i, i + 50));
  if (error) throw new Error(`trades: ${error.message}`);
  for (const r of data || []) if (r.signal_id) sigIdOf.set(r.id, r.signal_id);
}
console.log(`trade→signal_id: ${sigIdOf.size}/${tradeIds.length}`);

// 2) signal 行 metadata（cheatCheck/buyPoint 段）
const sigIds = [...new Set(sigIdOf.values())];
const sigMap = new Map();
for (let i = 0; i < sigIds.length; i += 50) {
  const { data, error } = await sb.from('strategy_signals').select('id,metadata').in('id', sigIds.slice(i, i + 50));
  if (error) throw new Error(`signals: ${error.message}`);
  for (const r of data || []) sigMap.set(r.id, r);
}
console.log(`signals hit: ${sigMap.size}/${sigIds.length}`);

// 3) 本实验全部卖行（结局）+ 卖出信号行 reason（腿名/止损臂）
const sells = [];
for (let from = 0; ; ) {
  const { data, error } = await sb.from('trades').select('id,token_address,trade_direction,executed_at,metadata').eq('experiment_id', EXP).eq('trade_direction', 'sell').order('id', { ascending: true }).range(from, from + 999);
  if (error) throw new Error(`sell trades: ${error.message}`);
  sells.push(...(data || []));
  if (!data || data.length < 1000) break;
  from += 1000;
}
const sellSigIds = [...new Set(sells.map((s) => s.metadata?.signalId).filter(Boolean))];
const sellSigMap = new Map();
for (let i = 0; i < sellSigIds.length; i += 50) {
  const { data, error } = await sb.from('strategy_signals').select('id,reason,metadata').in('id', sellSigIds.slice(i, i + 50));
  if (error) throw new Error(`sell signals: ${error.message}`);
  for (const r of data || []) sellSigMap.set(r.id, r);
}
const sellsByToken = new Map();
for (const s of sells) {
  const k = String(s.token_address).toLowerCase();
  if (!sellsByToken.has(k)) sellsByToken.set(k, []);
  sellsByToken.get(k).push(s);
}
console.log(`sells=${sells.length}`);

const pick = (o, keys) => { const r = {}; for (const k of keys) if (o && o[k] !== undefined) r[k] = o[k]; return r; };
const out = [];
for (const p of points) {
  const sigId = p.trade?.buyTradeId ? sigIdOf.get(p.trade.buyTradeId) : null;
  const md = (sigId && sigMap.get(sigId)?.metadata) || {};
  const cc = md.cheatCheck || null;
  const bp = md.buyPoint || null;
  const anc = bp?.anchors || null;
  const ss = sellsByToken.get(p.tokenAddress) || [];
  const lastSell = ss[ss.length - 1] || null;
  const sm = lastSell?.metadata || null;
  const sellSig = sm?.signalId ? sellSigMap.get(sm.signalId) : null;
  out.push({
    pointId: p.pointId,
    symbol: p.tokenSymbol,
    token: p.tokenAddress,
    anchor: (p.anchorTimeIso || '').slice(11, 19),
    leg: md.strategyName || md.legName || null,
    age: anc?.tokenAgeSec ?? null,
    curVs: anc?.curVsLaunchPct ?? null,
    cheat: cc ? { ...pick(cc, ['status', 'grade', 'exempt', 'reasons']), levels: cc.levels ? Object.fromEntries(Object.entries(cc.levels).filter(([, v]) => v && v !== 'none')) : null } : null,
    bp: bp ? { ...pick(bp, ['status', 'passed']), assessment: bp.assessment ? pick(bp.assessment, ['bucket', 'rule', 'prob', 'exempt']) : null, dims: bp.dimensions || null } : null,
    pnl: p.trade?.episode?.pnlBnb ?? null,
    sellN: ss.length,
    sellWhy: sellSig?.reason || sellSig?.metadata?.strategyName || null,
    holdSec: sm?.holdDuration ?? null,
    profitPct: sm?.profitPercent ?? null,
  });
}
writeFileSync(path.join(HERE, 'sets', 'btv104-trades-context.json'), JSON.stringify({ exp: EXP, rows: out }, null, 1));
console.log('written sets/btv104-trades-context.json');
