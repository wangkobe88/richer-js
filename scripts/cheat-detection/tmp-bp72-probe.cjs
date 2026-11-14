// 一次性探针（182 跑）：族二裁定两问题取证——
// 问题一「无对倒换手」（7 票）：买点前一段只有卖出、买入很弱 → 不是换手低点应拦；
// 问题二「暴跌后小活跃期」（6 票）：识别近期暴跌 → 非正常换手非持续下跌应拦；
// 反例（7 票）：a813/f485/40a2/28ad/c84a（慢跌可接受判例）+ 米/施工鸭（对倒正例）——判据不得误伤。
// 输出：锚窗 5s 桶分解 + 近窗 30s/60s 买卖结构 + 近期暴跌段定位（距今秒数/深度/未收复幅度）。
const { dbManager } = require('../../src/services/dbManager.js');

const V100 = '11fc182a-b051-4665-857c-5c14e6713334';
const V95 = '675c71a1-0e19-49b6-924b-facffc073afd';
const V94 = '85cbad14-696f-49b2-baa4-a5407df4a2d2';

const TOKENS = [
  // 问题一：无对倒换手（只有卖出/买入很弱）
  { g: 1, exp: V100, tag: 'idx19-Flap', addr: '0xe622a0ec83546b63db65e9b9bf5c225aec417777' },
  { g: 1, exp: V100, tag: 'idx26-LABU', addr: '0x1ac4a310874e29290720d2fb55300a91a23e7777' },
  { g: 1, exp: V100, tag: 'idx181-汤圆', addr: '0xeaeb67c29c73d86da820265748e4f043871d7777' },
  { g: 1, exp: V100, tag: 'idx52-王涛', addr: '0x1cf8569749438a7bea491438383698040207ffff' },
  { g: 1, exp: V100, tag: 'idx98-불개미', addr: '0xb54e248fae36131958085f2ec5524de4c3524444' },
  { g: 1, exp: V100, tag: 'idx175-海水过滤器', addr: '0x30238ffd6137cd0fa70e681d0d5585d413cbffff' },
  { g: 1, exp: V100, tag: 'idx185-CR', addr: '0x57d431ae0a47d57be9bae3623ce35fb805747777' },
  // 问题二：暴跌后小活跃期
  { g: 2, exp: V100, tag: 'idx5-苹果SI', addr: '0xc9bf4530033f6497002d228296fedb45036f7777' },
  { g: 2, exp: V100, tag: 'idx168-LOVE', addr: '0xf0b83df726bba9a8a01fcd5da0b2303e83ca7777' },
  { g: 2, exp: V100, tag: 'idx190-赵公主', addr: '0x258e485725b8d799b885b9f079241e2c812d7777' },
  { g: 2, exp: V100, tag: 'idx195-币安之心', addr: '0x08aa150d7d86c4a0dfa37f310c1380de9c187777' },
  { g: 2, exp: V100, tag: 'idx206-蝴蝶人生路', addr: '0xb359716d1affde1fb9d351fec71a0f2e79257777' },
  { g: 2, exp: V100, tag: 'idx210-屎壳郎自拉', addr: '0x2ef6c0e630d34b78ad36aabe04cd90f57e3c7777' },
  // 反例：慢跌可接受 + 对倒正例
  { g: 0, exp: V94, tag: 'RE-a813-阶梯阴跌', addr: '0xa813cd684ce664d2dcde26797246e3b4ffd37777' },
  { g: 0, exp: V94, tag: 'RE-f485-穿插反弹', addr: '0xf485ec1d518185e73ca53164ddaa85dcfde77777' },
  { g: 0, exp: V94, tag: 'RE-40a2-慢跌', addr: '0x40a2e8f5ceb8ee6aec025512596b9ffaaa954444' },
  { g: 0, exp: V95, tag: 'RE-28ad-V形收复', addr: '0x28ad2c7d08d83a85467bd4afcfd673dfce564444' },
  { g: 0, exp: V95, tag: 'RE-c84a-慢跌横盘', addr: '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777' },
  { g: 0, exp: V95, tag: 'RE-米-对倒', addr: '0x338a510c6c7abd4c714d74225086542270427777' },
  { g: 0, exp: V95, tag: 'RE-施工鸭-对倒', addr: '0x459f1d098437fad48931372f9b16b6ad25297777' },
];

const f1 = (v) => v == null ? '-' : Number(v).toFixed(1);

