// 一次性（182 跑）：launch 三方案调研主体——
//   票池=11-04~11-05 全量 token_create（fourmeme 2525 + flap 8452；flap quote 盘标记后主体统计剔除）
//   per token 全史 ticks（500/页分页，极活跃票 5000 笔截断）：
//     firstBuy 价/金额、首可靠价、全史 min/max/last 可靠价、spanSec
//   Phase 5：fourmeme 偏离票（firstBuy vs FM 常量 |偏离|≥5%）抽样 40 只链上读 _tokenInfos.K → 真 P₀=K×8.6694e-19
//   输出 /tmp/launch-research.json + console 分组汇总
const { dbManager } = require('../../src/services/dbManager.js');
const FM = 4496173469e-18;
const FL = 6.14 / (107036752 + 1e9);
const FROM = '2026-11-04T00:00:00Z';
const TO = '2026-11-06T00:00:00Z';

async function fetchAllTicks(sb, addr) {
  const rows = [];
  let fromId = 0;
  for (;;) {
    const { data, error } = await sb.from('wss_price_ticks')
      .select('id,block_time,trade_type,bnb_amount,price_bnb,price_outlier,quote_token')
      .eq('token_address', addr).gt('id', fromId).order('id', { ascending: true }).limit(500);
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < 500) break;
    fromId = data[data.length - 1].id;
    if (rows.length >= 5000) break;
  }
  return rows;
}

