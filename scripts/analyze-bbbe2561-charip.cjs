#!/usr/bin/env node
// bbbe2561（v20 live both）形象化 IP（叙事 category A）亏损结构分析（2026-10-17）
//
// 用户提问：抖音/中文区站点的可爱形象票是否亏损严重？→ 按 category A × 语料平台
// 分组，输出逐 token PnL + 叙事档位明细（地址必带）。
// 数据：trades（ExperimentStatsService FIFO 同口径）+ token_narrative（全局行）。
// 用法（182 上、仓库根目录跑）：node scripts/analyze-bbbe2561-charip.cjs
// 产物：data/analysis-<expid8>-charip.json + stdout 摘要表
'use strict';

const { dbManager } = require('../src/services/dbManager');
const { ExperimentStatsService } = require('../src/web/services/ExperimentStatsService');

const EXP_ID = process.argv[2] || 'bbbe2561-6a98-46a5-bf65-6038800dfb62';
const CN_PLATFORMS = ['douyin', 'weibo', 'weixin', 'xiaohongshu', 'bilibili'];

const r2 = (n) => Math.round(n * 1e4) / 1e4;

async function fetchNarrativeRows(db, addresses) {
  const rows = [];
  for (let i = 0; i < addresses.length; i += 50) {
    const batch = addresses.slice(i, i + 50);
    const { data, error } = await db
      .from('token_narrative')
      .select('token_address,token_symbol,analyzed_at,is_valid,prompt_version,pre_check_result,prestage_result,stage1_result,stage_final_result,classified_urls,twitter_info,extracted_info,platform,token_category')
      .in('token_address', batch);
    if (error) throw new Error(`token_narrative 查询失败: ${error.message}`);
    if (data) rows.push(...data);
  }
  return rows;
}

function extractNarrative(row) {
  const s1 = row.stage1_result || {};
  const jev = s1.details?.jev || null;
  // stage1 缺失但有 prestage = 账号/宣告 prestage 路径（无 A/B/C 分类）
  const isPrestage = !row.stage1_result && (row.prestage_result || row.stage_final_result);
  const cu = row.classified_urls || {};
  const platforms = Object.keys(cu).filter((k) => Array.isArray(cu[k]) && cu[k].length > 0);
  const tweetText = String(row.twitter_info?.text || '').replace(/\s+/g, ' ').slice(0, 130);
  return {
    symbol: row.token_symbol,
    category: s1.category ?? (isPrestage ? 'P' : null),
    tier: jev?.magnitudeTier ?? null,
    tweetType: jev?.tweetType ?? null,
    timing: jev?.timing ?? null,
    finalScore: row.stage_final_result?.score ?? null,
    analyzedAt: row.analyzed_at,
    promptVersion: row.prompt_version,
    isValid: row.is_valid,
    platform: row.platform ?? null,
    tokenCategory: row.token_category ?? null,
    platforms,
    cnPlatforms: platforms.filter((p) => CN_PLATFORMS.includes(p)),
    tweetText,
  };
}