async function pullTicks(client, addr) {
  const rows = [];
  let fromId = 0;
  for (;;) {
    const { data, error } = await client.from('wss_price_ticks')
      .select('id,block_time,block_number,log_index,price_bnb,bnb_amount,trade_type,price_outlier')
      .eq('token_address', addr).gt('id', fromId).order('id', { ascending: true }).limit(1000);
    if (error) throw error;
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
    fromId = data[data.length - 1].id;
  }
  rows.sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
  return rows;
}

function analyze(rows, anchorMs, label) {
  const win = rows.filter((x) => Date.parse(x.block_time) <= anchorMs).slice(-3000);
  if (!win.length) return `  ${label} 锚窗空`;
  const tEnd = Date.parse(win[win.length - 1].block_time);
  const rel = win.filter((x) => !x.price_outlier && x.price_bnb > 0);
  const out = [];
  // ── 近窗买卖结构（30s/60s/120s，非尘 tick 全量）──
  for (const wSec of [30, 60, 120]) {
    const w = win.filter((x) => tEnd - Date.parse(x.block_time) < wSec * 1000);
    let buyBnb = 0, sellBnb = 0, buyN = 0, sellN = 0;
    for (const r of w) {
      const amt = Number(r.bnb_amount) || 0;
      if (r.trade_type === 'buy') { buyBnb += amt; buyN++; } else { sellBnb += amt; sellN++; }
    }
    const tot = buyBnb + sellBnb;
    out.push(`W${wSec}: 买${buyBnb.toFixed(2)}B/${buyN}笔 卖${sellBnb.toFixed(2)}B/${sellN}笔 买占比${tot > 0 ? ((buyBnb / tot) * 100).toFixed(0) : '-'}%`);
  }
  // ── 价格动量（末价 vs 5/10/30s 前最近可靠价）──
  const lastRel = rel[rel.length - 1];
  const mom = [];
  for (const s of [5, 10, 30, 60]) {
    const cut = tEnd - s * 1000;
    let base = null;
    for (const r of rel) { if (Date.parse(r.block_time) <= cut) base = r; else break; }
    if (base) mom.push(`chg${s}=${(((lastRel.price_bnb / base.price_bnb) - 1) * 100).toFixed(1)}`);
  }
  // ── ATH/低点 ──
  let ath = null, athTs = null, min = null;
  for (const r of rel) {
    if (ath == null || r.price_bnb > ath) { ath = r.price_bnb; athTs = Date.parse(r.block_time); }
    if (min == null || r.price_bnb < min) min = r.price_bnb;
  }
  const curVsAth = ((lastRel.price_bnb / ath) - 1) * 100;
  // ── 5s 桶分解：找近期最深 5s 跌幅段（桶末可靠价环比）──
  const buckets = new Map();
  for (const r of rel) {
    const b = Math.floor(Date.parse(r.block_time) / 5000);
    if (!buckets.has(b)) buckets.set(b, { t: Date.parse(r.block_time), p: r.price_bnb, buy: 0, sell: 0, buyN: 0, sellN: 0, n: 0 });
    const bk = buckets.get(b);
    bk.t = Date.parse(r.block_time); bk.p = r.price_bnb; bk.n++;
    if (r.trade_type === 'buy') { bk.buy += Number(r.bnb_amount) || 0; bk.buyN++; } else { bk.sell += Number(r.bnb_amount) || 0; bk.sellN++; }
  }
  const bs = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  let worstDip = null; // {secAgo, dip, unrecovered}
  for (let i = 1; i < bs.length; i++) {
    const dip = ((bs[i][1].p / bs[i - 1][1].p) - 1) * 100;
    if (worstDip == null || dip < worstDip.dip) worstDip = { secAgo: (tEnd - bs[i][1].t) / 1000, dip, segStartP: bs[i - 1][1].p, t: bs[i][1].t };
  }
  // 未收复幅度：锚价 vs 暴跌段起点价
  const unrecovered = worstDip ? ((lastRel.price_bnb / worstDip.segStartP) - 1) * 100 : null;
  // ── 近 120s 桶序列路径形态：正 5s 段（反弹腿）计数/最深正段 ──
  const bs120 = bs.filter(([, bk]) => tEnd - bk.t < 120000);
  let posSeg = 0, maxPos = 0, negSeg = 0;
  for (let i = 1; i < bs120.length; i++) {
    const chg = ((bs120[i][1].p / bs120[i - 1][1].p) - 1) * 100;
    if (chg >= 5) posSeg++;
    if (chg <= -5) negSeg++;
    if (chg > maxPos) maxPos = chg;
  }
  // ── 距最近一笔像样买入（≥0.02B）的秒数 + 该笔金额 ──
  let lastBuy = null;
  for (const r of win) {
    if (r.trade_type === 'buy' && (Number(r.bnb_amount) || 0) >= 0.02) lastBuy = r;
  }
  const secSinceBuy = lastBuy ? (tEnd - Date.parse(lastBuy.block_time)) / 1000 : null;
  // 连续纯卖段：买点前最长连续（5s 桶）买入≈0 的段
  let zeroBuyRun = 0, curRun = 0, zeroBuySpanSec = 0, curSpanStart = null, zbBest = { run: 0, spanSec: 0 };
  for (const [, bk] of bs) {
    if (bk.buy < 0.02) { curRun++; if (curRun === 1) curSpanStart = bk.t; if (curRun > zbBest.run) zbBest = { run: curRun, spanSec: (bk.t - curSpanStart) / 1000 + 5 }; }
    else curRun = 0;
  }
  // 尾段 5s/10s
  const tail5 = win.filter((x) => tEnd - Date.parse(x.block_time) < 5000);
  const t5buy = tail5.filter((x) => x.trade_type === 'buy').length;
  const tail10 = win.filter((x) => tEnd - Date.parse(x.block_time) < 10000);
  const t10buyBnb = tail10.filter((x) => x.trade_type === 'buy').reduce((a, x) => a + (Number(x.bnb_amount) || 0), 0);
  const t10sellBnb = tail10.filter((x) => x.trade_type !== 'buy').reduce((a, x) => a + (Number(x.bnb_amount) || 0), 0);
  const winSpan = (tEnd - Date.parse(win[0].block_time)) / 1000;
  return [
    `  ${label} 窗${winSpan.toFixed(0)}s/${win.length}笔`,
    `    ${out.join(' | ')}`,
    `    ${mom.join(' ')} curVsAth=${curVsAth.toFixed(1)}(ATH距${((tEnd - athTs) / 1000).toFixed(0)}s) curVsMin=${(((lastRel.price_bnb / min) - 1) * 100).toFixed(1)}`,
    `    最深5s段: ${worstDip ? `${worstDip.dip.toFixed(1)}% 距今${worstDip.secAgo.toFixed(0)}s 未收复${unrecovered == null ? '-' : unrecovered.toFixed(1)}%` : '-'} | 最长零买桶段: ${zbBest.run}桶/${zbBest.spanSec.toFixed(0)}s`,
    `    近120s路径: 正5s段${posSeg}个(最大+${maxPos.toFixed(1)}%) 负5s段${negSeg}个 | 距上笔像样买${secSinceBuy == null ? '-' : secSinceBuy.toFixed(0) + 's/' + (Number(lastBuy.bnb_amount) || 0).toFixed(2) + 'B'}`,
    `    尾5s买笔${t5buy} 尾10s买${t10buyBnb.toFixed(2)}B/卖${t10sellBnb.toFixed(2)}B`,
  ].join('\n');
}

