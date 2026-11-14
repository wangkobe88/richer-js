// T003 memes 0xf1fc8f44 生产门链时序取证（182 跑）：
// 信号行（cheatCheck grade/levels/nearDump）× trades 时刻 × 砸盘块时刻 → 定位豁免发生在哪层、nearDump 为何未产出
import { dbManager } from '../../src/services/dbManager.js';

const EXP = '5390bbfa-0c86-48a2-b9e1-94537c54ac17';
const TOKEN = '0xf1fc8f441e224923f44fd45f3f5bc034ba887777';
const c = await dbManager.getClient();

// 1) 该票全部信号行
const { data: sigs, error: e1 } = await c.from('strategy_signals')
  .select('id,created_at,action,executed,metadata')
  .eq('experiment_id', EXP).eq('token_address', TOKEN)
  .order('created_at', { ascending: true });
if (e1) throw new Error('signals: ' + e1.message);
console.log('=== 信号行', sigs.length, '===');
for (const s of sigs) {
  const m = s.metadata || {};
  const cc = m.cheatCheck || {};
  const bp = m.buyPoint || {};
  const lv = cc.levels || cc.info?.levels || null;
  const nearDump = lv ? (lv.nearDumpQualBlocks ?? lv.nearDump) : (cc.anchors?.nearDumpQualBlocks ?? undefined);
  console.log(JSON.stringify({
    id: String(s.id).slice(0, 8), at: s.created_at, action: s.action, executed: s.executed,
    cheat: cc.status ? {
      status: cc.status, grade: cc.grade, reasons: cc.reasons, cached: cc.cached,
      activityLevel: lv?.activityLevel, nearDump_lv: nearDump ?? null,
      exempt: cc.exempt ?? null, exemptDenied: cc.exemptDenied ?? null,
      rule: cc.reason ?? cc.rule ?? null,
    } : null,
    bp: bp.status ? { status: bp.status, rule: bp.rule ?? bp.reason ?? null, assessment: bp.assessment ?? null } : null,
  }));
}

// 2) trades
const { data: trs, error: e2 } = await c.from('trades')
  .select('id,created_at,trade_direction,metadata')
  .eq('experiment_id', EXP).eq('token_address', TOKEN)
  .order('created_at', { ascending: true });
if (e2) throw new Error('trades: ' + e2.message);
console.log('=== 成交行', trs.length, '===');
for (const t of trs) {
  console.log(JSON.stringify({
    id: String(t.id).slice(0, 8), at: t.created_at, dir: t.trade_direction,
    bnb: t.metadata?.bnbAmount ?? t.metadata?.priceBnb ?? null, why: t.metadata?.why ?? t.metadata?.sellReason ?? null,
  }));
}

// 3) 砸盘块定位：首尾信号 ±120s 的 ticks 按 block 聚合卖侧行
const t0 = new Date(new Date(sigs[0].created_at).getTime() - 120_000).toISOString();
const t1 = new Date(new Date(trs[trs.length - 1].created_at).getTime() + 60_000).toISOString();
const rows = []; let from = 0;
while (true) {
  const { data, error } = await c.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,bnb_amount,trader_address,sender_address')
    .eq('token_address', TOKEN).gte('block_time', t0).lte('block_time', t1)
    .order('id', { ascending: true }).range(from, from + 999);
  if (error) throw new Error('ticks: ' + error.message);
  rows.push(...data); if (data.length < 1000) break; from += 1000;
}
console.log('=== ticks 窗', t0, '→', t1, '共', rows.length, '行；按 block 卖侧聚合（卖额 ≥0.3 BNB 或卖方 ≥4）===');
const byBlock = new Map();
for (const r of rows) {
  const k = r.block_number;
  if (!byBlock.has(k)) byBlock.set(k, []);
  byBlock.get(k).push(r);
}
for (const [bn, rs] of [...byBlock.entries()].sort((a, b) => a[0] - b[0])) {
  const sells = rs.filter(r => r.trade_type === 'sell');
  const sellBnb = sells.reduce((s, r) => s + (r.bnb_amount || 0), 0);
  const sellers = new Set(sells.map(r => (r.sender_address || r.trader_address || '').toLowerCase())).size;
  if (sellBnb >= 0.3 || sellers >= 4) {
    console.log(JSON.stringify({
      block: bn, btMin: rs[0].block_time, btMax: rs[rs.length - 1].block_time,
      rows: rs.length, sellBnb: +sellBnb.toFixed(4), sellers,
      buyBnb: +rs.filter(r => r.trade_type === 'buy').reduce((s, r) => s + (r.bnb_amount || 0), 0).toFixed(4),
    }));
  }
}

// 4) 锚前 4s 承接细查：16:52:57（砸块 2）→ 16:53:01（信号 2 锚）之间的买入行 + 实验启动时间
console.log('=== 砸块2(131276217)→信号2锚(16:53:01) 之间全部行 ===');
for (const r of rows) {
  if (r.block > 131276217 && r.block_time <= '2026-11-02T16:53:01+00:00') {
    console.log(JSON.stringify({ bt: r.block_time, blk: r.block_number, side: r.trade_type, bnb: r.bnb_amount, w: (r.sender_address || r.trader_address || '').slice(0, 10) }));
  }
}
const { data: exp, error: e3 } = await c.from('experiments')
  .select('*').eq('id', EXP).single();
if (e3) throw new Error('exp: ' + e3.message);
const { created: _c, started_at: _s, updated_at: _u, status: _st, id: _i } = exp || {};
console.log('=== 实验 ===', JSON.stringify({ id: _i, created: _c, started_at: _s, updated_at: _u, status: _st }));
