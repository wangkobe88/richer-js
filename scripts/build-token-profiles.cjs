#!/usr/bin/env node
// ============================================================================
// 离线批量代币分类——token_profiles 表构建（批 3.1 分类器首个离线驱动，2026-09-23）
//
// 对一个实验涉及的全部 token（experiment_tokens，回测实验自动解析源实验）
// 从 wss_price_ticks 拉全史 ticks → slim tick（mine 同构映射：含尘/outlier，
// priceReliable=!outlier&&px>0&&bnb>=minTickBnb）→ classifyToken（bsc-v1，
// wash/pump_dump/high_mcap_wash/quality/high_mcap/normal/low_quality/low_activity）
// → upsert token_profiles（token_address 全局 PK，与在线 OPB 同 shape）。
//
// category_visible_at 口径：离线用 computeFirstIdleVisibleAt（复刻 OPB 双触发
// 首 idle/bigIdle 可见时刻），无空窗（token 仍活）→ null → 回退 classified_at（保守）。
// 重复 upsert 幂等（onConflict token_address 覆盖重分类）。
//
// 用法：node scripts/build-token-profiles.cjs --experiment <id>
// 重查询（全史 ticks）——只在 182 远程跑（红线）。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../', 'config/.env') });
const { classifyToken, computeFirstIdleVisibleAt, CLASSIFIER_VERSION } = require('./shared/token-classifier');
const { DEFAULT_SCORING_PARAMS } = require('./shared/classifier-constants');

const MIN_TICK_BNB = 0.001;   // collector 落表尘门（与在线 _acceptPrice 双保险一致）
const UPSERT_BATCH = 100;

