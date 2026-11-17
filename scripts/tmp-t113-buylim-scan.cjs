// T113 pump-imbalance-exit 买入额度门定线扫描（182 跑）：
// 用户裁定方向「realHoldDuration>=30 AND sinceEntryNetBuyRatio>=90 卖臂，
// 至少买入额度要有一定限制，不要一点小额度买就下车」——扫多实验全部触发帧
// 的 sinceEntryBuyBnb 分布 + 卖出后 10min 前向路径（maxUp/end10/后续买量），
// 按 X 阈值分桶看「拦住的会怎样 / 放行的会怎样」。
// 用法：node scripts/tmp-t113-buylim-scan.cjs
const { dbManager } = require('../src/services/dbManager.js');

// 新→旧序（重叠窗去重保最新实验的记录）
const EXPS = [
  ['bt-v140', '6e75ed6d-807a-4164-9551-d3b95d1fc37b'],
  ['bt-v138', '341dd3af-fe17-430f-9fbb-490b4f4e42d0'],
  ['bt-v137', 'd14d4173-c618-42f6-8b24-f0a598ed1b76'],
  ['bt-v136', '54c045ff-ab63-4bad-b71e-08b2e224c266'],
  ['bt-v134', '19ef6433-0c92-47ff-a6fd-9f6bea745b8d'],
  ['bt-v133', '550f9e89-1deb-49af-98b9-9906265b1161'],
  ['bt-v132', 'b67b7318-1715-443d-a29b-7919b2db6e65'],
  ['bt-v131', 'f3dd5537-654b-48a2-8e2a-1ba3699af29a'],
  ['bt-v115', '34e78e97-2b1f-4e3d-8272-b0cdd6b641ca'],
  ['bt-v111', '5390bbfa-0c86-48a2-b9e1-94537c54ac17'],
  ['bt-v110', '029bd863-55e5-4319-91d5-10803a6a9a82'],
  ['bt-v109', '029bd863-55e5-4319-91d5-10803a6a9a82'],
];

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
const fmt = (v, d = 3) => (v == null ? '  null' : v.toFixed(d));

