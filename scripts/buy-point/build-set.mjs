#!/usr/bin/env node
/**
 * 买入点位分析测试集构建（BP1，2026-11-03；BP3 trades 源 2026-11-05）——**182 跑**
 * （本地 VPN 直连 Supabase 必超时=红线 9）。红线 3：全程 dbManager service key。
 *
 * 采样口径（2026-11-05 用户裁定）：**trades 源（默认）**=最近 3 个 live 实验的全部
 * 成交买点（trades 成功 buy 行，不去重——「所有的交易点位」），**当前已 cheat/
 * unhealthy 的 token 不收录**（cheat_detection 最新判定 grade 剔除；healthy/无判定
 * 放行）。旧口径 signals 源（BUY 信号+60s 去重）以 --source signals 留档可复现。
 * 结局观测（前向收益 + episode 盈亏）构建期预计算随 set 落盘（run.mjs 带出对拍）。
 *
 * 产物：
 *   sets/<name>.json            —— 点位清单+锚+结局（进 git）
 *   sets/<name>-ticks/<token>.json —— per token ticks 全窗（tmp+rename 原子写；不进 git）
 *
 * 用法：
 *   node scripts/buy-point/build-set.mjs --name bp-2026-11-05-live3-trades
 *       [--source trades|signals]  # 缺省 trades（成交买点）；signals=旧 BUY 信号口径
 *       [--exps <id,...>]      # 覆盖缺省「最近 N 个 live」
 *       [--live-exp-count 3]   # 缺省取最近 3 个 live 实验（trades 源裁定值）
 *       [--dedupe-sec N]       # 同 token 去重窗（秒）；trades 缺省 0=不去重，signals 缺省 60
 *       [--horizon-min 15]     # ticks 拉取窗盖到「最晚点位+N 分钟」（≥前向 horizon 900s）
 *       [--limit-exp 5000]     # per 实验点位拉取帽（超=fail-loud，不静默截断）
 *       [--legs-lib <name|none>] # ladder 挖掘库条目（缺省 signal-source-ladder-v1；
 *                                #   per (token,leg) 首触发=额外点位 source=ladder；none=关）
 * 退出码：0=成功 1=失败 2=用法错误
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'fs';
import { createRequire } from 'module';
import { dedupeBuySignals, anchorCountAt, computeForwardReturns, buildEpisodes, episodePnlBnb, quoteTokenOf, buildTradePoints, filterByCheatGrades, FWD_HORIZONS_SEC } from './lib.mjs';
import { mineLadderPoints } from './mine-ladder.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SETS_DIR = resolve(HERE, 'sets');

const require_ = createRequire(import.meta.url);

const TICK_COLS = 'id,block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token,token_address';
const TICK_PAGE = 4000;   // id 水位翻页页大小（mcap-floor-sell-replay 同款）
const TICK_PAGES_MAX = 15; // 6 万行帽（超=capped，宁截声明不静默）
const CHEAT_IN_BATCH = 25; // .in() 批上限（红线 5：URL 8KB；25×~30 行/批 < PostgREST max-rows 1000）
const PAGE_ROWS = 1000;   // 点位源翻页页大小（对齐 PostgREST max-rows=1000，翻满即有下一页）

function parseArgs(argv) {
  const args = { name: '', source: 'trades', exps: [], liveExpCount: 3, dedupeSec: null, horizonMin: 15, limitExp: 5000, legsLib: 'signal-source-ladder-v1', excludeLegs: '', keepCheat: false, tickTimeFromMeta: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name') args.name = String(argv[++i] || '');
    else if (a === '--source') args.source = String(argv[++i] || '');
    else if (a === '--keep-cheat') args.keepCheat = true;
    else if (a === '--tick-time-from-meta') args.tickTimeFromMeta = true;
    else if (a === '--exps') args.exps = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--live-exp-count') args.liveExpCount = Number(argv[++i]);
    else if (a === '--dedupe-sec') args.dedupeSec = Number(argv[++i]);
    else if (a === '--horizon-min') args.horizonMin = Number(argv[++i]);
    else if (a === '--limit-exp') args.limitExp = Number(argv[++i]);
    else if (a === '--legs-lib') args.legsLib = String(argv[++i] || '');
    else if (a === '--exclude-legs') args.excludeLegs = String(argv[++i] || '');
    else { console.error(`未知参数: ${a}`); process.exit(2); }
  }
  args.excludeLegSet = new Set(args.excludeLegs.split(',').map((s) => s.trim()).filter(Boolean));
  if (!args.name) { console.error('用法: build-set.mjs --name <set> [--source trades|signals] [--exps id,...] [--live-exp-count 3] [--dedupe-sec N] [--horizon-min 15] [--legs-lib <name|none>] [--exclude-legs 腿名1,腿名2] [--keep-cheat] [--tick-time-from-meta]'); process.exit(2); }
  if (args.source !== 'trades' && args.source !== 'signals') { console.error('--source 须 trades|signals'); process.exit(2); }
  if (args.dedupeSec === null) args.dedupeSec = args.source === 'trades' ? 0 : 60;
  if (!Number.isInteger(args.dedupeSec) || args.dedupeSec < 0) { console.error('--dedupe-sec 须为 ≥0 整数（0=不去重）'); process.exit(2); }
  if (!Number.isInteger(args.liveExpCount) || args.liveExpCount < 1) { console.error('--live-exp-count 须为正整数'); process.exit(2); }
  if (!Number.isFinite(args.horizonMin) || args.horizonMin < 15) { console.error('--horizon-min ≥15（前向 horizon 900s 须被 ticks 窗盖住）'); process.exit(2); }
  return args;
}

function sb() {
  const { dbManager } = require_('../../src/services/dbManager.js');
  return dbManager.getClient();
}

/** 最近 N 个 live 实验（created_at 降序取，再反转为升序展示） */
async function loadLiveExperiments(limitExpCount, explicitIds) {
  if (explicitIds.length) {
    const { data, error } = await sb().from('experiments').select('id,experiment_name,created_at').in('id', explicitIds);
    if (error) throw new Error(`experiments 查询失败: ${error.message}`);
    const missing = explicitIds.filter((id) => !(data ?? []).some((e) => e.id === id));
    if (missing.length) { console.error(`实验不存在: ${missing.join(',')}`); process.exit(2); }
    return (data ?? []).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }
  const { data, error } = await sb().from('experiments')
    .select('id,experiment_name,created_at')
    .eq('trading_mode', 'live')
    .order('created_at', { ascending: false })
    .limit(limitExpCount);
  if (error) throw new Error(`experiments 查询失败: ${error.message}`);
  return (data ?? []).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

/** 通用分页拉全（PostgREST 服务端 max-rows=1000 静默截断防线：v73 实测 BUY 信号 1673 条被单查 limit 截成 1000 无报错；
 * .range 翻页 + (created_at,id) 双键稳定排序防同时间戳行跨页滑动；每翻满一页查帽 fail-loud） */
async function fetchAllPaged(table, select, filters, limitExp, label) {
  const rows = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    let q = sb().from(table).select(select)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_ROWS - 1);
    for (const [col, val] of Object.entries(filters)) q = q.eq(col, val);
    const { data, error } = await q;
    if (error) throw new Error(`${table} 查询失败(${label}): ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_ROWS) break;
    if (rows.length > limitExp) { console.error(`${label} 超 ${limitExp} 帽（已拉 ${rows.length}+）——--limit-exp 放宽或收窄实验`); process.exit(1); }
  }
  return rows;
}

/** per 实验 BUY 信号（分页拉全；metadata 只取 price/strategyName 两字段防 set 膨胀） */
async function loadBuySignals(expId, limitExp) {
  const rows = await fetchAllPaged('strategy_signals', 'id,token_address,token_symbol,created_at,metadata',
    { experiment_id: expId, signal_type: 'BUY' }, limitExp, `实验 ${expId} BUY 信号`);
  return rows.map((r) => {
    const md = r.metadata || {};
    return {
      id: r.id, token_address: r.token_address, token_symbol: r.token_symbol || null,
      created_at: r.created_at, experiment_id: expId,
      signalInfo: { price: typeof md.price === 'number' ? md.price : null, strategyName: md.strategyName || null },
    };
  });
}

/** per 实验成交买点（trades 源）：成功 buy 行 → buildTradePoints 点位（不去重=「所有交易点位」） */
async function loadBuyTrades(expId, limitExp) {
  const rows = await fetchAllPaged('trades', 'id,token_address,input_currency,input_amount,output_amount,executed_at,created_at,signal_id',
    { experiment_id: expId, trade_direction: 'buy', success: true }, limitExp, `实验 ${expId} 成交买点`);
  return buildTradePoints(rows, expId);
}

/**
 * 回测时间轴适配（--tick-time-from-meta，2026-11-11 bt-v103 第二轮复盘立）：回测实验
 * 的 trades/signals.created_at=**回放进程墙钟**（回测引擎按链上 tick 单调回放但落库时刻
 * 是墙钟），而 ticks/锚/前向收益全在链上时间轴——两轴断裂使锚=全窗、fwd 恒 null、
 * ticks 窗末拉到 6 天后（85/85 全截断实测）。
 *
 * 修法：买点链上时刻 = signal metadata.tokenCreateTime + buyPoint.anchors.tokenAgeSec
 * （FA age 口径=链上轴，signalId→signal 行批查）。打 anchorTimeIso 补丁；无 buyPoint
 * （legacy 腿无 BP 门）或 age 缺失 → 回退 created_at 并计数（fail-open 不拒收）。
 *
 * 锚行数精确化（2026-11-14 bt-v111 复审立）：tokenAgeSec 为整数秒（floor），回构锚比
 * fire tick 的 block_time 早 ≤1s——anchorCountAt 的 `block_time≤锚` 行计数会把 fire tick
 * 本行排除；断流 gap / 快拉段票该行价差巨大（btv111 实测 34/91 curVs 漂 >5pp，T007 跨
 * 11s gap 差 15pp、T001 差 21pp 反向）。修法=直接采生产 metadata.buyPoint.anchors.
 * actTickCount（fire 窗精确行数）为 anchorTickHint，主循环有 hint 且 ≤rows.length 时
 * 用 hint 当锚（与生产窗 bit 对齐）；hint>rows.length=回放缓存与 DB 行缺失异常，loud warn
 * 回退时间计数。
 */
async function patchTickTimeAxis(points) {
  const sigIds = [...new Set(points.map((p) => p.signalId).filter(Boolean))];
  const metaById = new Map();
  for (let i = 0; i < sigIds.length; i += 100) {
    const { data, error } = await sb().from('strategy_signals')
      .select('id,metadata').in('id', sigIds.slice(i, i + 100));
    if (error) throw new Error(`signal 批查失败（tick-time-from-meta）: ${error.message}`);
    for (const s of data ?? []) metaById.set(s.id, s.metadata || {});
  }
  let patched = 0, hint = 0, fallback = 0, noSig = 0;
  for (const p of points) {
    const md = p.signalId ? metaById.get(p.signalId) : null;
    // tokenCreateTime 双形状：Unix 秒时间戳（number，如 1793868979.361）或 ISO 串
    const rawCreate = md ? md.tokenCreateTime : null;
    const tokCreateMs = typeof rawCreate === 'number' && Number.isFinite(rawCreate) ? rawCreate * 1000
      : typeof rawCreate === 'string' && rawCreate ? Date.parse(rawCreate) : NaN;
    const anchors = md && md.buyPoint && md.buyPoint.anchors ? md.buyPoint.anchors : null;
    const age = anchors ? anchors.tokenAgeSec : null;
    if (Number.isFinite(tokCreateMs) && age != null && Number.isFinite(Number(age))) {
      p.anchorTimeIso = new Date(tokCreateMs + Number(age) * 1000).toISOString();
      patched++;
    } else if (!p.signalId) { p.anchorTimeIso = p.created_at; noSig++; }
    else { p.anchorTimeIso = p.created_at; fallback++; }
    // 锚行数 hint：生产 fire 窗精确行数（actTickCount）——优先于时间计数（见函数头注释）
    const atc = anchors ? anchors.actTickCount : null;
    if (Number.isInteger(atc) && atc >= 0) { p.anchorTickHint = atc; hint++; }
  }
  console.log(`tick 时间轴补丁（--tick-time-from-meta）: 时刻补 ${patched} / 锚行数 hint ${hint} / 回退（无 buyPoint/age）${fallback} / 无 signalId ${noSig}`);
  return points;
}

/**
 * cheat/unhealthy 判定图（2026-11-05 用户裁定「当前已 cheat/unhealthy 不收录」）：
 * cheat_detection 最新带 grade 行（grade 在 snapshot_digest jsonb 内非独立列——
 * _bootstrapHistory 同款形状）；is_valid=true；批 25 token（25×~30 行/批 < PostgREST
 * max-rows 1000 帽；order desc 首见=最新，截断只丢旧行不影响最新判定）。
 * @returns {Promise<Map<string,string>>} token(小写) → 'cheat'|'unhealthy'|'healthy'
 */
async function loadCheatGrades(tokens) {
  const latest = new Map(); // token -> {grade, analyzedAt}
  const list = [...tokens];
  for (let i = 0; i < list.length; i += CHEAT_IN_BATCH) {
    const batch = list.slice(i, i + CHEAT_IN_BATCH);
    const { data, error } = await sb().from('cheat_detection')
      .select('token_address,analyzed_at,snapshot_digest')
      .eq('is_valid', true)
      .in('token_address', batch)
      .order('analyzed_at', { ascending: false })
      .limit(1000);
    if (error) throw new Error(`cheat_detection 查询失败: ${error.message}`);
    const rows = data ?? [];
    if (rows.length >= 1000) console.warn(`⚠ cheat_detection 批 ${i / CHEAT_IN_BATCH} 满 1000 行帽（截断只影响旧行）`);
    for (const r of rows) {
      const k = String(r.token_address || '').toLowerCase();
      const g = r.snapshot_digest && r.snapshot_digest.grade ? String(r.snapshot_digest.grade) : null;
      if (!k || !g) continue;
      if (!latest.has(k)) latest.set(k, { grade: g, analyzedAt: r.analyzed_at }); // desc 首见=最新
    }
  }
  const gradeMap = new Map();
  for (const [k, v] of latest) gradeMap.set(k, v.grade);
  return gradeMap;
}

/** ladder 库条目 legs（挖掘条件真相源=库快照，改库后重建 set 自动跟进）。
 *  库条目腿无 id/name（引擎 config→strategy 映射时生成 `buy_${idx}_${priority}`——
 *  挖掘腿标识从 priority 派生 `t${priority}`，与 deploy 命名 t1-t7 对齐） */
async function loadLadderLegs(name) {
  const { data, error } = await sb().from('strategy_library')
    .select('id,name,version,legs')
    .eq('name', name)
    .maybeSingle();
  if (error) throw new Error(`strategy_library 查询失败: ${error.message}`);
  if (!data) throw new Error(`strategy_library 无条目 ${name}（--legs-lib 指定或先部署）`);
  const rawLegs = Array.isArray(data.legs) ? data.legs : [];
  const legs = rawLegs.map((l, idx) => {
    if (!l || !l.condition) throw new Error(`库条目 ${name} 腿形状非法（condition 缺）`);
    const priority = Number.isFinite(Number(l.priority)) ? Number(l.priority) : idx;
    return { id: l.id || `t${priority}`, priority, condition: l.condition, description: l.description || null };
  });
  return { libId: data.id, libName: data.name, libVersion: data.version, legs };
}

/** token meta：wss_events 最早 token_create（cheat run.mjs loadTokenMeta 同款口径） */
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
    createTxHash: p.txHash || p.tx_hash || null,
    totalSupply: p.totalSupply ?? ((hit && (hit.platform === 'flap' || hit.platform === 'gang')) ? 1e9 : null),
  };
}

/**
 * per token ticks 全窗：[start, end] block_time 区间 + id 水位翻页（mcap replay 同款，
 * 页内超 4000×15=6 万行截断 capped）；末按链上真序 (block_number,log_index) 排序
 */
async function pullTicksWindow(token, startIso, endIso) {
  const rows = [];
  let anchorId = 0;
  for (let page = 0; page < TICK_PAGES_MAX; page++) {
    const q = sb().from('wss_price_ticks').select(TICK_COLS)
      .eq('token_address', token)
      .gte('block_time', startIso)
      .lte('block_time', endIso)
      .gt('id', anchorId)
      .order('id', { ascending: true })
      .limit(TICK_PAGE);
    const { data, error } = await q;
    if (error) throw new Error(`wss_price_ticks 查询失败(${token}): ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < TICK_PAGE) return { rows: chainOrder(rows), capped: false, pulled: rows.length };
    anchorId = data[data.length - 1].id;
  }
  return { rows: chainOrder(rows), capped: true, pulled: rows.length }; // 满 15 页仍有余——截断声明（snapshot capped 同源）
}

