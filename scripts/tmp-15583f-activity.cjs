// 一次性诊断 v2（182 跑）：0x15583f…7777 暴力雪球 活跃度质疑——信号跨实验查+锚前分段密度+锚后走势
// 日期修正：block_time 带 +00:00 时不再拼 Z；strategy_signals 列名用已验证集合
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager');

const ADDR = '0x15583fde3b3ca9260556556a995e6967471d7777';
const EXP = '936e1bd9-630a-4f91-bb52-3f4afb1a27f4';

const ms = (iso) => new Date(iso).getTime();
const fmtT = (iso) => (iso ? new Date(iso).toISOString().slice(11, 19) : '-');

(async () => {
  const c = await dbManager.getClient();

  // 1) ticks 全史
  const { data: rows, error: te } = await c.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,price_outlier')
    .eq('token_address', ADDR)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(5000);
  if (te) throw new Error('ticks: ' + te.message);
  console.log(`ticks 共 ${rows.length} 行：${rows[0].block_time} → ${rows[rows.length - 1].block_time}`);
  const t0 = ms(rows[0].block_time);

  // 2) 信号（跨实验全查）
  const { data: sigs, error: se } = await c.from('strategy_signals')
    .select('id,experiment_id,signal_type,action,reason,created_at,metadata')
    .eq('token_address', ADDR)
    .order('id', { ascending: true }).limit(50);
  if (se) throw new Error('signals: ' + se.message);
  console.log(`\nstrategy_signals（跨实验）共 ${(sigs || []).length} 行`);
  const buyTimes = [];
  for (const s of sigs || []) {
    const m = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : (s.metadata || {});
    console.log(`  sig#${s.id} exp=${String(s.experiment_id).slice(0, 8)} ${s.signal_type} ${s.action} @${fmtT(s.created_at)} t+${((ms(s.created_at) - t0) / 1000).toFixed(0)}s reason=${(s.reason || '').slice(0, 60)}`);
    if (m.cheatCheck) {
      const cc = m.cheatCheck;
      console.log(`    cheatCheck grade=${cc.grade} reasons=${JSON.stringify(cc.reasons)} condPass=${cc.conditionPassed}`);
    }
    if (s.signal_type === 'BUY') buyTimes.push({ at: ms(s.created_at), id: s.id });
  }

  // 3) 60s 桶时间线（只打非空桶）
  console.log('\n== 60s 桶时间线（t+分: 笔(买/卖) 买额BNB 末价）==');
  const tEnd = ms(rows[rows.length - 1].block_time);
  const nb = Math.floor((tEnd - t0) / 60000) + 1;
  const buckets = new Array(nb).fill(0).map(() => ({ n: 0, buy: 0, sell: 0, bnb: 0, lastP: null }));
  for (const r of rows) {
    const b = Math.min(nb - 1, Math.floor((ms(r.block_time) - t0) / 60000));
    const bu = buckets[b];
    bu.n++;
    if (/buy/i.test(r.trade_type || '')) { bu.buy++; bu.bnb += r.bnb_amount || 0; }
    else bu.sell++;
    if (typeof r.price_bnb === 'number' && !r.price_outlier) bu.lastP = r.price_bnb;
  }
  for (let i = 0; i < nb; i++) {
    const b = buckets[i];
    if (b.n > 0) console.log(`  t+${String(i).padStart(3)}m ${String(b.n).padStart(3)}笔(${b.buy}/${b.sell}) 买${b.bnb.toFixed(2)} 末价${b.lastP == null ? '-' : b.lastP.toPrecision(3)}`);
  }

  // 4) 每个买信号：锚前分段密度 + 锚前最近 5 个间隔
  for (const bt of buyTimes) {
    const upto = rows.filter((r) => ms(r.block_time) <= bt.at);
    const win = (fromSec, toSec) => rows.filter((r) => {
      const t = ms(r.block_time);
      return t >= t0 + fromSec * 1000 && t < t0 + toSec * 1000;
    }).length;
    const anchorSec = (bt.at - t0) / 1000;
    const gaps = [];
    for (let i = 1; i < upto.length; i++) gaps.push(ms(upto[i].block_time) - ms(upto[i - 1].block_time));
    const last5 = gaps.slice(-5).map((g) => Math.round(g / 1000));
    console.log(`\n== 买信号#${bt.id} @t+${anchorSec.toFixed(0)}s：锚前累计=${upto.length} 笔`);
    console.log(`  分段密度：前0-10s=${win(Math.max(0, anchorSec - 10), anchorSec)} 前10-30s=${win(Math.max(0, anchorSec - 30), Math.max(0, anchorSec - 10))} 前30-60s=${win(Math.max(0, anchorSec - 60), Math.max(0, anchorSec - 30))} | 锚前最近5个间隔(s)=${last5.join(',')} | 锚距最近tick=${((bt.at - ms(upto[upto.length - 1].block_time)) / 1000).toFixed(1)}s`);
  }

  // 5) 价格轨迹 + 锚后走势（锚=首个买信号）
  const rel = rows.filter((r) => typeof r.price_bnb === 'number' && !r.price_outlier);
  if (rel.length && buyTimes.length) {
    const anchor = buyTimes[0].at;
    const before = rel.filter((r) => ms(r.block_time) <= anchor);
    const after = rel.filter((r) => ms(r.block_time) > anchor);
    const p0 = rel[0].price_bnb, pA = before.length ? before[before.length - 1].price_bnb : null;
    const pct = (p, a) => (p == null || a == null ? '-' : ((p / a - 1) * 100).toFixed(1) + '%');
    let peak = null, peakT = null;
    for (const r of after) if (peak == null || r.price_bnb > peak) { peak = r.price_bnb; peakT = r.block_time; }
    const lastP = after.length ? after[after.length - 1].price_bnb : null;
    console.log(`\n== 价格：首=${p0.toPrecision(3)} 锚=${pA && pA.toPrecision(3)}(较首${pct(pA, p0)})`);
    console.log(`   锚后峰=${peak && peak.toPrecision(3)}@${fmtT(peakT)}(${pct(peak, pA)}) 末=${lastP && lastP.toPrecision(3)}(${pct(lastP, pA)})`);
    const line = [];
    for (let m2 = 1; m2 <= 60; m2++) {
      const seg = after.filter((r) => ms(r.block_time) <= anchor + m2 * 60000);
      if (!seg.length) break;
      if (m2 <= 5 || m2 % 10 === 0) line.push(`+${m2}m=${seg[seg.length - 1].price_bnb.toPrecision(3)}(${pct(seg[seg.length - 1].price_bnb, pA)})`);
    }
    console.log('   锚后末价: ' + line.join(' '));
  }

  // 6) trades（跨实验）
  const { data: tr, error: tre } = await c.from('trades')
    .select('*').eq('token_address', ADDR)
    .order('id', { ascending: true }).limit(20);
  if (tre) console.log('trades err: ' + tre.message);
  console.log(`\ntrades 共 ${(tr || []).length} 行`);
  for (const t of (tr || [])) {
    const brief = {};
    for (const k of ['id', 'experiment_id', 'trade_direction', 'trade_status', 'input_amount', 'output_amount', 'price_bnb', 'profit_loss', 'created_at']) if (t[k] !== undefined && t[k] !== null) brief[k] = typeof t[k] === 'string' && t[k].length > 40 ? t[k].slice(0, 36) : t[k];
    console.log(`  ${JSON.stringify(brief)}`);
  }

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
