#!/usr/bin/env node
// ============================================================================
// fourmeme uw 分布全量调研 v3（2026-10-02，用户质疑「uw>=15 与 fourmeme 互斥」论断）
//
// 之前论断的缺陷：只看了 V6 53 条买信号（已过 condition 层 = TPA>2.5/holders>5/
// buyVolumeBnb>=1.5 先筛过）的 uw 值——选择样本，不能代表 fourmeme 全量分布。
//
// v1/v2 教训：
//   - v1 读 V6 名下 experiment_tokens.created_at = 回放注册墙钟（10-02）→ 全零假分布
//   - v2 wss_events 全表 361 万行拉不动
//   - 正解：源实验 B2=960d1bbf 是 42h 虚拟实跑，其 experiment_tokens.created_at =
//     watcher 实时发现时刻 ≈ 链上创建时间，且 V6 引擎锚就读它（_loadTokenMetadata
//     .eq(sourceExperimentId)）——bit-identical 锚，轻查询
//
// uw 口径（与 EarlyParticipantCheckService._calculateBasicStats/_fetchEarlyTrades 对齐）：
//   - 窗：[create, create+90s] 闭区间（用户质疑字面口径；引擎是滚动 [fire−90s,fire]，
//     fire∈[0,90s] 内 → 创建锚窗是其上界——对「天然少不少」的定性不敏感）
//   - 行过滤：price_outlier=false && price_usd 非空（引擎同款）
//   - distinct：COALESCE(sender, trader) 小写，买卖行都进（引擎同款）
//   - 对照：uwBuyOnly（只 buy 行）+ trader 口径 + sender 解析率
//
// 输出：①② 平台 × uw 分桶/分布 ③④ sender 解析率与口径对照 ⑤ uw 门错杀分析
//       （30min max/p90 ≥3x 高涨幅票 × uw 桶）⑥ V6 实际买到票 uw 对照
// ============================================================================
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const V6 = '82093ca3-ea73-4f26-9aef-cb9a1acee842';
const SRC = '960d1bbf-c561-4651-abb6-7f1a17e153e6'; // V6 源实验（42h 虚拟实跑，锚权威）
const CACHE_DIR = path.join(__dirname, '..', 'data', 'tick-cache', 'backtest', SRC);

function* readGzipLines(file) {
  const buf = fs.readFileSync(file);
  const text = zlib.gunzipSync(buf).toString('utf8');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    yield JSON.parse(line);
  }
}