/** 链上真序归并（bigserial 分配序≠提交序——红线：sort(id)=前视） */
function chainOrder(rows) {
  return [...rows].sort((a, b) => Number(a.block_number) - Number(b.block_number) || Number(a.log_index) - Number(b.log_index));
}

/** per (exp, token) trades：成功子集→episodes；signal_id 匹配买腿（结局对拍） */
async function loadTradeJoin(expId, token) {
  const { data, error } = await sb().from('trades')
    .select('id,trade_direction,success,input_amount,output_amount,created_at,executed_at,signal_id')
    .eq('experiment_id', expId)
    .eq('token_address', token)
    .order('created_at', { ascending: true })
    .limit(2001);
  if (error) throw new Error(`trades 查询失败(${expId}/${token}): ${error.message}`);
  if ((data ?? []).length > 2000) { console.error(`trades 超 2000 帽(${expId}/${token})——单 token 单实验不应到这个量级`); process.exit(1); }
  const all = data ?? [];
  const ok = all.filter((t) => t.success);
  const ts = (t) => Date.parse(t.executed_at || t.created_at);
  ok.sort((a, b) => ts(a) - ts(b) || String(a.id).localeCompare(String(b.id)));
  const episodes = buildEpisodes(ok);
  const epOfTrade = new Map(); // tradeId -> episode 引用（episode 内盈亏一体）
  for (const ep of episodes) for (const t of ep.trades) epOfTrade.set(String(t.id), ep);
  return { all, episodes, epOfTrade };
}

