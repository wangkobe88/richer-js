#!/usr/bin/env node
/**
 * 作弊盘检测回归 runner（CD1，2026-10-30）——**182 跑**（本地 VPN 直连 Supabase 必
 * 超时=红线 9；本地可跑的只有 --list）。对拍流程与叙事 case-regression 同构，差异：
 *
 * 1. **as-of 锚截窗**：fixtures.anchor.tickCount 必填——按链上真序 (block_number,
 *    log_index) 取前 N 笔重放（绝不全史重析：事后知道是 rug 再看全程=马后炮污染对拍）；
 *    实际行数 < 锚=fail-loud（fixture 过期/数据缺，宁停不冒充）
 * 2. 与实时 CheatCheckService 同源 bit-identical：同 TICK_SELECT_COLUMNS → 同
 *    buildSnapshotFromRows → 同 buildCheatState → 同 JevClient → 同 mapper
 *    （cheat-snapshot/state-builder/mapper 是 CJS 纯函数，经 createRequire 复用）
 * 3. token meta 取 wss_events 最早 token_create 行（payload=collector info 本体：
 *    symbol/name/creator/blockTimeMs）；quoteToken 照 service 口径从 ticks 行尾扫
 *    （flap 非 BNB 计价盘行带 quote_token）
 * 4. jev_prompt 存档 data/prompts/<CD>-<版本>.txt（断代对拍唯一可回放证据）
 *
 * 用法：
 *   node scripts/cheat-detection/run.mjs --list
 *   node scripts/cheat-detection/run.mjs [--only CD1,CD2] [--dry]     # --dry=组装不烧 Jev
 *   node scripts/cheat-detection/run.mjs --add <addr> --case CD2 --note "…" [--observe]
 *                                       [--anchor N]                   # 缺省=收录时刻全量
 *   node scripts/cheat-detection/run.mjs --update-expect CD2 --because "CD<n> 裁定一句话"
 *   node scripts/cheat-detection/run.mjs --experiment <expId> [--settle-ms 4000] [--dry]
 *                                       # 实验基线：全部有成功买入的 token，锚=首笔成功买
 *                                       # created_at+settle 窗内 tick 数；表格+存档不写 fixtures
 * 退出码：0=全过 1=有失败 2=用法/校验错误（case-regression 同款）
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync } from 'fs';
import { createRequire } from 'module';
import {
  loadAndValidateFixtures, interpret, assertExpectation, buildCase, updateExpect, anchorCountAt,
} from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = resolve(HERE, 'fixtures.json');
const DATA_DIR = resolve(HERE, 'data');
const PROMPT_DIR = resolve(HERE, 'data', 'prompts');
const PULL_LIMIT = 3000; // 与 CheatCheckService 默认 pullLimit 一致（--add 全量帽）

const require_ = createRequire(import.meta.url);
// 与实时 service 同一组装路径（CJS 纯函数复用=口径单点）
const { buildSnapshotFromRows } = require_('../../src/market-analysis/cheat-snapshot.js');
const { buildCheatState } = require_('../../src/market-analysis/cheat-state-builder.js');
const { buildObservation } = require_('../../src/market-analysis/cheat-result-mapper.js');

const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';

function parseArgs(argv) {
  const args = { only: [], add: null, updateExpect: [], anchor: null, note: '', because: '', dry: false, observe: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') args.list = true;
    else if (a === '--only') args.only = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--add') args.add = String(argv[++i] || '');
    else if (a === '--case') args.caseId = String(argv[++i] || '');
    else if (a === '--note') args.note = String(argv[++i] || '');
    else if (a === '--because') args.because = String(argv[++i] || '');
    else if (a === '--anchor') args.anchor = Number(argv[++i]);
    else if (a === '--update-expect') args.updateExpect = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--experiment') args.experiment = String(argv[++i] || '');
    else if (a === '--settle-ms') args.settleMs = Number(argv[++i]);
    else if (a === '--dry' || a === '--observe') { if (a === '--dry') args.dry = true; else args.observe = true; }
    else { console.error(`未知参数: ${a}`); process.exit(2); }
  }
  return args;
}

function sb() {
  // 红线 3：wss_price_ticks/wss_events 一律 dbManager service key（anon 被 RLS 静默过滤成空）
  const { dbManager } = require_('../../src/services/dbManager.js');
  return dbManager.getClient();
}

/** 链上真序前 N 笔（锚截窗）；行数不足=fail-loud */
async function pullTicksToAnchor(token, n) {
  const { data, error } = await sb().from('wss_price_ticks')
    .select(TICK_COLS)
    .eq('token_address', token)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(n);
  if (error) throw new Error(`wss_price_ticks 查询失败: ${error.message}`);
  const rows = data ?? [];
  if (rows.length < n) {
    throw new Error(`锚截窗不足：锚=${n} 实际=${rows.length}（fixture 过期/数据缺——宁停不冒充）`);
  }
  return rows;
}