const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const f2 = (x) => (Math.round(x * 100) / 100).toFixed(2);
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();

  // ── 锚 + 平台：源实验 B2 experiment_tokens（V6 引擎同源；排序分页与
  //    BacktestEngine._loadTokenMetadata 同款——created_at 排序走得了的形状）──
  const meta = new Map(); let off = 0, pulled = 0;
  for (;;) {
    const { data, error } = await db.from('experiment_tokens')
      .select('token_address, platform, created_at').eq('experiment_id', SRC)
      .order('created_at', { ascending: true }).range(off, off + 999);
    if (error) throw new Error('experiment_tokens: ' + error.message);
    if (!data || !data.length) break;
    pulled += data.length;
    for (const t of data) {
      const ms = t.created_at ? new Date(t.created_at).getTime() : NaN;
      if (Number.isFinite(ms)) meta.set(t.token_address, { platform: t.platform || 'fourmeme', t0ms: ms });
    }
    if (data.length < 1000) break; off += 1000;
  }
  console.log(`源实验 token 锚 ${meta.size}（拉取 ${pulled} 行；fourmeme ${[...meta.values()].filter(m=>m.platform==='fourmeme').length} / flap ${[...meta.values()].filter(m=>m.platform==='flap').length}）`);

  // ── V6 买到票集（对照）──
  const bought = new Set(); off = 0;
  for (;;) {
    const { data } = await db.from('trades').select('token_address')
      .eq('experiment_id', V6).eq('trade_direction', 'buy').eq('success', true).range(off, off + 999);
    if (!data || !data.length) break;
    data.forEach(r => bought.add(r.token_address)); if (data.length < 1000) break; off += 1000;
  }

  // ── ticks 聚合（引擎口径过滤：outlier=false + price_usd 非空）──
  const stats = new Map();
  const files = [['fourmeme', 'fourmeme.jsonl.gz'], ['flap', 'flap.jsonl.gz']];
  let filteredOut = 0, anchorMiss = 0;
  for (const [platLabel, file] of files) {
    const fp = path.join(CACHE_DIR, file);
    if (!fs.existsSync(fp)) { console.error('缺缓存文件: ' + fp); continue; }
    let n = 0;
    for (const row of readGzipLines(fp)) {
      n++;
      if (row.price_outlier) { filteredOut++; }
      if (row.price_outlier || row.price_usd == null) continue; // 引擎同款过滤
      const m = meta.get(row.token_address);
      if (!m) { anchorMiss++; continue; }
      const ts = new Date(row.block_time).getTime();
      if (!Number.isFinite(ts)) continue;
      if (ts < m.t0ms || ts > m.t0ms + 30 * 60 * 1000) continue; // 创建后 30min 外不看
      let s = stats.get(row.token_address);
      if (!s) { s = { plat: m.platform, wallets: new Set(), walletsBuy: new Set(), walletsTrader: new Set(), rows: 0, buys: 0, senderNull: 0, senderTotal: 0, p90: null, maxP: 0, has90: false }; stats.set(row.token_address, s); }
      const p = Number(row.price_bnb) || 0;
      if (p > s.maxP) s.maxP = p;
      if (ts <= m.t0ms + 90 * 1000) {
        s.has90 = true;
        if (p > 0) s.p90 = p;
        s.rows++;
        const sender = row.sender_address, trader = row.trader_address;
        const w = (sender || trader || '').toLowerCase();
        if (w) s.wallets.add(w);
        s.walletsTrader.add((trader || '').toLowerCase());
        if (row.trade_type === 'buy') { s.buys++; if (w) s.walletsBuy.add(w); s.senderTotal++; if (!sender) s.senderNull++; }
      }
    }
    console.log(`${platLabel} 缓存行处理完成（${n} 行，outlier 过滤累计 ${filteredOut}）`);
  }
  console.log(`锚 miss 行: ${anchorMiss}`);
  for (const s of stats.values()) { s.uw = s.wallets.size; s.uwBuy = s.walletsBuy.size; s.uwTrader = s.walletsTrader.size; delete s.wallets; delete s.walletsBuy; delete s.walletsTrader; }

  // ══ ①② uw 分桶 + 分布 × 平台 ══
  const buckets = [[0, 0], [1, 5], [5, 10], [10, 15], [15, 30], [30, 60], [60, 1e9]];
  for (const plat of ['fourmeme', 'flap']) {
    const rows = [...stats.values()].filter(s => s.plat === plat && s.has90);
    const uws = rows.map(s => s.uw);
    const ge15 = rows.filter(s => s.uw >= 15);
    console.log(`\n[${plat}] 90s 窗有 tick 的 token ${rows.length} | uw（买卖合并 distinct）P25=${f1(pct(uws, .25))} P50=${f1(pct(uws, .5))} P75=${f1(pct(uws, .75))} P90=${f1(pct(uws, .9))} max=${Math.max(...uws, 0)} | uw>=15: ${ge15.length} 张 (${(ge15.length / rows.length * 100).toFixed(1)}%)`);
    for (const [lo, hi] of buckets) {
      const b = rows.filter(s => s.uw >= lo && (hi === 1e9 ? true : s.uw < hi));
      if (!b.length) continue;
      const mults = b.filter(s => s.p90 > 0 && s.maxP > 0).map(s => s.maxP / s.p90);
      console.log(`  uw [${lo},${hi === 1e9 ? '+' : hi}): ${b.length} token (${(b.length / rows.length * 100).toFixed(1)}%) | 30min max/p90 P50=${f2(median(mults))}x P90=${f2(pct(mults, .9))}x max=${f2(Math.max(...mults, 0))}x | ≥3x: ${(mults.filter(m => m >= 3).length / Math.max(mults.length, 1) * 100).toFixed(1)}%`);
    }
    const no90 = [...stats.values()].filter(s => s.plat === plat && !s.has90).length;
    console.log(`  （90s 窗零 tick token 另有 ${no90} 张，uw=0 被拦形状，未入上表）`);
  }

  // ══ ③④ sender 解析率 + 口径对照 ══
  console.log('\n══ sender 解析率 / 口径对照（90s 窗，buy 行）══');
  for (const plat of ['fourmeme', 'flap']) {
    const rows = [...stats.values()].filter(s => s.plat === plat && s.buys > 0);
    const st = rows.reduce((a, s) => a + s.senderTotal, 0), sn = rows.reduce((a, s) => a + s.senderNull, 0);
    console.log(`${plat}: 有 buy 行 token ${rows.length} | sender NULL 率 ${(sn / st * 100).toFixed(1)}% | 全行 uw>=15: ${rows.filter(s => s.uw >= 15).length} | 只算 buy uw>=15: ${rows.filter(s => s.uwBuy >= 15).length} | trader 口径 uw>=15: ${rows.filter(s => s.uwTrader >= 15).length}`);
  }

  // ══ ⑤ uw 门错杀分析 ══
  console.log('\n══ 错杀分析（30min max/p90 >= 3x 高涨幅票 × uw 桶 × 平台）══');
  for (const plat of ['fourmeme', 'flap']) {
    const rows = [...stats.entries()].filter(([, s]) => s.plat === plat && s.p90 > 0 && s.maxP / s.p90 >= 3);
    const b15 = rows.filter(([, s]) => s.uw < 15), a15 = rows.filter(([, s]) => s.uw >= 15);
    console.log(`${plat}: 3x+ 票共 ${rows.length} | uw<15（被门拦形状）${b15.length} 张 | uw>=15 ${a15.length} 张`);
    for (const [a, s] of [...b15].sort((x, y) => (y[1].maxP / y[1].p90) - (x[1].maxP / x[1].p90)).slice(0, 5)) {
      console.log(`    ${(s.maxP / s.p90).toFixed(1)}x uw=${s.uw} uwBuy=${s.uwBuy} rows90=${s.rows} ${a}`);
    }
  }

  // ══ ⑥ 买到票 uw 对照 ══
  console.log('\n══ V6 买到票 uw 分布（按平台）══');
  for (const plat of ['flap', 'fourmeme']) {
    const buws = [...stats.entries()].filter(([a, s]) => bought.has(a) && s.plat === plat).map(([, s]) => s.uw);
    if (buws.length) console.log(`${plat}: 买到 ${buws.length} 张 | uw P25=${f1(pct(buws, .25))} P50=${f1(median(buws))} P75=${f1(pct(buws, .75))} min=${Math.min(...buws)}`);
  }

  console.log('\n[done]');
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
