// 一次性观察（182 跑）：BP58 点位性质立项——砸盘/对倒低价/尖刺拉盘锚窗形状对拍
// 七票（bt-v94 85cbad14）：3 砸盘 + 2 对倒低价 + 苍蝇（活跃衰减）+ 1 尖刺拉盘
// 输出：旧判 / BP51 现判 fresh / 自算价格轨迹（5s 桶+跌幅+3% 反弹计数）/ 近窗买卖 / bt-v94 盈亏
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');
const { buildBuyPointSnapshot } = require('../../src/market-analysis/buy-point-snapshot.js');

const EXP = '85cbad14-696f-49b2-baa4-a5407df4a2d2'; // bt-v94
const TOKENS = [
  { name: '砸盘1-第六案', addr: '0xf0b83df726bba9a8a01fcd5da0b2303e83ca7777', cls: 'crash' },
  { name: '砸盘2', addr: '0xb6f4e229d446747c41dc1c7eb631816f95f17777', cls: 'crash' },
  { name: '砸盘3', addr: '0x08aa150d7d86c4a0dfa37f310c1380de9c187777', cls: 'crash' },
  { name: '对倒低价1', addr: '0x338a510c6c7abd4c714d74225086542270427777', cls: 'wash_low' },
  { name: '对倒低价2', addr: '0x459f1d098437fad48931372f9b16b6ad25297777', cls: 'wash_low' },
  { name: '苍蝇-活跃衰减', addr: '0x04323e04c5f48587951c2d974b7f1b007b6e7777', cls: 'decay' },
  { name: '尖刺拉盘', addr: '0xbfc8f025427ef4049b6d679c0506cdf2b4164444', cls: 'spike' },
];
const logger = { info() {}, warn() {}, error() {} };

async function sigsAll(exp) {
  const out = []; let cur = '';
  for (let p = 0; p < 40; p++) {
    let b = dbManager.getClient().from('strategy_signals')
      .select('id,token_address,created_at,metadata').eq('experiment_id', exp).eq('signal_type', 'BUY')
      .order('created_at', { ascending: true }).limit(1000); if (cur) b = b.gt('created_at', cur);
    const { data, error } = await b;
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    out.push(...data); cur = data[data.length - 1].created_at; if (data.length < 1000) break;
  }
  return out;
}

// 3% 阈值 zigzag：数 ≥3% 的上弹次数（反弹）与下腿次数，末段方向
function zigzag3(series) {
  if (series.length < 2) return { ups: 0, downs: 0, lastDir: 0 };
  let dir = 0, extP = series[0][1], extT = series[0][0]; const legs = [];
  for (let i = 1; i < series.length; i++) {
    const [t, p] = series[i];
    const chg = (p - extP) / extP;
    if (dir >= 0 && chg <= -0.03) { if (dir === 1) legs.push({ dir: 1, from: extT }); dir = -1; extP = p; extT = t; }
    else if (dir <= 0 && chg >= 0.03) { if (dir === -1) legs.push({ dir: -1, from: extT }); dir = 1; extP = p; extT = t; }
    else if ((dir === 1 && p > extP) || (dir === -1 && p < extP) || dir === 0) { extP = p; extT = t; }
  }
  return { ups: legs.filter((l) => l.dir === 1).length, downs: legs.filter((l) => l.dir === -1).length, lastDir: dir };
}

