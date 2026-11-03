#!/usr/bin/env node
/**
 * 买入点位分析 runner（BP1，2026-11-03）——**182 跑**（Jev 真调；本地 --dry 可跑但不
 * 必要——set 在 182）。与 build-set 同目录读 set（零 DB：set+ticks 文件自包含）。
 *
 * 链路与模块本体同源（口径单点）：per 点位 sliceAsOf 锚截窗 → buildBuyPointSnapshot
 * → buildBuyPointState → JevClient.ask(buildBuyPointQuestions) → buildBuyPointObservation
 * （mapper 纯透传，无 verdict/grade——判定形态=用户裁定「Jev 综合判定」）。
 *
 * 结局对拍（build-set 预计算随 set 落盘）：行 2 打综合判定 + 前向收益 + 引擎实际成交
 * episode 盈亏；尾部输出「综合判定 × 前向收益」观察组（校准素材非断言——分布攒票后
 * 才有校准可言，BP1=首版）。
 *
 * 用法：
 *   node scripts/buy-point/run.mjs --set <name> [--only BP-S001,BP-S002] [--limit N] [--dry]
 *     --dry=组装不烧 Jev（锚/近窗净买/现 vs ATH/state 预算）
 * 退出码：0=全过 1=有失败 2=用法错误（case-regression/cheat runner 同款）
 * 存档：data/bp-run-<ts>.json + data/prompts/<pointId>-<版本>.txt
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { createRequire } from 'module';
import { sliceAsOf } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SETS_DIR = resolve(HERE, 'sets');
const DATA_DIR = resolve(HERE, 'data');
const PROMPT_DIR = resolve(HERE, 'data', 'prompts');

const require_ = createRequire(import.meta.url);
const { buildBuyPointSnapshot } = require_('../../src/market-analysis/buy-point-snapshot.js');
const { buildBuyPointState } = require_('../../src/market-analysis/buy-point-state-builder.js');
const { buildBuyPointObservation } = require_('../../src/market-analysis/buy-point-result-mapper.js');

function parseArgs(argv) {
  const args = { set: '', only: [], limit: null, dry: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--set') args.set = String(argv[++i] || '');
    else if (a === '--only') args.only = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--dry') args.dry = true;
    else { console.error(`未知参数: ${a}`); process.exit(2); }
  }
  if (!args.set) { console.error('用法: run.mjs --set <name> [--only BP-S001,…] [--limit N] [--dry]'); process.exit(2); }
  return args;
}

/** 读 per token ticks 文件（同 token 多点位只读一次，按链上真序已排） */
function loadTicks(setName, ticksFile) {
  const p = resolve(SETS_DIR, `${setName}-ticks`, ticksFile);
  const doc = JSON.parse(readFileSync(p, 'utf8'));
  return doc.rows || [];
}

const fmt = (x, d = 2) => (x === null || x === undefined ? '-' : Number(x).toFixed(d));
const pct = (x) => (x === null || x === undefined ? '-' : `${Number(x).toFixed(1)}%`);