(async () => {
  const c = await dbManager.getClient();
  const seen = new Set(); // token|exitMinute 去重（跨实验重叠窗）
  const rows = [];
  let deduped = 0;

  for (const [name, id] of EXPS) {
    if (rows.some(r => r.exp === name)) continue; // 防手滑重复 id
    const { data: exp } = await c.from('experiments').select('experiment_name,config').eq('id', id).limit(1);
    if (!exp || !exp[0]) { console.log(`[${name}] 实验行缺失，跳过`); continue; }
    const legs = ((exp[0].config || {}).strategiesConfig || {}).sellStrategies || [];
    const legIdx = legs.findIndex(l => /sinceEntryNetBuyRatio/.test(l.condition || ''));
    if (legIdx < 0) { console.log(`[${name}] 无 pump-imbalance 腿，跳过`); continue; }
    const leg = legs[legIdx];
    const legId = `sell_${legIdx}_${leg.priority || 0}`; // 引擎 id=sell_<idx>_<priority>
    console.log(`[${name}] legId=${legId} condition=${leg.condition}`);

    // 分页拉全部 sell 信号（metadata 大，只取所需列）
    let from = null, sigs = [], page = 0;
    do {
      let q = c.from('strategy_signals')
        .select('id,token_address,created_at,metadata')
        .eq('experiment_id', id).eq('action', 'sell')
        .order('created_at', { ascending: true }).limit(1000);
      if (from) q = q.gt('created_at', from);
      const { data, error } = await q;
      if (error) throw new Error(`${name} signals: ${error.message}`);
      sigs = sigs.concat(data);
      from = data.length === 1000 ? data[999].created_at : null;
      page++;
    } while (from && page < 20);

    const fired = sigs.filter(s => {
      const md = s.metadata || {};
      return md.strategyId === legId && md.execution_status !== 'blocked';
    });
    console.log(`[${name}] sell 信号=${sigs.length} 本腿触发=${fired.length}`);

    for (const s of fired) {
      const md = s.metadata || {};
      const fr = md.trendFactors || md.factorResults || {};
      const buyBnb = num(fr.sinceEntryBuyBnb);
      const ratio = num(fr.sinceEntryNetBuyRatio);
      const hold = num(fr.realHoldDuration);
      const pp = num(md.profitPercent);
      const exitMs = Date.parse(s.created_at);
      const key = `${s.token_address}|${Math.round(exitMs / 60000)}`;
      if (seen.has(key)) { deduped++; continue; }
      seen.add(key);

      // 前向 10min；基准价=fire tick 的 BNB 可靠价（md.price 是 USD 不能混除）
      let maxUp = null, minDn = null, end10 = null, buy10 = 0, sell10 = 0, tick10 = 0;
      let basePx = null;
      {
        const { data: pre } = await c.from('wss_price_ticks')
          .select('price_bnb,price_outlier')
          .eq('token_address', s.token_address)
          .lte('block_time', s.created_at)
          .order('block_time', { ascending: false }).limit(5);
        const rel = (pre || []).find(t => t.price_bnb && !t.price_outlier);
        if (rel) basePx = rel.price_bnb;
      }
      const { data: ticks } = await c.from('wss_price_ticks')
        .select('block_time,trade_type,bnb_amount,price_bnb,price_outlier')
        .eq('token_address', s.token_address)
        .gt('block_time', s.created_at)
        .lte('block_time', new Date(exitMs + 10 * 60 * 1000).toISOString())
        .order('block_time', { ascending: true }).limit(2000);
      if (ticks && basePx) {
        let lastRel = null;
        for (const t of ticks) {
          tick10++;
          if (t.trade_type === 'buy') buy10 += t.bnb_amount || 0; else sell10 += t.bnb_amount || 0;
          if (t.price_bnb && !t.price_outlier) {
            const chg = t.price_bnb / basePx - 1;
            if (maxUp == null || chg > maxUp) maxUp = chg;
            if (minDn == null || chg < minDn) minDn = chg;
            lastRel = t.price_bnb;
          }
        }
        if (lastRel) end10 = lastRel / basePx - 1;
      }
      rows.push({ exp: name, token: s.token_address, exitIso: s.created_at, hold, buyBnb, ratio, pp, maxUp, minDn, end10, buy10, sell10, tick10 });
    }
  }

  console.log(`\n== 触发合计=${rows.length}（跨实验去重丢=${deduped}）==\n`);
  rows.sort((a, b) => (a.buyBnb ?? 9e9) - (b.buyBnb ?? 9e9));
  console.log('明细（按 sinceEntryBuyBnb 升序；maxUp/end10=卖出后10min 可靠价最大涨幅/窗末）：');
  for (const r of rows) {
    console.log(`${r.buyBnb == null ? ' null' : r.buyBnb.toFixed(3)}B | ${fmt(r.ratio, 0)}% | hold=${fmt(r.hold, 0)}s | 卖时pp=${fmt(r.pp, 1)}% | maxUp=${fmt((r.maxUp ?? NaN) * 100, 1)}% | 10min末=${fmt((r.end10 ?? NaN) * 100, 1)}% | 后10min买=${fmt(r.buy10, 2)}B/卖=${fmt(r.sell10, 2)}B | ${r.exp} ${r.token.slice(0, 10)}… ${String(r.exitIso).slice(5, 19)}`);
  }

  // 阈值分桶
  const Xs = [0.3, 0.5, 0.8, 1.0, 1.5, 2.0, 3.0];
  const stat = (arr) => {
    if (!arr.length) return 'n=0';
    const med = (a) => a[Math.floor(a.length / 2)];
    const ups = arr.map(r => (r.maxUp ?? -1) * 100).sort((x, y) => x - y);
    const ends = arr.map(r => (r.end10 ?? -1) * 100).sort((x, y) => x - y);
    const pps = arr.map(r => (r.pp ?? 0));
    const big = ups.filter(v => v >= 20).length;
    return `n=${arr.length} 卖时pp均值=${fmt(pps.reduce((a, b) => a + b, 0) / pps.length, 1)}% maxUp中位=${fmt(med(ups), 1)}% 均值=${fmt(ups.reduce((a, b) => a + b, 0) / ups.length, 1)}% ≥+20%=${big}/${arr.length} 10min末中位=${fmt(med(ends), 1)}%`;
  };
  console.log('\n== 阈值分桶（拦住=sinceEntryBuyBnb < X 的触发若不卖继续持有 10min 的假想路径；放行=X 以上照卖）==');
  for (const X of Xs) {
    const blocked = rows.filter(r => r.buyBnb != null && r.buyBnb < X);
    const kept = rows.filter(r => r.buyBnb != null && r.buyBnb >= X);
    console.log(`\nX=${X}`);
    console.log(`  拦住: ${stat(blocked)}`);
    console.log(`  放行: ${stat(kept)}`);
  }

  // null buyBnb 的触发单列
  const nulls = rows.filter(r => r.buyBnb == null);
  if (nulls.length) console.log(`\n⚠ sinceEntryBuyBnb=null 触发=${nulls.length}（快照缺键？单列核查）`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