(async () => {
  const client = await dbManager.getClient();
  const sigs = await sigsAll(EXP);
  for (const s of sigs) { if (typeof s.metadata === 'string') { try { s.metadata = JSON.parse(s.metadata); } catch { s.metadata = {}; } } }
  const { data: creates } = await client.from('wss_events')
    .select('token_address,payload,block_time').eq('kind', 'token_create').in('token_address', TOKENS.map((t) => t.addr));
  const createByToken = new Map((creates || []).map((r) => [r.token_address, r]));
  const { data: etRows } = await client.from('experiment_tokens')
    .select('token_address,platform').eq('experiment_id', EXP).in('token_address', TOKENS.map((t) => t.addr));
  const platByToken = new Map((etRows || []).map((r) => [r.token_address, r.platform]));
  const metaFor = (addr) => {
    const c = createByToken.get(addr); const p = (c && c.payload) || {};
    return { address: addr, symbol: p.symbol || null, name: p.name || null, platform: platByToken.get(addr) || p.platform || 'fourmeme', createdAtMs: c ? Date.parse(c.block_time) : null };
  };

  // bt-v94 trades 盈亏（七票；trade_direction + BNB 侧金额）
  const { data: trades, error: tErr } = await client.from('trades')
    .select('token_address,trade_direction,input_currency,output_currency,input_amount,output_amount,trade_status').eq('experiment_id', EXP).in('token_address', TOKENS.map((t) => t.addr));
  if (tErr) console.log('trades 查询失败:', tErr.message);
  const pnlBy = new Map();
  for (const t of (trades || [])) {
    const cur = pnlBy.get(t.token_address) || { buys: 0, sells: 0, bnbIn: 0, bnbOut: 0 };
    const inB = Number(t.input_amount) || 0; const outB = Number(t.output_amount) || 0;
    if (t.trade_direction === 'buy') { cur.buys++; cur.bnbIn += inB; }
    else { cur.sells++; cur.bnbOut += outB; }
    pnlBy.set(t.token_address, cur);
  }

  const svc = new BuyPointCheckService({ enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false }, logger, {});

  for (const tok of TOKENS) {
    const rows = sigs.filter((s) => s.token_address === tok.addr);
    if (!rows.length) { console.log(`\n##### ${tok.name} ${tok.addr} 无信号行`); continue; }
    const sig = rows.find((s) => (s.metadata || {}).execution_status === 'executed') || rows[0];
    const anchorMs = Date.parse(sig.created_at);
    const oldBp = (() => { const bp = (sig.metadata || {}).buyPoint || {}; const a = bp.assessment || {}; const d = bp.dimensions || {};
      return `综=${a.bucket || '?'}(${a.rule || '?'}) act=${(d.activity_level || {}).bucket || '?'} pat=${(d.market_pattern || {}).bucket || '?'}`; })();

    // BP51 现判 fresh 真调
    let fresh = '?';
    try {
      const res = await svc.gateBuyPoint(tok.addr, metaFor(tok.addr), { experimentId: 'bp58-observe' }, { anchorMs });
      const a = (res && res.assessment) || {}; const d = (res && res.dimensions) || {};
      fresh = `综=${a.bucket || res.status}(${a.rule || '-'}) act=${(d.activity_level || {}).bucket || '?'} pat=${(d.market_pattern || {}).bucket || '?'}`;
    } catch (e) { fresh = 'ERR ' + e.message; }

    // 锚窗行（生产同源口径）
    const pull = await svc._pullTicksDb(tok.addr, anchorMs);
    const rrows = pull.rows || [];
    const meta = metaFor(tok.addr);
    const snap = buildBuyPointSnapshot(rrows, meta, { capped: pull.capped, anchorTickCount: pull.anchorTickCount });
    const bd = snap.buyDerived || {}; const cd = snap.cheatDerived || {};
    const a17 = (bd.activity) || {};

    // 自算轨迹：可靠价 5s 桶（锚前 300s）
    const rel = rrows.filter((r) => Number(r.price_bnb) > 0 && !r.price_outlier && Date.parse(r.block_time) <= anchorMs);
    const buckets = new Map();
    for (const r of rel) { const t = Date.parse(r.block_time); const b = Math.floor(t / 5000) * 5000; buckets.set(b, Number(r.price_bnb)); } // 桶末价
    const keys = [...buckets.keys()].sort((x, y) => x - y).filter((k) => k >= anchorMs - 300000);
    const series = keys.map((k) => [k, buckets.get(k)]);
    const anchorP = series.length ? series[series.length - 1][1] : null;
    const priceAgo = (ms) => { const target = anchorMs - ms; let best = null;
      for (const [t, p] of series) { if (t <= target + 5000) best = p; else break; } return best; };
    const fall = (ms) => { const p0 = priceAgo(ms); return (p0 && anchorP) ? ((p0 - anchorP) / p0 * 100) : null; };
    const seg120 = series.filter(([t]) => t >= anchorMs - 120000);
    const zz = zigzag3(seg120);
    const seg60 = series.filter(([t]) => t >= anchorMs - 60000);
    let maxUp5 = 0, maxDn5 = 0;
    for (let i = 1; i < seg60.length; i++) { const c = (seg60[i][1] - seg60[i - 1][1]) / seg60[i - 1][1] * 100; if (c > maxUp5) maxUp5 = c; if (c < maxDn5) maxDn5 = c; }

    // 近窗买卖（30/60s）
    const winStat = (ms) => { const w = rrows.filter((r) => { const t = Date.parse(r.block_time); return t > anchorMs - ms && t <= anchorMs; });
      let buyB = 0, sellB = 0, buyN = 0, sellN = 0; const sw = new Set();
      for (const r of w) { const b = Number(r.bnb_amount) || 0; if (r.trade_type === 'buy') { buyB += b; buyN++; } else { sellB += b; sellN++; sw.add((r.sender_address || r.trader_address || '').toLowerCase()); } }
      return { buyB, sellB, buyN, sellN, sellW: sw.size }; };
    const w30 = winStat(30000); const w60 = winStat(60000);
    const pnl = pnlBy.get(tok.addr) || { buys: 0, sells: 0, bnbIn: 0, bnbOut: 0 };
    const net = pnl.bnbOut - pnl.bnbIn;

    const fireVs = ((sig.metadata || {}).trendFactors || {}).currentVsLaunchPct;
    console.log(`\n##### ${tok.name} [${tok.cls}] ${meta.symbol || '?'} ${meta.platform} ${tok.addr} @${sig.created_at.slice(11, 19)}（信号 ${rows.length} 条，锚=${sig === rows[0] ? '首条' : 'executed 条'} fire_curVs=${fireVs ?? '?'}）`);
    console.log(`  旧判[${oldBp}]`);
    console.log(`  现判[${fresh}]`);
    const curVs = bd.currentVsLaunchPct; const minVs = bd.minVsLaunchPct;
    const curMinGap = (curVs != null && minVs != null) ? (curVs - minVs).toFixed(1) : '?';
    console.log(`  launch 族: curVs=${curVs ?? '?'}% minVs=${minVs ?? '?'}% athVs=${bd.athVsLaunchPct ?? '?'}% curVsAth=${bd.currentVsAthPct ?? '?'}% cur-min=${curMinGap}pp launchCovered=${bd.launchCovered ?? '?'} ticks=${pull.anchorTickCount}${pull.capped ? '+' : ''}`);
    console.log(`  跌幅: 30s=${fall(30000) === null ? '?' : fall(30000).toFixed(1)}% 60s=${fall(60000) === null ? '?' : fall(60000).toFixed(1)}% 120s=${fall(120000) === null ? '?' : fall(120000).toFixed(1)}%（正=跌）`);
    console.log(`  60s 内 5s 桶: 最大单桶涨=${maxUp5.toFixed(1)}% 最大单桶跌=${maxDn5.toFixed(1)}% | 120s 3%反弹=${zz.ups} 次 下腿=${zz.downs} 末方向=${zz.lastDir === 1 ? '上' : zz.lastDir === -1 ? '下' : '平'}`);
    console.log(`  近窗: 30s buy=${w30.buyB.toFixed(2)}/${w30.buyN}笔 sell=${w30.sellB.toFixed(2)}/${w30.sellN}笔 卖钱包=${w30.sellW} | 60s buy=${w60.buyB.toFixed(2)}/${w60.buyN} sell=${w60.sellB.toFixed(2)}/${w60.sellN} 卖钱包=${w60.sellW}`);
    const at = a17.nearTail10 || {}; const ap = a17.nearPre20BnbPerMin; const at5 = a17.nearTail5 || {};
    console.log(`  尾窗: t10 tick=${at.TickN} 吞吐=${at.BnbPerMin ?? '?'} 卖钱包=${at.SellWallets} | 前20s 吞吐=${ap ?? '?'} | t5 tick=${at5.TickN} 买=${at5.BuyN}笔/${(at5.BuyBnb ?? 0).toFixed(2)}`);
    console.log(`  bt-v94 盈亏: 买${pnl.buys}笔/${pnl.bnbIn.toFixed(3)} 卖${pnl.sells}笔/${pnl.bnbOut.toFixed(3)} 净=${net.toFixed(3)} BNB`);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
