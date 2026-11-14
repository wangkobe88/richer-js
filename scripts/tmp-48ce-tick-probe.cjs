// 182 跑：0x48ce...7777 持有窗 ticks 时间线（id 探针窗 + 内存过滤）
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager.js');
const TOKEN = '0x48ce79731e040194fcfa71496a94090a28f57777';
const EXP = 'c6efed13-ce9d-41b0-89a5-8ca8b029a609';
const T0 = Date.parse('2026-11-05T05:28:00Z');
const T1 = Date.parse('2026-11-05T05:36:30Z');
const BUY_AT = Date.parse('2026-11-05T05:31:05.746Z');
const SELL_AT = Date.parse('2026-11-05T05:34:32.295Z');

const ts = (v) => (typeof v === 'number' ? v : Date.parse(v));

async function main() {
  const c = await dbManager.getClient();

  // A. 信号快照（token 全局 + 内存过滤，双 eq 会被吞成空）
  const { data: sigs } = await c.from('strategy_signals')
    .select('experiment_id,created_at,action,executed,metadata')
    .eq('token_address', TOKEN).order('created_at').limit(50);
  for (const s of (sigs || []).filter(x => x.experiment_id === EXP)) {
    const m = s.metadata || {};
    const tf = m.trendFactors || {};
    console.log(`SIG ${s.action.toUpperCase()} ${s.created_at} ex=${s.executed} strat=${m.strategyId ?? '-'}` +
      ` profit%=${tf.profitPercent ?? '-'} realHold=${tf.realHoldDuration ?? '-'} tradeCount=${tf.tradeCount ?? '-'} tokenAge=${tf.tokenAgeSec ?? '-'}`);
  }

  // B. 二分找 block_time >= T0 的最小 id
  const { data: maxRow } = await c.from('wss_price_ticks').select('id,block_time').order('id', { ascending: false }).limit(1);
  let hi = Number(maxRow[0].id);
  let lo = 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const { data } = await c.from('wss_price_ticks').select('id,block_time').gte('id', mid).order('id', { ascending: true }).limit(1);
    if (!data || !data[0]) { lo = mid + 1; continue; }
    if (ts(data[0].block_time) >= T0) hi = mid; else lo = mid + 1;
  }
  console.log('窗口起始 id =', lo);

  // C. 分页拉全窗行（≤400 页保险丝），内存过滤 token
  const rows = [];
  let lastId = lo - 1;
  let reachedEnd = false;
  for (let i = 0; i < 400 && !reachedEnd; i++) {
    const { data, error } = await c.from('wss_price_ticks')
      .select('id,block_time,token_address,bnb_amount,price_bnb')
      .gt('id', lastId).order('id', { ascending: true }).limit(1000);
    if (error) throw error;
    if (!data || !data.length) break;
    for (const r of data) {
      lastId = Number(r.id);
      if (ts(r.block_time) > T1) { reachedEnd = true; break; }
      if (r.token_address === TOKEN) rows.push(r);
    }
    if (data.length < 1000) break;
  }
  rows.sort((a, b) => Number(a.id) - Number(b.id));
  console.log(`窗口内该票 ticks = ${rows.length}`);

  // D. 时间线 + gap 分析（尘门 0.001：非尘 tick 才推进 FA lastTickAt）
  let prevNonDust = null;
  let maxGap = 0;
  let maxGapAt = null;
  for (const r of rows) {
    const t = ts(r.block_time);
    const dust = Number(r.bnb_amount) < 0.001;
    let gapStr = '';
    if (!dust) {
      if (prevNonDust != null) {
        const gap = (t - prevNonDust) / 1000;
        gapStr = ` gap=${gap.toFixed(1)}s`;
        if (gap > maxGap) { maxGap = gap; maxGapAt = r.block_time; }
      }
      prevNonDust = t;
    }
    const tag = t >= BUY_AT && t <= SELL_AT ? 'HOLD' : (t < BUY_AT ? 'pre' : 'post');
    console.log(`${r.block_time} id=${r.id} bnb=${r.bnb_amount}${dust ? ' [尘]' : ''} price=${r.price_bnb} ${tag}${gapStr}`);
  }
  console.log(`\n最大非尘 gap = ${maxGap.toFixed(1)}s @ ${maxGapAt}`);
  // 持有窗内最大 gap（严格 BUY_AT..SELL_AT 之间的非尘相邻间隔）
  const holdRows = rows.filter(r => ts(r.block_time) >= BUY_AT && ts(r.block_time) <= SELL_AT && Number(r.bnb_amount) >= 0.001);
  let hg = 0, hgp = null;
  for (let i = 1; i < holdRows.length; i++) {
    const g = (ts(holdRows[i].block_time) - ts(holdRows[i - 1].block_time)) / 1000;
    if (g > hg) { hg = g; hgp = holdRows[i].block_time; }
  }
  console.log(`持有窗内非尘 ticks = ${holdRows.length}，窗内最大 gap = ${hg.toFixed(1)}s @ ${hgp}`);
  if (holdRows.length) {
    const lastInHold = ts(holdRows[holdRows.length - 1].block_time);
    console.log(`持有窗最后一笔非尘 tick = ${new Date(lastInHold).toISOString()}，距卖出信号 ${(SELL_AT - lastInHold) / 1000 .toFixed ? ((SELL_AT - lastInHold) / 1000).toFixed(1) : '-'}s`);
    const firstInHold = ts(holdRows[0].block_time);
    console.log(`买入前最后一笔非尘 tick = ...首笔窗内 tick=${new Date(firstInHold).toISOString()}（买入后 ${(firstInHold - BUY_AT) / 1000}s）`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