async function main() {
  const db = dbManager.getClient();
  const svc = new ExperimentStatsService();

  // 实验行（名字/状态/窗口）
  const { data: exp, error: expErr } = await db.from('experiments').select('*').eq('id', EXP_ID).single();
  if (expErr) throw new Error(`experiments 查询失败: ${expErr.message}`);
  console.log(`experiment: ${exp.name} | status=${exp.status} | platform=${exp.platform ?? '?'} | created=${exp.created_at}`);

  // trades（分页全量）
  const trades = await svc.getTrades(EXP_ID);
  console.log(`trades rows: ${trades.length}`);

  // per-token 聚合
  const byToken = new Map();
  for (const t of trades) {
    if (!byToken.has(t.token_address)) byToken.set(t.token_address, []);
    byToken.get(t.token_address).push(t);
  }

  // 叙事行
  const addresses = [...byToken.keys()];
  const narrativeRows = await fetchNarrativeRows(db, addresses);
  const narrativeByAddr = new Map(narrativeRows.map((r) => [r.token_address, r]));
  const { resolveFinalRating, categoryToRating } = await import('../src/narrative/utils/rating-utils.mjs');

  const tokens = [];
  for (const [addr, list] of byToken) {
    const pnl = svc.calculateTokenPnL(addr, trades);
    const succ = list.filter((t) => t.trade_status === 'success' || t.status === 'success');
    const failed = list.length - succ.length;
    const buys = succ.filter((t) => (t.trade_direction || t.direction) === 'buy').length;
    const sells = succ.length - buys;
    const nar = narrativeByAddr.get(addr);
    let narInfo = null;
    let finalRating = null;
    if (nar) {
      finalRating = categoryToRating(resolveFinalRating(nar));
      narInfo = extractNarrative(nar);
    }
    tokens.push({
      address: addr,
      symbol: narInfo?.symbol || list[0].token_symbol || '?',
      netBnb: pnl ? r2(pnl.totalReceived - pnl.totalSpent) : 0,
      spentBnb: pnl ? r2(pnl.totalSpent) : 0,
      receivedBnb: pnl ? r2(pnl.totalReceived) : 0,
      returnRatePct: pnl ? Math.round(pnl.returnRate * 10) / 10 : null,
      remainingCostBnb: pnl ? r2(pnl.remainingCost) : 0,
      trades: list.length, buys, sells, failed,
      firstTradeAt: list[0]?.created_at ?? null,
      lastTradeAt: list[list.length - 1]?.created_at ?? null,
      finalRating,
      narrative: narInfo,
    });
  }

  tokens.sort((a, b) => a.netBnb - b.netBnb);

  // 分组摘要
  const group = (name, pred) => {
    const g = tokens.filter(pred);
    const net = r2(g.reduce((s, t) => s + t.netBnb, 0));
    const spent = r2(g.reduce((s, t) => s + t.spentBnb, 0));
    const wins = g.filter((t) => t.netBnb > 0).length;
    console.log(`\n== ${name}: n=${g.length} win=${wins} net=${net} BNB (spent ${spent})`);
    for (const t of g) {
      const cn = t.narrative?.cnPlatforms?.join('+') || '';
      const hint = (t.narrative?.tweetText || '').slice(0, 46);
      console.log(
        `  ${t.netBnb >= 0 ? '+' : ''}${t.netBnb.toFixed(4)} ${String(t.returnRatePct ?? '?').padStart(6)}%  ${String(t.symbol).slice(0, 12).padEnd(12)} ${t.address}  cat=${t.narrative?.category ?? '?'} tier=${t.narrative?.tier ?? '?'} score=${t.narrative?.finalScore ?? '?'} rating=${t.finalRating ?? '?'} plat=${t.narrative?.platform ?? '?'} cn=${cn || '-'} | ${hint}`
      );
    }
    return { name, n: g.length, wins, net, spent };
  };

  const summaries = [];
  summaries.push(group('A 类(形象IP) × 中文语料', (t) => t.narrative?.category === 'A' && t.narrative?.cnPlatforms?.length > 0));
  summaries.push(group('A 类(形象IP) × 无中文语料', (t) => t.narrative?.category === 'A' && !(t.narrative?.cnPlatforms?.length > 0)));
  summaries.push(group('B/C/D/E/W 类', (t) => t.narrative && 'BCDEW'.includes(String(t.narrative.category))));
  summaries.push(group('prestage 路径（无分类）', (t) => t.narrative?.category === 'P'));
  summaries.push(group('无叙事行', (t) => !t.narrative));
  // rating 分布
  const byRating = {};
  for (const t of tokens) {
    const k = `r${t.finalRating ?? 'none'}`;
    byRating[k] = byRating[k] || { n: 0, net: 0 };
    byRating[k].n += 1;
    byRating[k].net = r2(byRating[k].net + t.netBnb);
  }
  console.log('\n== 按 finalRating 分组 ==');
  console.log(JSON.stringify(byRating));

  const fs = require('fs');
  const out = {
    experiment: { id: EXP_ID, name: exp.name, status: exp.status, platform: exp.platform ?? null, createdAt: exp.created_at },
    generatedAt: new Date().toISOString(),
    summaries,
    byRating,
    tokens,
  };
  fs.writeFileSync('data/analysis-' + EXP_ID.slice(0,8) + '-charip.json', JSON.stringify(out, null, 2));
  console.log('\nwritten: data/analysis-' + EXP_ID.slice(0,8) + '-charip.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
