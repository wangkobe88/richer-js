#!/usr/bin/env node
// 一次性（182 跑）：BP44 对拍 0/9 诊断——①buy_point_analyses 最新 BP44 行的
// anchors/digest 键（minVsLaunchPct 有无值）②该票 07:14~07:16:30 价格轨迹手算
// 峰后最低+近窗流量（验证「回到过 almost_launch+活跃度又起来」材料是否真实在场）
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const TOKEN = '0x28ad2c7d08d83a85467bd4afcfd673dfce564444';

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();

  // ① 最新 BP44 分析行
  const { data: rows, error: e1 } = await db.from('buy_point_analyses')
    .select('*')
    .eq('token_address', TOKEN)
    .order('analyzed_at', { ascending: false })
    .limit(1);
  if (e1) throw new Error('bpa: ' + e1.message);
  if (rows && rows[0]) {
    const r = rows[0];
    console.log('[①最新行] analyzed_at=', r.analyzed_at, ' version=', r.question_version, ' verdict=', r.verdict);
    const d = r.snapshot_digest || {};
    console.log('  digest 顶层键:', Object.keys(d).join(','));
    console.log('  anchors:', JSON.stringify(d.anchors || {}, null, 0).slice(0, 1500));
    if (d.dimensions) console.log('  dimensions.market_pattern:', JSON.stringify(d.dimensions.market_pattern));
    if (d.assessment) console.log('  assessment:', JSON.stringify(d.assessment));
    console.log('  行全部列:', Object.keys(r).join(','));
    for (const k of Object.keys(r)) {
      if (typeof r[k] === 'object' && r[k] && k !== 'snapshot_digest') {
        console.log(`  ${k}:`, JSON.stringify(r[k]).slice(0, 600));
      }
    }
  } else console.log('[①] 无分析行');

  // ② 价格轨迹（可靠价：price_outlier 非真+price>0）
  const { data: ticks, error: e2 } = await db.from('wss_price_ticks')
    .select('block_time,price_bnb,bnb_amount,trade_type,price_outlier')
    .eq('token_address', TOKEN)
    .lte('block_time', '2026-11-08T07:16:30Z')
    .gte('block_time', '2026-11-08T07:14:00Z')
    .order('block_time', { ascending: true })
    .limit(2000);
  if (e2) throw new Error('ticks: ' + e2.message);
  console.log(`\n[②] ticks 共 ${ticks.length} 行`);
  const rel = ticks.filter((t) => t.price_bnb > 0 && !t.price_outlier);
  const launch = rel[0].price_bnb;
  let peak = -Infinity, peakIdx = -1;
  rel.forEach((t, i) => { if (t.price_bnb > peak) { peak = t.price_bnb; peakIdx = i; } });
  const afterPeak = rel.slice(peakIdx + 1);
  const minAfter = afterPeak.length ? Math.min(...afterPeak.map((t) => t.price_bnb)) : null;
  const pct = (x) => ((x / launch - 1) * 100).toFixed(1);
  console.log(`  发行价=${launch.toExponential(4)} 峰=${peak.toExponential(4)}(${pct(peak)}%) 峰时刻=${rel[peakIdx].block_time.slice(11, 19)}`);
  console.log(`  峰后最低=${minAfter != null ? minAfter.toExponential(4) : 'null(ATH在末位)'} ${minAfter != null ? '(' + pct(minAfter) + '%)' : ''}`);
  if (minAfter != null) {
    const minIdx = afterPeak.findIndex((t) => t.price_bnb === minAfter);
    console.log(`  峰后最低时刻=${afterPeak[minIdx].block_time.slice(11, 19)} → 其后行数=${afterPeak.length - 1 - minIdx}`);
  }
  // 末 30s/60s 流量（锚=07:16:15）
  for (const win of [30, 60]) {
    const t0 = Date.parse('2026-11-08T07:16:15Z') - win * 1000;
    const w = ticks.filter((t) => Date.parse(t.block_time) >= t0 && Date.parse(t.block_time) <= Date.parse('2026-11-08T07:16:15Z'));
    const buy = w.filter((t) => t.trade_type === 'buy');
    const sell = w.filter((t) => t.trade_type === 'sell');
    const sum = (a) => a.reduce((s, t) => s + Number(t.bnb_amount || 0), 0);
    console.log(`  近${win}s（→07:16:15）: ${w.length} 笔 买 ${buy.length}/${sum(buy).toFixed(2)} BNB 卖 ${sell.length}/${sum(sell).toFixed(2)} BNB`);
  }
  // 全窗量
  const allBuy = ticks.filter((t) => t.trade_type === 'buy');
  console.log(`  全窗（07:14→07:16:15 后 15s 内全部）: ${ticks.length} 笔 买 ${allBuy.length}/${allBuy.reduce((s, t) => s + Number(t.bnb_amount || 0), 0).toFixed(2)} BNB`);
  // 价格轨迹粗样（每 5s 一点）
  console.log('  轨迹（每 ~5s）:');
  let lastT = 0;
  for (const t of rel) {
    const ts = Date.parse(t.block_time);
    if (ts - lastT >= 5000) { console.log(`    ${t.block_time.slice(11, 19)} ${pct(t.price_bnb)}%`); lastT = ts; }
  }
  const last = rel[rel.length - 1];
  console.log(`    ${last.block_time.slice(11, 19)} ${pct(last.price_bnb)}% (末)`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