async function ethCall(to, data) {
  const RPCS = ['https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.defibit.io', 'https://bsc-dataseed2.defibit.io'];
  let lastErr = null;
  for (let i = 0; i < RPCS.length; i++) {
    try {
      const res = await fetch(RPCS[i], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
      });
      const j = await res.json();
      if (j.result) return j.result;
      lastErr = new Error(j.error ? j.error.message : 'empty result');
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

async function main() {
  const sb = await dbManager.getClient();
  const t0 = Date.now();

  // ---- 票池（id 游标分页）----
  const creates = [];
  {
    let fromId = 0;
    for (;;) {
      const { data } = await sb.from('wss_events')
        .select('id,platform,token_address').eq('kind', 'token_create')
        .gt('id', fromId).gte('block_time', FROM).lte('block_time', TO)
        .order('id', { ascending: true }).limit(1000);
      if (!data || !data.length) break;
      creates.push(...data);
      if (data.length < 1000) break;
      fromId = data[data.length - 1].id;
    }
  }
  console.log(`票池 ${creates.length} 只（${((Date.now() - t0) / 1000).toFixed(0)}s）`);

  // ---- quote 盘集（token_quote_set 事件，flap）----
  const quoteSet = new Set();
  {
    let fromId = 0;
    for (;;) {
      const { data } = await sb.from('wss_events')
        .select('id,token_address').eq('kind', 'token_quote_set')
        .gt('id', fromId).gte('block_time', FROM).lte('block_time', TO)
        .order('id', { ascending: true }).limit(1000);
      if (!data || !data.length) break;
      for (const r of data) quoteSet.add(r.token_address.toLowerCase());
      if (data.length < 1000) break;
      fromId = data[data.length - 1].id;
    }
  }
  console.log(`quote_set 事件票 ${quoteSet.size} 只`);

  // ---- 主体：逐票全史锚 ----
  const out = [];
  let dataErrors = 0;
  for (let i = 0; i < creates.length; i++) {
    const c = creates[i];
    const addr = c.token_address;
    if ((i + 1) % 200 === 0) console.log(`[${i + 1}/${creates.length}] ${((Date.now() - t0) / 1000 / 60).toFixed(1)}min`);
    let rows;
    try { rows = await fetchAllTicks(sb, addr); }
    catch (e) { dataErrors++; continue; }
    let isQuote = quoteSet.has(addr.toLowerCase());
    const rel = [];
    for (const r of rows) {
      if (r.quote_token) isQuote = true; // 双保险
      if (r.price_bnb > 0 && !r.price_outlier) rel.push(r);
    }
    let firstBuy = null, firstBuyBnb = null, firstBuyTs = null;
    for (const r of rows) {
      if (r.trade_type === 'buy' && r.price_bnb > 0) { firstBuy = r.price_bnb; firstBuyBnb = r.bnb_amount; firstBuyTs = r.block_time; break; }
    }
    let minPx = null, minTs = null, maxPx = null, lastPx = null, lastTs = null;
    for (const r of rel) {
      if (minPx === null || r.price_bnb < minPx) { minPx = r.price_bnb; minTs = r.block_time; }
      if (maxPx === null || r.price_bnb > maxPx) maxPx = r.price_bnb;
      lastPx = r.price_bnb; lastTs = r.block_time;
    }
    out.push({
      a: addr, p: c.platform, q: isQuote ? 1 : 0, n: rows.length,
      fb: firstBuy, fbb: firstBuyBnb, fbt: firstBuyTs,
      fr: rel.length ? rel[0].price_bnb : null,
      min: minPx, minAt: minTs, max: maxPx, last: lastPx,
      spanSec: rel.length > 1 ? (Date.parse(lastTs) - Date.parse(rel[0].block_time)) / 1000 : null,
    });
  }
  console.log(`主体完成 ${out.length} 只（dataErrors=${dataErrors}，${((Date.now() - t0) / 1000 / 60).toFixed(1)}min）`);
  require('fs').writeFileSync('/tmp/launch-research.json', JSON.stringify(out));

  // ---- 汇总 ----
  const pct = (a, b) => ((a / b) - 1) * 100;
  for (const platform of ['fourmeme', 'flap']) {
    const CONST = platform === 'fourmeme' ? FM : FL;
    const pool = out.filter((r) => r.p === platform && !r.q);
    const traded = pool.filter((r) => r.fb);
    console.log(`\n===== [${platform}] 非 quote 总 ${pool.length} | 有首买 ${traded.length} | 零成交 ${pool.length - traded.length} =====`);
    // firstBuy vs 常量 分布（有首买票）
    const bands = [['<-20%', -1e9, -20], ['-20~-5', -20, -5], ['-5~+5(常量域)', -5, 5], ['+5~+20', 5, 20], ['+20~+50', 20, 50], ['>+50%', 50, 1e9]];
    for (const [name, lo, hi] of bands) {
      const g = traded.filter((r) => { const d = pct(r.fb, CONST); return d >= lo && d < hi; });
      if (!g.length) { console.log(`  ${name}: 0`); continue; }
      // 表现：maxVsFirstBuy / lastVsFirstBuy（同起点公平比较）
      const maxVs = g.map((r) => pct(r.max, r.fb)).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
      const lastVs = g.map((r) => pct(r.last, r.fb)).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
      const med = (arr) => (arr.length ? arr[Math.floor(arr.length / 2)] : null);
      const p90 = (arr) => (arr.length ? arr[Math.floor(arr.length * 0.9)] : null);
      const good = maxVs.filter((v) => v >= 50).length;
      console.log(`  ${name}: ${g.length} 只 | maxVs首买 中位=${med(maxVs) === null ? '-' : med(maxVs).toFixed(1)}% P90=${p90(maxVs) === null ? '-' : p90(maxVs).toFixed(1)}% ≥+50%=${good}(${g.length ? (100 * good / g.length).toFixed(0) : 0}%) | lastVs首买 中位=${med(lastVs) === null ? '-' : med(lastVs).toFixed(1)}%`);
    }
    // 首可靠价 vs 常量（零成交票也有首可靠价吗——零成交=无任何成交，无 tick。有 sell 无 buy 的票 fb=null 但 fr 在）
    const withRel = pool.filter((r) => r.fr);
    const frBands = withRel.map((r) => pct(r.fr, CONST)).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (frBands.length) {
      const med = frBands[Math.floor(frBands.length / 2)];
      console.log(`  首可靠价 vs 常量（${frBands.length} 只）: min=${frBands[0].toFixed(1)}% p25=${frBands[Math.floor(frBands.length * 0.25)].toFixed(1)}% 中位=${med.toFixed(1)}% p75=${frBands[Math.floor(frBands.length * 0.75)].toFixed(1)}% max=${frBands[frBands.length - 1].toFixed(1)}%`);
    }
    // minPx vs 常量：全史曾跌破常量的票（方案三锚会下移的域）
    const belowConst = pool.filter((r) => r.min && pct(r.min, CONST) < -5);
    console.log(`  全史 min 较常量 < -5%: ${belowConst.length} 只（${pool.length ? (100 * belowConst.length / pool.length).toFixed(1) : 0}%）`);
  }

  // ---- Phase 5：fourmeme 偏离票链上 K 采样 ----
  console.log('\n===== Phase 5 fourmeme 偏离票真 P₀（K×8.6694e-19，dataseed eth_call） =====');
  const dev = out.filter((r) => r.p === 'fourmeme' && r.fb && Math.abs(pct(r.fb, FM)) >= 5);
  const lows = dev.filter((r) => pct(r.fb, FM) < 0).slice(0, 20);
  const highs = dev.filter((r) => pct(r.fb, FM) > 0).slice(0, 20);
  const TM2 = '0x5c952063c7fc8610FFDB798152D69F0B9550762b';
  const { id } = { id: null }; // selector 手算
  // _tokenInfos(address) selector: ethers 在 182 有装，但保底手写 keccak 不行——用 ethers
  let sel;
  try { const ethers = require('ethers'); sel = ethers.id('_tokenInfos(address)').slice(0, 10); }
  catch (e) { console.log('ethers 不可用，跳过 Phase 5:', e.message); sel = null; }
  if (sel) {
    for (const grp of [['低开', lows], ['高开', highs]]) {
      for (const r of grp[1]) {
        try {
          const data = sel + '0'.repeat(24) + r.a.slice(2).toLowerCase();
          const hex = await ethCall(TM2, data);
          const words = hex.slice(2);
          const Kraw = BigInt('0x' + words.slice(64 * 10, 64 * 11));
          const P0 = Number(Kraw) / 1e18 * 8.6694e-19;
          console.log(`  [${grp[0]}] ${r.a} firstBuy=${r.fb.toExponential(4)} (${pct(r.fb, FM).toFixed(1)}% vs 常量) | K链上P₀=${P0.toExponential(4)} (${pct(P0, FM).toFixed(1)}% vs 常量) | firstBuy vs 真P₀=${pct(r.fb, P0).toFixed(1)}%`);
        } catch (e) {
          console.log(`  [${grp[0]}] ${r.a} eth_call 失败: ${e.message}`);
        }
      }
    }
  }
  console.log(`\n总耗时 ${((Date.now() - t0) / 1000 / 60).toFixed(1)}min；结果已写 /tmp/launch-research.json`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