/** 现全量行数（--add 锚；超帽 capped） */
async function pullFull(token) {
  const { data, error } = await sb().from('wss_price_ticks')
    .select(TICK_COLS)
    .eq('token_address', token)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(PULL_LIMIT + 1);
  if (error) throw new Error(`wss_price_ticks 查询失败: ${error.message}`);
  const rows = data ?? [];
  const capped = rows.length > PULL_LIMIT;
  return { rows: capped ? rows.slice(0, PULL_LIMIT) : rows, capped, count: rows.length };
}

/** token meta：wss_events 最早 token_create（payload=collector info 本体） */
async function loadTokenMeta(token) {
  const { data, error } = await sb().from('wss_events')
    .select('platform,payload,block_time')
    .eq('kind', 'token_create')
    .eq('token_address', token)
    .order('id', { ascending: true })
    .limit(5);
  if (error) throw new Error(`wss_events 查询失败: ${error.message}`);
  const hit = (data ?? []).find((r) => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
  const p = hit ? hit.payload : {};
  const createdAt = p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : (hit ? hit.block_time : null);
  return {
    address: token,
    symbol: p.symbol || null,
    name: p.name || null,
    platform: hit ? hit.platform : null,
    createdAt,
    creatorAddress: p.creator || null,
    // D3.9 老鼠仓题原料：创建交易哈希（[TOKEN] createTx=，与 [TICKS] tx= 同域）
    createTxHash: p.txHash || p.tx_hash || null,
  };
}

function quoteTokenOf(rowsAsc) {
  for (let i = rowsAsc.length - 1; i >= 0; i--) {
    if (rowsAsc[i].quote_token) return rowsAsc[i].quote_token;
  }
  return null;
}

/** D3.9 观测行打印（现象档位+观察题+Jev 活跃度；无 verdict——判定层停产） */
function obsLine(interp) {
  if (!interp || !interp.phenomena) return '(无判读)';
  const p = interp.phenomena;
  const ext = (id) => (interp.extLevels && interp.extLevels[id] !== undefined ? interp.extLevels[id] : null);
  const act = interp.activityLevel ? interp.activityLevel.bucket : null;
  const bd = interp.bundledDominance ? interp.bundledDominance.bucket : null;
  return `eq=${p.equal_amount_split} sb=${p.coordinated_sell_back} cr=${p.creator_front_run} sd=${p.sell_dispersion} sbw=${ext('stall_burst_wave') ?? '-'} tier=${ext('amount_tiering') ?? '-'} bw=${ext('same_block_buy_wave') ?? '-'} rat=${ext('insider_supply_sell') ?? '-'} act=${act ?? '-'} bd=${bd ?? '-'}`;
}

/** 单 case 全链（锚截窗→快照→state→[Jev]→mapper 观测组装） */
async function runCase(c, { dry, version }) {
  const rows = await pullTicksToAnchor(c.addr.toLowerCase(), c.anchor.tickCount);
  const meta = { ...await loadTokenMeta(c.addr.toLowerCase()), quoteToken: quoteTokenOf(rows) };
  const snapshot = buildSnapshotFromRows(rows, meta, { capped: c.anchor.capped === true, anchorTickCount: c.anchor.tickCount });
  const { state, promptChars } = buildCheatState(snapshot);
  const d = snapshot.derived;
  console.log(`  锚=${snapshot.anchor.tickCount}${c.anchor.capped ? '(capped)' : ''} 笔 | 买 ${d.totalBuyBnb.toFixed(3)}/${d.buyN} 卖 ${d.totalSellBnb.toFixed(3)}/${d.sellN} | 钱包 ${d.walletCount} top1 ${d.top1BuyPct === null ? '-' : d.top1BuyPct.toFixed(1) + '%'} churn ${d.churn60sWalletCount} 同块簇 ${d.sameBlockClusters.length} 等额簇 ${d.equalClusters.length} sbHold ${d.sameBlockHoldPct === null ? '-' : d.sameBlockHoldPct.toFixed(1) + '%'} eqHold ${d.equalBandHoldPct === null ? '-' : d.equalBandHoldPct.toFixed(1) + '%'} act(代码)=${d.activityLevel ?? '-'}${d.activityUneven ? '~起伏' : ''} | state ${promptChars} chars`);
  if (dry) return { interp: null, promptChars, state, snapshot };
  const { JevClient } = await import('../../src/narrative/analyzer/llm/JevClient.mjs');
  const q = await import('../../src/market-analysis/llm/cheat-questions.mjs');
  const res = await JevClient.ask(state, q.buildCheatQuestions(), { timeoutMs: 30000, label: 'cheat-regression' });
  const obs = buildObservation(res.answers, { sameBlockHoldPct: d.sameBlockHoldPct, equalBandHoldPct: d.equalBandHoldPct });
  return { interp: interpret(obs), promptChars, state, snapshot, answers: res.answers, model: res.model };
}

function cmdList(cases) {
  console.log(`作弊盘回归集共 ${cases.length} 票：`);
  for (const c of cases) {
    const exp = [c.expect.verdict && `verdict=${c.expect.verdict}`,
      c.expect.cheatProbGte !== undefined && `P≥${c.expect.cheatProbGte}`,
      c.expect.patternsIncludes && `pattern∈[${c.expect.patternsIncludes.join('|')}]`].filter(Boolean).join(' ');
    const obs = c.observe ? ' [observe]' : '';
    const note = (c.note ?? '').slice(0, 40).replace(/\n/g, ' ');
    console.log(`  ${c.caseId.padEnd(5)} ${(c.symbol ?? '').padEnd(12).slice(0, 12)} @${c.anchor.tickCount}${c.anchor.capped ? '+' : ''} ${exp}${obs}  ${note}`);
  }
}

async function cmdAdd(args, doc, cases) {
  if (!args.caseId) { console.error('--add 必须带 --case <CDn>'); process.exit(2); }
  if (!args.note) { console.error('--add 必须带 --note（案由留痕）'); process.exit(2); }
  const addr = args.add.toLowerCase();
  if (cases.some((c) => c.addr === addr)) { console.error(`addr 已收录: ${addr}`); process.exit(2); }
  if (cases.some((c) => c.caseId === args.caseId)) { console.error(`caseId 已存在: ${args.caseId}`); process.exit(2); }
  const { rows, capped, count } = await pullFull(addr);
  if (!rows.length) { console.error('wss_price_ticks 无行（地址错/未采集）'); process.exit(2); }
  const anchorN = Number.isInteger(args.anchor) && args.anchor > 0 ? args.anchor : rows.length;
  console.log(`--add 锚=${anchorN}（现全量 ${count}${capped ? '，超帽截 3000' : ''}${Number.isInteger(args.anchor) && args.anchor > 0 ? '（--anchor 显式指定）' : '（收录时刻全量）'}）→ 分析一次记基线`);
  const meta = { ...await loadTokenMeta(addr), quoteToken: quoteTokenOf(rows) };
  const snapshot = buildSnapshotFromRows(
    anchorN === rows.length ? rows : rows.slice(0, anchorN),
    meta, { capped: capped && anchorN === rows.length, anchorTickCount: anchorN });
  const { state } = buildCheatState(snapshot);
  const { JevClient } = await import('../../src/narrative/analyzer/llm/JevClient.mjs');
  const q = await import('../../src/market-analysis/llm/cheat-questions.mjs');
  const res = await JevClient.ask(state, q.buildCheatQuestions(), { timeoutMs: 30000, label: 'cheat-regression-add' });
  const interp = interpret(buildObservation(res.answers, { sameBlockHoldPct: snapshot.derived.sameBlockHoldPct, equalBandHoldPct: snapshot.derived.equalBandHoldPct }));
  const today = new Date().toISOString().slice(0, 10);
  const c = buildCase({ caseId: args.caseId, symbol: meta.symbol ?? '', addr, platform: meta.platform, anchorTickCount: anchorN, capped: capped && anchorN === rows.length, interp, note: args.note, observe: args.observe, today });
  console.log('生成 case（请人工复核 expect——机器只记现状，断言意图必须人来定）：');
  console.log(JSON.stringify(c, null, 2));
  const nextDoc = { ...doc, cases: [...doc.cases, c] };
  const { errors } = loadAndValidateFixtures(nextDoc);
  if (errors.length) { console.error('写回前校验失败:\n' + errors.map((e) => `  - ${e}`).join('\n')); process.exit(1); }
  if (args.dry) { console.log('--dry：未写回 fixtures'); return; }
  writeFixturesSafely(nextDoc);
}

/** trades 表拉每 token 首笔成功买入（created_at 升序，Map 首见即最早）；红线 3=dbManager service key */
async function fetchFirstBuys(experimentId) {
  const { data, error } = await sb().from('trades')
    .select('token_address,token_symbol,created_at')
    .eq('experiment_id', experimentId)
    .eq('trade_direction', 'buy')
    .eq('success', true)
    .order('created_at', { ascending: true })
    .limit(1000);
  if (error) throw new Error(`trades 查询失败: ${error.message}`);
  const byToken = new Map();
  for (const r of data ?? []) {
    const addr = String(r.token_address || '').toLowerCase();
    if (!addr || !r.created_at) continue;
    if (!byToken.has(addr)) byToken.set(addr, { addr, symbol: r.token_symbol || '?', firstBuyAt: r.created_at });
  }
  return [...byToken.values()];
}

function digestOf(d) {
  return {
    totalBuyBnb: d.totalBuyBnb, totalSellBnb: d.totalSellBnb, buyN: d.buyN, sellN: d.sellN,
    walletCount: d.walletCount, top1BuyPct: d.top1BuyPct, top2BuyPct: d.top2BuyPct,
    routerPct: d.routerPct, unresolvedSenderTickCount: d.unresolvedSenderTickCount,
    churn60sWalletCount: d.churn60sWalletCount,
    sameBlockClusterCount: d.sameBlockClusters.length, equalClusterCount: d.equalClusters.length,
    sameBlockHoldPct: d.sameBlockHoldPct, equalBandHoldPct: d.equalBandHoldPct,
    ticksPerMin: d.ticksPerMin, avgTradeBnb: d.avgTradeBnb, maxGapSec: d.maxGapSec,
    activityLevel: d.activityLevel, activityCv: d.activityCv, activityUneven: d.activityUneven,
    famousHoldPct: d.famousHoldPct, famousTop1Pct: d.famousTop1Pct,
    famousFollowerPct: d.famousFollowerPct, famousDominancePct: d.famousDominancePct,
    famousDominanceLevel: d.famousDominanceLevel,
    priceArc: d.priceArc,
  };
}

/**
 * --experiment 基线：该实验全部有成功买入的 token，锚=首笔成功买 trade created_at + settle 窗
 * 内的链上真序 tick 行数（对齐实时 service settle 语义；回放无法重放落库延迟=链上时间近似，
 * 宁多勿少）。逐票真调 Jev → 表格 + 存档 + **全部收录 fixtures**（用户裁定 2026-10-30：基线票
 * 全进回归集；expect=判读现状快照，review 后 --update-expect 校准；已收录 addr 跳过）。
 */
async function cmdExperimentBaseline(args) {
  const settleMs = Number.isFinite(args.settleMs) && args.settleMs >= 0 ? args.settleMs : 4000;
  const targets = await fetchFirstBuys(args.experiment);
  if (!targets.length) { console.error(`实验 ${args.experiment} 无成功买入 trade`); process.exit(1); }
  const q = args.dry ? null : await import('../../src/market-analysis/llm/cheat-questions.mjs');
  const version = q ? q.CHEAT_QUESTIONS_VERSION : '(dry)';
  console.log(`实验 ${args.experiment}：${targets.length} 票有成功买入；锚=首笔成功买 created_at + ${settleMs}ms 内 tick 数${args.dry ? '；--dry 只组装不烧 Jev 不收录' : `；题集 ${version} 逐票真调 Jev → 表格 + 全部收录 fixtures`}\n`);

  const doc = JSON.parse(readFileSync(FIXTURES_PATH, 'utf8'));
  const { cases } = loadAndValidateFixtures(doc);
  const knownAddr = new Map(cases.map((c) => [c.addr, c.caseId]));
  let nextId = Math.max(...cases.map((c) => Number(c.caseId.slice(2)))) + 1;
  const today = new Date().toISOString().slice(0, 10);
  const newCases = [];
  const results = [];
  let hadError = false;

  console.log(['# ', 'symbol'.padEnd(12), 'plat'.padEnd(9), '锚'.padEnd(6), '买/卖'.padEnd(9), 'Σ买BNB'.padEnd(8), '钱包'.padEnd(6), 'top1%'.padEnd(7), 'churn'.padEnd(6), '同块'.padEnd(5), '等额'.padEnd(5), 'state'].join('')
    + (args.dry ? '' : '  → 现象观测（D3.12：eq/sb/cr/sd/sbw(现象二分 burst)/tier/bw/rat/bd/act）'));

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    let rowHead = `${String(i + 1).padEnd(2)} ${(t.symbol || '?').slice(0, 12).padEnd(12)}`;
    try {
      const { rows, capped: fullCapped } = await pullFull(t.addr);
      if (!rows.length) { console.log(`${rowHead} wss_price_ticks 无行，跳过`); continue; }
      const anchorAt = new Date(Date.parse(t.firstBuyAt) + settleMs).toISOString();
      const rawAnchor = anchorCountAt(rows, anchorAt);
      if (rawAnchor < 1) { console.log(`${rowHead} 锚=0（首买前无 tick=数据洞），跳过`); continue; }
      const capped = fullCapped && rawAnchor > PULL_LIMIT;
      const anchorN = Math.min(rawAnchor, PULL_LIMIT);
      const window = rows.slice(0, anchorN);
      const meta = { ...await loadTokenMeta(t.addr), quoteToken: quoteTokenOf(window) };
      const snapshot = buildSnapshotFromRows(window, meta, { capped, anchorTickCount: anchorN });
      const { state, promptChars } = buildCheatState(snapshot);
      const d = snapshot.derived;
      rowHead = [
        String(i + 1).padEnd(2), (t.symbol || '?').slice(0, 12).padEnd(12), String(meta.platform || '-').padEnd(9),
        String(anchorN + (capped ? '+' : '')).padEnd(6), `${d.buyN}/${d.sellN}`.padEnd(9),
        d.totalBuyBnb.toFixed(2).padEnd(8), String(d.walletCount).padEnd(6),
        (d.top1BuyPct === null ? '-' : d.top1BuyPct.toFixed(1)).padEnd(7), String(d.churn60sWalletCount).padEnd(6),
        String(d.sameBlockClusters.length).padEnd(5), String(d.equalClusters.length).padEnd(5), String(promptChars),
      ].join('');
      const base = { addr: t.addr, symbol: t.symbol, platform: meta.platform, firstBuyAt: t.firstBuyAt, anchorTickCount: anchorN, capped, digest: digestOf(d) };

      if (window.length < 8) {
        console.log(`${rowHead}  → skipped_insufficient_ticks（<8 不调 Jev）`);
        results.push({ ...base, minTicksSkipped: true });
        continue;
      }
      if (args.dry) { console.log(`${rowHead}  → (dry 未烧 Jev)`); results.push({ ...base, dry: true }); continue; }

      const { JevClient } = await import('../../src/narrative/analyzer/llm/JevClient.mjs');
      const res = await JevClient.ask(state, q.buildCheatQuestions(), { timeoutMs: 30000, label: 'cheat-experiment-baseline' });
      const interp = interpret(buildObservation(res.answers, { sameBlockHoldPct: d.sameBlockHoldPct, equalBandHoldPct: d.equalBandHoldPct }));
      console.log(`${rowHead}  → ${obsLine(interp)}  sbHold=${d.sameBlockHoldPct ?? '-'}% eqHold=${d.equalBandHoldPct ?? '-'}% act(代码)=${d.activityLevel ?? '-'}${d.activityUneven ? '~起伏' : ''}`);
      results.push({ ...base, interp, promptChars, answersRaw: res.answers, anchors: { sameBlockHoldPct: d.sameBlockHoldPct, equalBandHoldPct: d.equalBandHoldPct }, activity: { ticksPerMin: d.ticksPerMin, avgTradeBnb: d.avgTradeBnb, maxGapSec: d.maxGapSec, level: d.activityLevel, cv: d.activityCv, uneven: d.activityUneven }, model: res.model });

      const known = knownAddr.get(t.addr);
      if (known) { console.log(`     已收录=${known}，跳过`); continue; }
      const note = `aed2091d 首买基线收录（锚=${anchorN}=首笔成功买+settle${settleMs}ms；买${d.buyN}/卖${d.sellN} Σ买${d.totalBuyBnb.toFixed(2)}BNB 钱包${d.walletCount} top1=${d.top1BuyPct === null ? '-' : d.top1BuyPct.toFixed(1) + '%'} churn${d.churn60sWalletCount} 同块簇${d.sameBlockClusters.length} 等额簇${d.equalClusters.length}）；expect=判读现状待 review`;
      const c = buildCase({ caseId: `CD${nextId}`, symbol: t.symbol || '', addr: t.addr, platform: meta.platform, anchorTickCount: anchorN, capped, interp, note, today });
      newCases.push(c);
      knownAddr.set(t.addr, c.caseId);
      nextId++;
      console.log(`     收录=${c.caseId}`);
    } catch (e) {
      hadError = true;
      console.error(`${rowHead} ❌ ${e.message}`);
      results.push({ addr: t.addr, symbol: t.symbol, error: e.message });
    }
  }

  mkdirSync(DATA_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const archPath = resolve(DATA_DIR, `cd-baseline-${args.experiment.slice(0, 8)}-${ts}.json`);
  writeFileSync(archPath, JSON.stringify({ ranAt: new Date().toISOString(), experimentId: args.experiment, settleMs, questionVersion: version, dry: args.dry, results }, null, 2), 'utf8');
  const dist = {};
  for (const r of results) {
    // D3.5 分布键=Jev 活跃度档（判定层停产无 verdict 可分布）
    const k = r.error ? 'error' : (r.interp ? (r.interp.activityLevel ? r.interp.activityLevel.bucket : 'act缺失') : (r.minTicksSkipped ? 'skipped_minTicks' : 'dry'));
    dist[k] = (dist[k] || 0) + 1;
  }
  console.log(`\n活跃度档分布：${Object.entries(dist).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  const bdDist = {}; // D3.8 捆绑主导度档（判定层停产——档位即分布键）
  for (const r of results) {
    if (!r.interp) continue;
    const k = r.interp.bundledDominance ? r.interp.bundledDominance.bucket : 'bd缺失';
    bdDist[k] = (bdDist[k] || 0) + 1;
  }
  console.log(`捆绑主导度档分布：${Object.entries(bdDist).map(([k, v]) => `${k}=${v}`).join(' ') || '（无）'}`);
  console.log(`基线存档：${archPath}`);

  if (newCases.length && !args.dry) {
    const nextDoc = { ...doc, cases: [...doc.cases, ...newCases] };
    const { errors } = loadAndValidateFixtures(nextDoc);
    if (errors.length) { console.error('fixtures 写回前校验失败（不写回）:\n' + errors.map((e2) => `  - ${e2}`).join('\n')); process.exit(1); }
    writeFixturesSafely(nextDoc);
    console.log(`已收录 ${newCases.length} 票（${newCases[0].caseId}…${newCases[newCases.length - 1].caseId}）——expect=判读现状，review 后 --update-expect --because 校准`);
  } else if (!args.dry) {
    console.log('无新收录（全部已收录/跳过）');
  }
  if (hadError) process.exit(1);
}

function writeFixturesSafely(doc) {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FIXTURES_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  renameSync(tmp, FIXTURES_PATH);
  console.log(`fixtures 已写回 ${FIXTURES_PATH}`);
}

/**
 * 从最近 run/baseline 存档取某 case 现行判读（--update-expect 不重烧 Jev，以已跑结果为准）。
 * 两种存档行形状不同：cd-run-* 行带 caseId；cd-baseline-* 行只带 addr（--experiment 模式收录前无名）。
 * 排序按文件名内嵌 ISO 时戳——前缀不同（run/baseline）字典序≠时间序。
 */
function latestArchivedInterp(caseId, addr) {
  let names;
  try {
    names = readdirSync(DATA_DIR)
      .filter((f) => /^cd-(run|baseline)-.*\.json$/.test(f))
      .map((f) => {
        const m = f.match(/(20\d{2}-\d{2}-\d{2}T[\d-]+Z)/);
        return { f, ts: m ? m[1] : '' };
      })
      .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
      .map((x) => x.f);
  } catch (_) {
    return null; // data/ 尚无存档
  }
  const want = String(addr || '').toLowerCase();
  for (let i = names.length - 1; i >= 0; i--) {
    try {
      const doc = JSON.parse(readFileSync(resolve(DATA_DIR, names[i]), 'utf8'));
      const hit = (doc.results || []).find((r) => (r.caseId === caseId
        || (want && String(r.addr || '').toLowerCase() === want)) && r.interp && !r.error);
      if (hit) return hit.interp;
    } catch (_) { /* 撕裂/坏档跳过取更旧 */ }
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const doc = JSON.parse(readFileSync(FIXTURES_PATH, 'utf8'));
  const { cases, errors } = loadAndValidateFixtures(doc);
  if (errors.length) { console.error('fixtures 校验失败:\n' + errors.map((e) => `  - ${e}`).join('\n')); process.exit(2); }

  if (args.list) { cmdList(cases); return; }
  if (args.add) { await cmdAdd(args, doc, cases); return; }
  if (args.experiment) { await cmdExperimentBaseline(args); return; }

  if (args.updateExpect.length) {
    if (!args.because) { console.error('--update-expect 必须带 --because "<CD 编号> <裁定一句话>"'); process.exit(2); }
    const today = new Date().toISOString().slice(0, 10);
    let changed = false;
    for (const id of args.updateExpect) {
      const idx = cases.findIndex((x) => x.caseId === id);
      if (idx < 0) { console.error(`caseId 不存在: ${id}`); process.exit(2); }
      const interp = latestArchivedInterp(id);
      if (!interp) { console.error(`${id} 无 run 存档判读——先跑一次 --only ${id} 再更新（不重烧 Jev，以已跑结果为准）`); process.exit(1); }
      const next = updateExpect(cases[idx], interp, args.because, today);
      console.log(`${id}: expect 留痕更新（D3.5 机器不写 verdict——expect.verdict 人工改写：${JSON.stringify(cases[idx].expect.verdict)}）  because=${args.because}`);
      cases[idx] = next;
      changed = true;
    }
    if (changed && !args.dry) writeFixturesSafely({ ...doc, cases });
    else if (changed) console.log('--dry：未写回 fixtures');
    return;
  }

  const qMod = args.dry ? null : await import('../../src/market-analysis/llm/cheat-questions.mjs');
  const version = qMod ? qMod.CHEAT_QUESTIONS_VERSION : '(dry)';
  const targets = args.only.length ? cases.filter((c) => args.only.includes(c.caseId)) : cases;
  const missing = args.only.filter((id) => !cases.some((c) => c.caseId === id));
  if (missing.length) { console.error(`caseId 不存在: ${missing.join(',')}`); process.exit(2); }

  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(PROMPT_DIR, { recursive: true });
  const results = [];
  let failed = 0;
  for (const c of targets) {
    console.log(`\n▶ ${c.caseId} ${c.symbol} ${c.addr} @${c.anchor.tickCount}${c.anchor.capped ? '+' : ''}`);
    try {
      const r = await runCase(c, { dry: args.dry, version });
      if (args.dry) { console.log(`  --dry：state 已组装（${r.promptChars} chars），未烧 Jev`); continue; }
      writeFileSync(resolve(PROMPT_DIR, `${c.caseId}-${version}.txt`), r.state, 'utf8');
      const { failures } = assertExpectation(r.interp, c.expect);
      const pass = !failures.length;
      if (!pass) failed++;
      // D3.5 对拍停产：expect.verdict=人工裁定记录，展示不比对（观测行=机器输出）
      console.log(`  ${pass ? '✅ PASS' : '❌ FAIL'} ${obsLine(r.interp)} sbHold=${r.interp.anchors?.sameBlockHoldPct ?? '-'} eqHold=${r.interp.anchors?.equalBandHoldPct ?? '-'} dom=${r.snapshot.derived.famousDominanceLevel ?? '-'}${r.snapshot.derived.famousDominancePct !== null && r.snapshot.derived.famousDominancePct !== undefined ? `(${r.snapshot.derived.famousDominancePct}%)` : ''} ｜人工裁定=${c.expect.verdict ?? '（未裁定）'}（判定层停产——展示不比对）`);
      results.push({ caseId: c.caseId, addr: c.addr, anchor: c.anchor, questionVersion: version, interp: r.interp, pass, failures, promptChars: r.promptChars, answersRaw: r.answers, anchors: { sameBlockHoldPct: r.snapshot.derived.sameBlockHoldPct, equalBandHoldPct: r.snapshot.derived.equalBandHoldPct }, activity: { ticksPerMin: r.snapshot.derived.ticksPerMin, avgTradeBnb: r.snapshot.derived.avgTradeBnb, maxGapSec: r.snapshot.derived.maxGapSec, level: r.snapshot.derived.activityLevel, cv: r.snapshot.derived.activityCv, uneven: r.snapshot.derived.activityUneven }, famous: { holdPct: r.snapshot.derived.famousHoldPct, top1Pct: r.snapshot.derived.famousTop1Pct, followerPct: r.snapshot.derived.famousFollowerPct, dominancePct: r.snapshot.derived.famousDominancePct, level: r.snapshot.derived.famousDominanceLevel }, model: r.model });
    } catch (e) {
      failed++;
      console.error(`  ❌ 异常: ${e.message}`);
      results.push({ caseId: c.caseId, addr: c.addr, anchor: c.anchor, questionVersion: version, error: e.message, pass: false });
    }
  }
  if (results.length) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(resolve(DATA_DIR, `cd-run-${ts}.json`), JSON.stringify({ ranAt: new Date().toISOString(), questionVersion: version, dry: args.dry, results }, null, 2), 'utf8');
  }
  console.log(`\n${args.dry ? 'dry 组装' : '重析观测'}完成：${results.length} 票存档${failed ? `，异常 ${failed}` : ''}（D3.5 判定层停产——PASS=链路跑通，无 verdict 对拍）`);
  if (!args.dry && (failed || !results.length)) process.exit(1);
}

main().catch((e) => {
  console.error(`❌ ${e?.stack || e}`);
  process.exit(1);
});