function atomicJson(path, obj) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj), 'utf8');
  renameSync(tmp, path);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const builtAt = new Date().toISOString();
  console.log(`构建买入点位测试集: ${args.name}（源=${args.source} / 去重窗 ${args.dedupeSec}s / ticks 窗盖至最晚点位+${args.horizonMin}min / 前向 horizon ${FWD_HORIZONS_SEC.join(',')}s / ladder 挖掘=${args.legsLib}）`);

  const exps = await loadLiveExperiments(args.liveExpCount, args.exps);
  if (!exps.length) { console.error('无 live 实验（--exps 显式指定）'); process.exit(2); }
  console.log(`\n实验集（${exps.length} 个）:`);
  for (const e of exps) console.log(`  ${e.id} ${e.experiment_name || ''} ${e.created_at}`);

  // 1) 点位源汇总（trades=成交买点 / signals=BUY 信号）→ 腿剔除（--exclude-legs，按 signalInfo.strategyName 精确匹配）→ cheat/unhealthy 剔除 → 去重
  const raw = [];
  for (const e of exps) {
    let pts = args.source === 'trades'
      ? await loadBuyTrades(e.id, args.limitExp)
      : await loadBuySignals(e.id, args.limitExp);
    if (args.excludeLegSet.size) {
      const before = pts.length;
      pts = pts.filter((p) => !args.excludeLegSet.has((p.signalInfo && p.signalInfo.strategyName) || ''));
      console.log(`  剔除腿 [${[...args.excludeLegSet].join('、')}]：${before} → ${pts.length}`);
    }
    console.log(`  ${args.source === 'trades' ? '成交买点' : 'BUY 信号'} ${e.id}: ${pts.length} 条`);
    if (args.tickTimeFromMeta && args.source === 'trades') await patchTickTimeAxis(pts);
    raw.push(...pts);
  }
  const allTokens = new Set(raw.map((s) => String(s.token_address).toLowerCase()));
  const gradeMap = await loadCheatGrades(allTokens);
  const gradeTally = new Map();
  for (const g of gradeMap.values()) gradeTally.set(g, (gradeTally.get(g) || 0) + 1);
  console.log(`cheat 判定图: ${gradeMap.size}/${allTokens.size} token（${[...gradeTally].map(([g, n]) => `${g}=${n}`).join(' ') || '无判定'}）`);
  const { kept: keptAfterCheat, excluded } = args.keepCheat
    ? { kept: raw, excluded: [] } // --keep-cheat：保留 cheat/unhealthy 票（复盘视角=grade 本身是认知材料；判定图照打）
    : filterByCheatGrades(raw, gradeMap);
  const kept = args.dedupeSec > 0 ? dedupeBuySignals(keptAfterCheat, args.dedupeSec) : keptAfterCheat;
  const nameOf = new Map(exps.map((e) => [e.id, e.experiment_name || e.id]));
  console.log(`\n${args.source === 'trades' ? '成交买点' : 'BUY 信号'} ${raw.length} 条 → ${args.keepCheat ? '保留全部（--keep-cheat，不剔 cheat/unhealthy）' : `cheat/unhealthy 剔除 ${excluded.length} 点位（${new Set(excluded.map((x) => x.token)).size} token）`} → 去重（同 token ${args.dedupeSec}s 窗取首）→ ${kept.length} 点位，涉及 token ${new Set(kept.map((s) => String(s.token_address).toLowerCase())).size} 个`);

  // ladder 库条目（挖掘条件真相源）
  let ladder = null;
  if (args.legsLib !== 'none') {
    ladder = await loadLadderLegs(args.legsLib);
    console.log(`ladder 挖掘源: ${ladder.libName} v${ladder.libVersion}（${ladder.legs.length} 腿）`);
  }

  // 2) per token：meta + ticks 窗 + 落盘
  const byToken = new Map();
  for (const s of kept) {
    const k = String(s.token_address).toLowerCase();
    if (!byToken.has(k)) byToken.set(k, []);
    byToken.get(k).push(s);
  }
  mkdirSync(SETS_DIR, { recursive: true });
  const ticksDir = resolve(SETS_DIR, `${args.name}-ticks`);
  mkdirSync(ticksDir, { recursive: true });

  const tokenRows = new Map(); // token -> rowsAsc（结局计算复用，不再读盘）
  const tokenCap = new Map();
  const tokenMetaMap = new Map();
  const ladderHits = []; // {token, hit}（挖掘点位——per (token,leg) 首触发）
  let windowStartBasisFallback = 0;
  for (const [token, sigs] of byToken) {
    if (!/^0x[0-9a-f]{40}$/.test(token)) { console.error(`token 地址非法: ${token}`); process.exit(1); }
    const meta = await loadTokenMeta(token);
    tokenMetaMap.set(token, meta);
    const firstSigMs = Math.min(...sigs.map((s) => Date.parse(s.anchorTimeIso || s.created_at)));
    let startIso, startBasis;
    if (meta.createdAt) { startIso = meta.createdAt; startBasis = 'token_create'; }
    else { startIso = new Date(firstSigMs - 10 * 60000).toISOString(); startBasis = 'first_signal-10min'; windowStartBasisFallback++; }
    const lastSigMs = Math.max(...sigs.map((s) => Date.parse(s.anchorTimeIso || s.created_at)));
    const endIso = new Date(lastSigMs + args.horizonMin * 60000).toISOString();
    const { rows, capped } = await pullTicksWindow(token, startIso, endIso);
    tokenRows.set(token, rows);
    tokenCap.set(token, capped);
    atomicJson(resolve(ticksDir, `${token}.json`), { token, startIso, endIso, startBasis, capped, rowCount: rows.length, rows });
    let minedNote = '';
    if (ladder) {
      const hits = mineLadderPoints({ rowsAsc: rows, meta, legs: ladder.legs });
      for (const h of hits) ladderHits.push({ token, hit: h });
      minedNote = hits.length ? ` | ladder ${hits.length} 腿触发(${hits.map((h) => h.legId).join(',')})` : ' | ladder 无触发';
    }
    console.log(`  ${token} ${(meta.symbol || '?').padEnd(10)} ${sigs.length} 点位 | ticks ${rows.length}${capped ? '+(capped 6万行帽)' : ''} | 窗 ${startIso.slice(11, 19)}→${endIso.slice(11, 19)}（${startBasis}）${minedNote}`);
  }
  const ladderByToken = new Map();
  for (const { token, hit } of ladderHits) {
    if (!ladderByToken.has(token)) ladderByToken.set(token, []);
    ladderByToken.get(token).push(hit);
  }
  if (ladder) console.log(`ladder 挖掘合计: ${ladderHits.length} 点位 / ${ladderByToken.size} token`);

  // 3) per point：锚 + 前向收益 + trades join（trades 源=tradeId episode 归属 / signals 源=signal_id 匹配）
  const points = [];
  const tradeJoinCache = new Map(); // `${expId}\0${token}` -> loadTradeJoin 结果（同 token 多点去重查）
  const idPrefix = args.source === 'trades' ? 'BP-T' : 'BP-S';
  let seq = 0;
  for (const s of kept) {
    const token = String(s.token_address).toLowerCase();
    const rows = tokenRows.get(token) || [];
    // 锚行数：生产 actTickCount hint 优先（fire 窗精确行数）；hint 超出 DB 行数=回放缓存
    // 与 DB 行缺失异常（loud warn 后回退时间计数，不静默）
    let anchorN;
    if (Number.isInteger(s.anchorTickHint) && s.anchorTickHint >= 0) {
      if (s.anchorTickHint <= rows.length) anchorN = s.anchorTickHint;
      else {
        console.warn(`⚠ ${s.token_symbol || token} anchorTickHint=${s.anchorTickHint} > DB 行数 ${rows.length}（回放缓存/DB 行缺失）——回退时间计数`);
        anchorN = anchorCountAt(rows, s.anchorTimeIso || s.created_at);
      }
    } else anchorN = anchorCountAt(rows, s.anchorTimeIso || s.created_at);
    const meta = tokenMetaMap.get(token);
    const p = {
      pointId: `${idPrefix}${String(++seq).padStart(3, '0')}`,
      source: args.source,
      experimentId: s.experiment_id,
      experimentName: nameOf.get(s.experiment_id) || null,
      tokenAddress: token,
      tokenSymbol: s.token_symbol || meta.symbol || null,
      signalId: s.id,
      signalCreatedAt: s.created_at,
      anchorTimeIso: s.anchorTimeIso || null, // 链上时间轴买点时刻（--tick-time-from-meta 补丁；null=live 同轴直用 signalCreatedAt）
      signalInfo: s.signalInfo,
      anchorTickCount: anchorN,
      thin: anchorN > 0 && anchorN < 8,
      anchorZero: anchorN === 0,
      capped: tokenCap.get(token) === true,
      ticksFile: `${token}.json`,
      quoteToken: quoteTokenOf(rows),
    };
    if (anchorN > 0) p.forwardReturns = computeForwardReturns(rows, anchorN) || null;
    else p.forwardReturns = null;

    try {
      const ck = `${s.experiment_id}\0${token}`;
      if (!tradeJoinCache.has(ck)) tradeJoinCache.set(ck, await loadTradeJoin(s.experiment_id, token));
      const { all, epOfTrade } = tradeJoinCache.get(ck);
      if (args.source === 'trades') {
        // 成交买点：point 本身即 trade 行——episode 盈亏=该成交所属持仓轮（结局观测）
        const ep = epOfTrade.get(String(s.id)) || null;
        p.trade = {
          buyExecuted: true,
          buyTradeId: s.id,
          buyAt: s.created_at,
          episode: ep ? episodePnlBnb(ep) : null,
        };
      } else {
        // signals 源：signal_id 匹配买腿 + 所属 episode 盈亏（未平仓 pnl=null 只记余量）
        const mine = all.filter((t) => t.signal_id && String(t.signal_id) === String(s.id));
        const buys = mine.filter((t) => t.trade_direction === 'buy');
        const okBuy = buys.find((t) => t.success);
        if (!buys.length) p.trade = { buyExecuted: null, note: 'signal_id 无匹配 trade（引擎未发单/被前序门拒）' };
        else if (okBuy) {
          const ep = epOfTrade.get(String(okBuy.id)) || null;
          p.trade = {
            buyExecuted: true,
            buyTradeId: okBuy.id,
            buyAt: okBuy.executed_at || okBuy.created_at,
            episode: ep ? episodePnlBnb(ep) : null,
          };
        } else {
          p.trade = { buyExecuted: false, buyAttempts: buys.length, note: '买腿全失败（熔断/链上拒绝）' };
        }
      }
    } catch (e) {
      p.trade = { buyExecuted: null, error: e.message };
    }
    points.push(p);
  }

  // 3b) ladder 挖掘点位（历史重放非引擎信号——signal 链路字段 null，腿快照+因子摘要随行）
  let lseq = 0;
  for (const [token, hits] of ladderByToken) {
    const rows = tokenRows.get(token) || [];
    const meta = tokenMetaMap.get(token);
    for (const h of hits) {
      const anchorN = anchorCountAt(rows, h.tsIso);
      const p = {
        pointId: `BP-L${String(++lseq).padStart(3, '0')}`,
        source: 'ladder',
        experimentId: null,
        experimentName: null,
        tokenAddress: token,
        tokenSymbol: meta.symbol || null,
        signalId: null,
        signalCreatedAt: h.tsIso,
        signalInfo: { price: h.priceBnb, strategyName: h.legId },
        anchorTickCount: anchorN,
        thin: anchorN > 0 && anchorN < 8,
        anchorZero: anchorN === 0,
        capped: tokenCap.get(token) === true,
        ticksFile: `${token}.json`,
        quoteToken: quoteTokenOf(rows),
        forwardReturns: anchorN > 0 ? (computeForwardReturns(rows, anchorN) || null) : null,
        ladder: {
          legId: h.legId,
          priority: h.priority,
          condition: h.condition,
          rowBlockTime: h.rowBlockTime,
          rowIndexOfToken: h.anchorTickCount, // 触发行在 token 全窗的行序（1 基）
          factors: h.factors,                 // 触发时刻因子摘要（九键）
        },
        trade: { buyExecuted: null, note: 'ladder 挖掘点（历史重放非引擎信号，无成交归属）' },
      };
      points.push(p);
    }
  }
  points.sort((a, b) => Date.parse(a.signalCreatedAt) - Date.parse(b.signalCreatedAt)
    || String(a.pointId).localeCompare(String(b.pointId)));

  // 4) 校验（addr/pointId 唯一/锚非负/ticksFile 在场）
  const ids = new Set();
  for (const p of points) {
    if (ids.has(p.pointId)) { console.error(`pointId 重复: ${p.pointId}`); process.exit(1); }
    ids.add(p.pointId);
    if (!/^0x[0-9a-f]{40}$/.test(p.tokenAddress)) { console.error(`token 地址非法: ${p.tokenAddress}`); process.exit(1); }
    if (!Number.isInteger(p.anchorTickCount) || p.anchorTickCount < 0) { console.error(`${p.pointId} 锚非法`); process.exit(1); }
    if (!existsSync(resolve(ticksDir, p.ticksFile))) { console.error(`${p.pointId} ticksFile 缺失`); process.exit(1); }
  }

  // 5) 组装 set + 原子写
  const doc = {
    setName: args.name,
    builtAt,
    // per token 元数据（run.mjs 组装 snapshot 用——set 自包含，runner 零 DB）
    tokens: Object.fromEntries([...tokenMetaMap.entries()].map(([k, meta]) => [k, meta])),
    sampleRule: {
      source: args.source,
      experiments: exps.map((e) => ({ id: e.id, name: e.experiment_name, createdAt: e.created_at })),
      expSelect: args.exps.length ? 'explicit --exps' : `最近 ${args.liveExpCount} 个 trading_mode=live（created_at 降序）`,
      dedupeSec: args.dedupeSec,
      excludeLegs: args.excludeLegs ? args.excludeLegs.split(',').map((s) => s.trim()).filter(Boolean) : [],
      pagination: '点位源 .range 翻页拉全（PAGE_ROWS=1000 对齐 PostgREST max-rows；v73 前 .limit 单查曾静默截 1000/1673）',
      cheatExclusion: args.keepCheat ? 'off（--keep-cheat：保留 cheat/unhealthy 票，grade 落 points 元数据供复盘）' : '收录前剔除当前判定 cheat/unhealthy 的 token 全部点位（cheat_detection 最新带 grade 行；healthy/无判定放行；构建时点快照语义）',
      ...(args.tickTimeFromMeta ? { tickTimeFromMeta: '买点锚/窗/前向收益用链上时间轴（signal tokenCreateTime+tokenAgeSec；回测实验 created_at=进程墙钟与 ticks 轴断裂的适配）——points[].anchorTimeIso；锚行数优先采生产 anchors.actTickCount（fire 窗精确行数，整数 ageSec 回构早 ≤1s 会把 fire tick 行排除——btv111 实测 34/91 curVs 漂 >5pp）' } : {}),
      horizonsSec: [...FWD_HORIZONS_SEC],
      horizonMin: args.horizonMin,
      anchorBasis: 'anchorCountAt=block_time≤点位时刻 的行数（宁多勿少近似——引擎墙钟 vs 链钟偏差沿 cheat --experiment 同款）',
      tickWindow: { startBasis: 'token_create.createdAt，缺失回退最早点位−10min（counts.windowStartFallback 计数）', cappedNote: `单 token 超 ${TICK_PAGE * TICK_PAGES_MAX} 行截断（点位 capped=true）` },
      tradeJoin: args.source === 'trades'
        ? '成交买点=trades 成功 buy 行本体；episode 盈亏=该成交所属持仓轮（qty 闭合切分 mcap replay 口径），未平仓 pnl=null 只记 openQty'
        : 'signal_id 匹配买腿（成功/失败/无匹配三态）；episode 盈亏=成功 trades qty 闭合切分（mcap replay 口径），未平仓 pnl=null 只记 openQty',
      ladderMining: ladder
        ? { libId: ladder.libId, libName: ladder.libName, libVersion: ladder.libVersion, legCount: ladder.legs.length, semantics: 'per (token,leg) 全窗首次满足=一点位（FA 真重放 processTick→buildFactorMap 逐 tick 评估，对齐生产 maxTriggers=1）；锚=anchorCountAt 同口径；点位 source=ladder' }
        : null,
      sampleCutoff: builtAt,
    },
    counts: {
      experiments: exps.length,
      sourceRaw: raw.length,
      sourceKept: kept.length,
      excludedCheatUnhealthy: excluded.length,
      excludedCheatUnhealthyTokens: [...new Set(excluded.map((x) => x.token))].length,
      excludedDetail: excluded, // [{token, grade}]（token 级明细审计）
      tokens: byToken.size,
      points: points.length,
      pointsBySource: {
        [args.source]: points.filter((p) => p.source === args.source).length,
        ladder: points.filter((p) => p.source === 'ladder').length,
      },
      ladderByLeg: Object.fromEntries([...ladderHits.reduce((m, { hit }) => m.set(hit.legId, (m.get(hit.legId) || 0) + 1), new Map())].map(([k, v]) => [k, v])),
      thin: points.filter((p) => p.thin).length,
      anchorZero: points.filter((p) => p.anchorZero).length,
      cappedTokens: [...tokenCap.values()].filter(Boolean).length,
      windowStartFallback: windowStartBasisFallback,
      buyExecuted: points.filter((p) => p.trade && p.trade.buyExecuted === true).length,
      buyFailed: points.filter((p) => p.trade && p.trade.buyExecuted === false).length,
      noMatch: points.filter((p) => p.trade && p.trade.buyExecuted === null).length,
    },
    points,
  };
  atomicJson(resolve(SETS_DIR, `${args.name}.json`), doc);

  const c = doc.counts;
  console.log(`\n汇总：点位 ${c.points}（源点位 ${c.sourceRaw} → cheat/unhealthy 剔 ${c.excludedCheatUnhealthy}（${c.excludedCheatUnhealthyTokens} token）→ 去重 ${c.sourceKept} + ladder 挖掘 ${c.pointsBySource.ladder}）| token ${c.tokens} | thin(<8) ${c.thin} | anchorZero ${c.anchorZero} | capped token ${c.cappedTokens} | 窗回退 ${c.windowStartFallback}`);
  if (ladder) console.log(`ladder 腿分布: ${Object.entries(c.ladderByLeg).map(([k, v]) => `${k}=${v}`).join(' ') || '零触发'}`);
  console.log(`结局对拍：买成 ${c.buyExecuted} / 买败 ${c.buyFailed} / 无匹配 ${c.noMatch}`);
  console.log(`set 已写 ${resolve(SETS_DIR, `${args.name}.json`)}；ticks 目录 ${ticksDir}（不进 git）`);
  // 锚/结局 sanity 探针：抽前 5 点位打印锚与 fwd +1min
  for (const p of points.slice(0, 5)) {
    const f1 = p.forwardReturns && p.forwardReturns.byHorizon[60];
    console.log(`  ${p.pointId} ${String(p.tokenSymbol || '?').padEnd(8)} 锚=${p.anchorTickCount}${p.thin ? '(thin)' : ''}${p.anchorZero ? '(zero)' : ''} fwd1min=${f1 ? `${f1.maxRisePct}/${f1.lastPct}%` : 'null'} 买=${p.trade && p.trade.buyExecuted === null ? '—' : p.trade && p.trade.buyExecuted}`);
  }
}

main().catch((e) => {
  console.error(`❌ ${e?.stack || e}`);
  process.exit(1);
});