async function main() {
  const client = await dbManager.getClient();
  for (const t of TOKENS) {
    const { data: sigs } = await client.from('strategy_signals')
      .select('id,created_at,metadata')
      .eq('experiment_id', t.exp).eq('token_address', t.addr)
      .order('id', { ascending: true }).limit(60);
    const bps = (sigs || []).filter((s) => s.metadata && s.metadata.buyPoint);
    const rows = await pullTicks(client, t.addr);
    // 反例无 BP 字段时用 trades 成交锚兜底（判例放行点位=生产实际买入时刻）
    let tradeAnchor = null;
    if (!bps.length) {
      const { data: trs } = await client.from('trades')
        .select('created_at,executed_at').eq('experiment_id', t.exp).eq('token_address', t.addr)
        .eq('side', 'buy').order('created_at', { ascending: true }).limit(1);
      if (trs && trs.length) tradeAnchor = trs[0].executed_at || trs[0].created_at;
    }
    console.log(`\n## [问题${t.g === 0 ? '反例' : t.g}] ${t.tag} ticks=${rows.length} BP信号${bps.length}条`);
    if (!bps.length) { console.log(await analyze(rows, Date.parse(tradeAnchor || rows[rows.length - 1].block_time), `成交锚${String(tradeAnchor || '').slice(11, 19)}`)); continue; }
    // 打全部 BP 锚（放行成交的点位在最后几条）
    for (const s of bps) {
      const d = (s.metadata.buyPoint.dimensions || {}).entry_shape || {};
      const an = s.metadata.buyPoint.anchors || {};
      const head = `锚${s.created_at.slice(11, 19)} entry=${d.bucket}(${d.prob}) chg5=${f1(an.chg5Pct)} nDn5=${f1(an.nearMaxDn5Pct)} curVsAth=${f1(an.currentVsAthPct)}`;
      console.log(await analyze(rows, Date.parse(s.created_at), head));
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