async function main() {
  const a = process.argv;
  let expId = null;
  for (let i = 2; i < a.length; i++) {
    if (a[i] === '--experiment') expId = a[++i];
    else { console.error(`未知参数: ${a[i]}`); process.exit(1); }
  }
  if (!expId) { console.error('缺 --experiment <experimentId>'); process.exit(1); }

  const { dbManager } = require('../src/services/dbManager');
  const sb = dbManager.getClient();

  // ── 回测实验 → 源实验（experiment_tokens 挂源）──
  const { data: exp, error: expErr } = await sb.from('experiments').select('id,config').eq('id', expId).single();
  if (expErr || !exp) { console.error('实验不存在:', expErr && expErr.message); process.exit(1); }
  let cfg = exp.config || {};
  if (typeof cfg === 'string') cfg = JSON.parse(cfg);
  const srcId = (cfg.backtest && cfg.backtest.sourceExperimentId) || expId;
  console.log(`实验 ${expId.slice(0, 8)} → 代币源实验 ${srcId.slice(0, 8)}`);

  // ── experiment_tokens：token 全集 + totalSupply（raw_api_data，mine 路 2 同构）──
  const tokens = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb.from('experiment_tokens')
      .select('token_address, raw_api_data, created_at')
      .eq('experiment_id', srcId).order('created_at', { ascending: true }).range(off, off + 999);
    if (error) throw new Error('experiment_tokens 查询失败: ' + error.message);
    tokens.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  // 同 token 多行取最新（mine 同构）
  const meta = new Map();
  for (const r of tokens) {
    const ts = Number(r.raw_api_data && r.raw_api_data.totalSupply);
    meta.set(r.token_address, Number.isFinite(ts) && ts > 0 ? ts : 0);
  }
  const tokenList = [...meta.keys()];
  console.log(`token 全集 ${tokenList.length}`);

  // ── wss_price_ticks 全史（.in 100/批 + range 1000 分页）──
  const slimByTok = new Map();
  let totalTicks = 0, t0 = Date.now();
  for (let i = 0; i < tokenList.length; i += 100) {
    const batch = tokenList.slice(i, i + 100);
    for (let off = 0; ; off += 1000) {
      const { data, error } = await sb.from('wss_price_ticks')
        .select('token_address,trader_address,trade_type,block_time,block_number,bnb_amount,price_bnb,price_usd,price_outlier')
        .in('token_address', batch).order('block_time', { ascending: true }).range(off, off + 999);
      if (error) throw new Error('ticks 查询失败: ' + error.message);
      for (const t of (data || [])) {
        if (!t.token_address || !t.trader_address) continue;
        const ts = Date.parse(t.block_time);
        if (!Number.isFinite(ts)) continue;
        const bnb = +t.bnb_amount || 0;
        const px = +t.price_bnb;
        if (!slimByTok.has(t.token_address)) slimByTok.set(t.token_address, []);
        slimByTok.get(t.token_address).push({
          ts, isBuy: String(t.trade_type).toLowerCase() === 'buy',
          bnbAmount: bnb, priceBnb: px > 0 ? px : 0,
          priceUsd: t.price_usd != null ? +t.price_usd : null,
          traderAddress: t.trader_address,
          blockNumber: t.block_number != null ? Number(t.block_number) : 0,
          priceReliable: !t.price_outlier && px > 0 && bnb >= MIN_TICK_BNB,
        });
        totalTicks++;
      }
      if (!data || data.length < 1000) break;
    }
  }
  for (const arr of slimByTok.values()) arr.sort((x, y) => x.ts - y.ts || x.blockNumber - y.blockNumber);
  console.log(`ticks ${totalTicks} / ${slimByTok.size} token（${Date.now() - t0}ms）`);

  // ── 分类 + upsert ──
  const dist = new Map();
  const nowIso = new Date().toISOString();
  const rows = [];
  for (const [addr, ticks] of slimByTok) {
    const totalSupply = meta.get(addr) || 0;
    const r = classifyToken(ticks, { totalSupply }, { diagnostic: true });
    const visMs = computeFirstIdleVisibleAt(ticks);
    dist.set(r.category, (dist.get(r.category) || 0) + 1);
    rows.push({
      token_address: addr,
      category: r.category,
      source: 'offline',
      classifier_version: CLASSIFIER_VERSION,
      classified_at: nowIso,
      category_visible_at: visMs != null ? new Date(visMs).toISOString() : nowIso,
      peak_mcap_usd: r.maxMarketCap || 0,
      profile: {
        version: 1,
        category: r.category,
        source: 'offline',
        classified_at: nowIso,
        classifier_version: CLASSIFIER_VERSION,
        max_market_cap_usd: r.maxMarketCap || 0,
        class_info: r.classInfo,
        config_snapshot: { qualityMarketCapThreshold: DEFAULT_SCORING_PARAMS.qualityMarketCapThreshold },
        reason: r.reason || null,
        category_visible_at: visMs != null ? new Date(visMs).toISOString() : nowIso,
        flash_crash_period: r.flashCrashPeriod || null,
        violent_crash_blocks: r.violentCrashBlocks || [],
        first_tick_time: r.firstTickTime ? new Date(r.firstTickTime).toISOString() : null,
        last_tick_time: r.lastTickTime ? new Date(r.lastTickTime).toISOString() : null,
        conflict: null,
      },
    });
  }
  // 无 tick 的 token（实验记录但无成交流）：low_activity 占位（MIN_TICKS 语义同构）
  for (const addr of tokenList) {
    if (slimByTok.has(addr)) continue;
    dist.set('low_activity', (dist.get('low_activity') || 0) + 1);
    rows.push({
      token_address: addr, category: 'low_activity', source: 'offline',
      classifier_version: CLASSIFIER_VERSION, classified_at: nowIso, category_visible_at: nowIso,
      peak_mcap_usd: 0,
      profile: { version: 1, category: 'low_activity', source: 'offline', classified_at: nowIso, classifier_version: CLASSIFIER_VERSION, max_market_cap_usd: 0, class_info: null, reason: 'low_activity: 无 ticks', category_visible_at: nowIso, flash_crash_period: null, violent_crash_blocks: [], first_tick_time: null, last_tick_time: null, conflict: null },
    });
  }

  let written = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const { error } = await sb.from('token_profiles').upsert(rows.slice(i, i + UPSERT_BATCH), { onConflict: 'token_address' });
    if (error) throw new Error('token_profiles 写入失败: ' + error.message);
    written += Math.min(UPSERT_BATCH, rows.length - i);
  }
  console.log(`写入 token_profiles ${written} 行（source=offline, ${CLASSIFIER_VERSION}）`);
  console.log('── 分类分布 ──');
  for (const [cat, n] of [...dist.entries()].sort((x, y) => y[1] - x[1])) console.log(`  ${cat.padEnd(16)} ${String(n).padStart(4)}`);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