/** 结局行（前向收益+引擎成交），行 2 尾段 */
function outcomeLine(p) {
  const fr = p.forwardReturns;
  const h = (sec) => {
    if (!fr || !fr.byHorizon[sec]) return 'null';
    const x = fr.byHorizon[sec];
    return `+${sec / 60}min ${x === null ? 'null' : `峰${fmt(x.maxRisePct)} 末${fmt(x.lastPct)} 回${fmt(x.pullbackFromMaxPct)}`}`;
  };
  const t = p.trade || {};
  const eng = t.buyExecuted === true
    ? (t.episode && t.episode.pnlBnb !== null && t.episode.pnlBnb !== undefined
      ? `ep=${fmt(t.episode.pnlBnb, 4)} BNB${t.episode.open ? '(open 盯市)' : ''}`
      : t.episode && t.episode.open ? `ep=open 余${fmt(t.episode.openQtyToken, 0)} 未平` : 'ep=?')
    : t.buyExecuted === false ? '买败' : '无匹配';
  return `fwd ${h(60)} ｜ ${h(300)} ｜ ${h(900)} ｜ 引擎: ${eng}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const setPath = resolve(SETS_DIR, `${args.set}.json`);
  if (!existsSync(setPath)) { console.error(`set 不存在: ${setPath}（先跑 build-set.mjs）`); process.exit(2); }
  const doc = JSON.parse(readFileSync(setPath, 'utf8'));
  const tokensMeta = doc.tokens || {};
  let points = doc.points || [];
  if (args.only.length) {
    const missing = args.only.filter((id) => !points.some((p) => p.pointId === id));
    if (missing.length) { console.error(`pointId 不存在: ${missing.join(',')}`); process.exit(2); }
    points = points.filter((p) => args.only.includes(p.pointId));
  }
  if (args.limit !== null && Number.isInteger(args.limit) && args.limit > 0) points = points.slice(0, args.limit);

  const qMod = args.dry ? null : await import('../../src/market-analysis/llm/buy-point-questions.mjs');
  const version = qMod ? qMod.BUY_POINT_QUESTIONS_VERSION : '(dry)';
  console.log(`买入点位 runner：set=${args.set} ${points.length} 点位 | 题集 ${version}${args.dry ? ' | --dry 只组装不烧 Jev' : ' | 真调 Jev（30s/点）'}\n`);

  mkdirSync(DATA_DIR, { recursive: true });
  if (!args.dry) mkdirSync(PROMPT_DIR, { recursive: true });
  const ticksCache = new Map();
  const results = [];
  let failed = 0;

  for (const p of points) {
    console.log(`▶ ${p.pointId} ${p.tokenSymbol || '?'} ${p.tokenAddress}@${p.experimentId} 信号=${p.signalCreatedAt} 策略=${p.signalInfo && p.signalInfo.strategyName}`);
    try {
      if (p.anchorZero) {
        console.log('  ⏭ anchorZero（信号时刻前零 tick=数据洞），跳过');
        results.push({ pointId: p.pointId, skipped: 'anchor_zero' });
        continue;
      }
      const key = `${args.set}/${p.ticksFile}`;
      if (!ticksCache.has(key)) ticksCache.set(key, loadTicks(args.set, p.ticksFile));
      const rowsAll = ticksCache.get(key);
      const rows = sliceAsOf(rowsAll, p.anchorTickCount); // 行数不足=fail-loud（set 锚与文件漂移）
      const meta = { ...(tokensMeta[p.tokenAddress] || { address: p.tokenAddress }), quoteToken: p.quoteToken || null };
      const snapshot = buildBuyPointSnapshot(rows, meta, {
        capped: p.capped === true,
        anchorTickCount: p.anchorTickCount,
        signalInfo: {
          signalId: p.signalId, createdAt: p.signalCreatedAt,
          firePriceBnb: p.signalInfo ? p.signalInfo.price : null,
          strategyName: p.signalInfo ? p.signalInfo.strategyName : null,
        },
      });
      const { state, promptChars } = buildBuyPointState(snapshot);
      const b = snapshot.buyDerived;
      const w60 = b.win && b.win[60];
      console.log(`  锚=${p.anchorTickCount}${p.capped ? '(capped)' : ''} | age=${b.tokenAgeSec}s | 近60s 买${fmt(w60 && w60.buyBnb, 3)} 卖${fmt(w60 && w60.sellBnb, 3)} 净${fmt(w60 && w60.netBnb, 3)} | 现/ATH=${fmt(b.currentVsAthPct, 1)}%（${b.secSinceAth}s 前）| state ${promptChars} chars${p.thin ? ' | thin(<8)' : ''}`);
      if (args.dry) { results.push({ pointId: p.pointId, dry: true, promptChars }); continue; }

      const { JevClient } = await import('../../src/narrative/analyzer/llm/JevClient.mjs');
      const res = await JevClient.ask(state, qMod.buildBuyPointQuestions(), { timeoutMs: 30000, label: `buy-point-${p.pointId}` });
      const obs = buildBuyPointObservation(res.answers, b);
      writeFileSync(resolve(PROMPT_DIR, `${p.pointId}-${version}.txt`), state, 'utf8');
      const dims = Object.entries(obs.dimensions).map(([id, v]) => `${id.split('_')[0]}:${v ? v.bucket : 'null'}`).join(' ');
      console.log(`  判定 ${dims} ｜ 综合=${obs.assessment.bucket}(${fmt(obs.assessment.prob)})`);
      console.log(`  结局 ${outcomeLine(p)}`);
      results.push({
        pointId: p.pointId, tokenAddress: p.tokenAddress, experimentId: p.experimentId,
        signalId: p.signalId, signalCreatedAt: p.signalCreatedAt, anchorTickCount: p.anchorTickCount,
        thin: !!p.thin, questionVersion: version, model: res.model,
        dimensions: obs.dimensions, assessment: obs.assessment, anchors: obs.anchors,
        answersRaw: res.answers, promptChars,
        forwardReturns: p.forwardReturns || null, trade: p.trade || null,
      });
    } catch (e) {
      failed++;
      console.error(`  ❌ 异常: ${e.message}`);
      results.push({ pointId: p.pointId, tokenAddress: p.tokenAddress, error: e.message });
    }
  }

  // 存档
  if (results.length) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(resolve(DATA_DIR, `bp-run-${ts}.json`), JSON.stringify({ ranAt: new Date().toISOString(), setName: args.set, questionVersion: version, dry: args.dry, results }, null, 2), 'utf8');
  }

  // 尾部统计：综合判定分布 + ×前向收益观察组（校准素材非断言）
  const judged = results.filter((r) => r.assessment);
  const dist = {};
  for (const r of judged) dist[r.assessment.bucket] = (dist[r.assessment.bucket] || 0) + 1;
  console.log(`\n综合判定分布（${judged.length} 判/${results.length} 行）：${['good', 'neutral', 'poor', 'insufficient'].map((k) => `${k}=${dist[k] || 0}`).join(' ')}`);
  if (judged.length) {
    console.log('综合判定 × 前向收益观察组（均值/中位——BP1 首版观测素材，非断言）：');
    for (const k of ['good', 'neutral', 'poor', 'insufficient']) {
      const rows = judged.filter((r) => r.assessment.bucket === k);
      if (!rows.length) continue;
      const stats = [];
      for (const [sec, label] of [[60, '+1min'], [300, '+5min'], [900, '+15min']]) {
        for (const [field, fl] of [['maxRisePct', '峰'], ['lastPct', '末']]) {
          const vals = rows.map((r) => r.forwardReturns && r.forwardReturns.byHorizon[sec] ? r.forwardReturns.byHorizon[sec][field] : null).filter((v) => v !== null && v !== undefined);
          if (!vals.length) { stats.push(`${label}${fl} null`); continue; }
          const mean = vals.reduce((a, x) => a + x, 0) / vals.length;
          const sorted = [...vals].sort((a, x) => a - x);
          const med = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
          stats.push(`${label}${fl} ${fmt(mean, 1)}/${fmt(med, 1)}%（n=${vals.length}）`);
        }
      }
      const ep = rows.map((r) => r.trade && r.trade.episode && r.trade.episode.pnlBnb).filter((v) => typeof v === 'number');
      const epS = ep.length ? ` | 引擎 ep.pnl ${fmt(ep.reduce((a, x) => a + x, 0) / ep.length, 4)} 均（n=${ep.length}${ep.filter((v) => v > 0).length} 胜/${ep.filter((v) => v <= 0).length} 亏）` : '';
      console.log(`  ${k.padEnd(12)} n=${rows.length} | ${stats.join(' ')}${epS}`);
    }
  }
  const skipped = results.filter((r) => r.skipped).length;
  console.log(`\n${args.dry ? 'dry 组装' : '重析'}完成：${results.length} 行存档${skipped ? `（跳过 ${skipped}）` : ''}${failed ? `，异常 ${failed}` : ''}`);
  if (!args.dry && (failed || !results.length)) process.exit(1);
}

main().catch((e) => {
  console.error(`❌ ${e?.stack || e}`);
  process.exit(1);
});
