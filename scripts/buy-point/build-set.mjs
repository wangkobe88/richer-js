#!/usr/bin/env node
/**
 * 买入点位分析测试集构建（BP1，2026-11-03）——**182 跑**（本地 VPN 直连 Supabase 必
 * 超时=红线 9）。红线 3：全程 dbManager service key（anon 被 RLS 静默过滤成空）。
 *
 * 采样口径（用户裁定）：最近 4 个 live 实验的全部 BUY 信号点位，同 token 60s 窗去重
 * 取首个（跨实验按 token 全局去重——点位语义属 token）；结局观测（前向收益 + 引擎实际
 * 成交 episode 盈亏）构建期预计算随 set 落盘（run.mjs 直接带出对拍）。
 *
 * 产物：
 *   sets/<name>.json            —— 点位清单+锚+结局（进 git）
 *   sets/<name>-ticks/<token>.json —— per token ticks 全窗（tmp+rename 原子写；不进 git）
 *
 * 用法：
 *   node scripts/buy-point/build-set.mjs --name bp-2026-11-03-live4
 *       [--exps <id,...>]      # 覆盖缺省「最近 4 个 live」
 *       [--dedupe-sec 60]      # 同 token 去重窗（秒）
 *       [--horizon-min 15]     # ticks 拉取窗盖到「最晚信号+N 分钟」（≥前向 horizon 900s）
 *       [--limit-exp 5000]     # per 实验信号拉取帽（超=fail-loud，不静默截断）
 * 退出码：0=成功 1=失败 2=用法错误
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'fs';
import { createRequire } from 'module';
import { dedupeBuySignals, anchorCountAt, computeForwardReturns, buildEpisodes, episodePnlBnb, quoteTokenOf, FWD_HORIZONS_SEC } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SETS_DIR = resolve(HERE, 'sets');

const require_ = createRequire(import.meta.url);

const TICK_COLS = 'id,block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';
const TICK_PAGE = 4000;   // id 水位翻页页大小（mcap-floor-sell-replay 同款）
const TICK_PAGES_MAX = 15; // 6 万行帽（超=capped，宁截声明不静默）

function parseArgs(argv) {
  const args = { name: '', exps: [], dedupeSec: 60, horizonMin: 15, limitExp: 5000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name') args.name = String(argv[++i] || '');
    else if (a === '--exps') args.exps = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--dedupe-sec') args.dedupeSec = Number(argv[++i]);
    else if (a === '--horizon-min') args.horizonMin = Number(argv[++i]);
    else if (a === '--limit-exp') args.limitExp = Number(argv[++i]);
    else { console.error(`未知参数: ${a}`); process.exit(2); }
  }
  if (!args.name) { console.error('用法: build-set.mjs --name <set> [--exps id,...] [--dedupe-sec 60] [--horizon-min 15]'); process.exit(2); }
  if (!Number.isInteger(args.dedupeSec) || args.dedupeSec <= 0) { console.error('--dedupe-sec 须为正整数'); process.exit(2); }
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

/** per 实验 BUY 信号（超帽 fail-loud；metadata 只取 price/strategyName 两字段防 set 膨胀） */
async function loadBuySignals(expId, limitExp) {
  const { data, error } = await sb().from('strategy_signals')
    .select('id,token_address,token_symbol,created_at,metadata')
    .eq('experiment_id', expId)
    .eq('signal_type', 'BUY')
    .order('created_at', { ascending: true })
    .limit(limitExp + 1);
  if (error) throw new Error(`strategy_signals 查询失败(${expId}): ${error.message}`);
  const rows = data ?? [];
  if (rows.length > limitExp) { console.error(`实验 ${expId} BUY 信号超 ${limitExp} 帽（${rows.length}+）——--limit-exp 放宽或收窄实验`); process.exit(1); }
  return rows.map((r) => {
    const md = r.metadata || {};
    return {
      id: r.id, token_address: r.token_address, token_symbol: r.token_symbol || null,
      created_at: r.created_at, experiment_id: expId,
      signalInfo: { price: typeof md.price === 'number' ? md.price : null, strategyName: md.strategyName || null },
    };
  });
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
  console.log(`构建买入点位测试集: ${args.name}（去重窗 ${args.dedupeSec}s / ticks 窗盖至最晚信号+${args.horizonMin}min / 前向 horizon ${FWD_HORIZONS_SEC.join(',')}s）`);

  const exps = await loadLiveExperiments(4, args.exps);
  if (!exps.length) { console.error('无 live 实验（--exps 显式指定）'); process.exit(2); }
  console.log(`\n实验集（${exps.length} 个）:`);
  for (const e of exps) console.log(`  ${e.id} ${e.experiment_name || ''} ${e.created_at}`);

  // 1) 信号汇总 + 60s 去重
  const raw = [];
  for (const e of exps) {
    const sigs = await loadBuySignals(e.id, args.limitExp);
    console.log(`  信号 ${e.id}: ${sigs.length} 条 BUY`);
    raw.push(...sigs);
  }
  const kept = dedupeBuySignals(raw, args.dedupeSec);
  const nameOf = new Map(exps.map((e) => [e.id, e.experiment_name || e.id]));
  console.log(`\nBUY 信号 ${raw.length} 条 → 去重（同 token ${args.dedupeSec}s 窗取首）→ ${kept.length} 点位，涉及 token ${new Set(kept.map((s) => String(s.token_address).toLowerCase())).size} 个`);

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
  let windowStartBasisFallback = 0;
  for (const [token, sigs] of byToken) {
    if (!/^0x[0-9a-f]{40}$/.test(token)) { console.error(`token 地址非法: ${token}`); process.exit(1); }
    const meta = await loadTokenMeta(token);
    tokenMetaMap.set(token, meta);
    const firstSigMs = Math.min(...sigs.map((s) => Date.parse(s.created_at)));
    let startIso, startBasis;
    if (meta.createdAt) { startIso = meta.createdAt; startBasis = 'token_create'; }
    else { startIso = new Date(firstSigMs - 10 * 60000).toISOString(); startBasis = 'first_signal-10min'; windowStartBasisFallback++; }
    const lastSigMs = Math.max(...sigs.map((s) => Date.parse(s.created_at)));
    const endIso = new Date(lastSigMs + args.horizonMin * 60000).toISOString();
    const { rows, capped } = await pullTicksWindow(token, startIso, endIso);
    tokenRows.set(token, rows);
    tokenCap.set(token, capped);
    atomicJson(resolve(ticksDir, `${token}.json`), { token, startIso, endIso, startBasis, capped, rowCount: rows.length, rows });
    console.log(`  ${token} ${(meta.symbol || '?').padEnd(10)} ${sigs.length} 点位 | ticks ${rows.length}${capped ? '+(capped 6万行帽)' : ''} | 窗 ${startIso.slice(11, 19)}→${endIso.slice(11, 19)}（${startBasis}）`);
  }

  // 3) per point：锚 + 前向收益 + trades join
  const points = [];
  let seq = 0;
  for (const s of kept) {
    const token = String(s.token_address).toLowerCase();
    const rows = tokenRows.get(token) || [];
    const anchorN = anchorCountAt(rows, s.created_at);
    const meta = tokenMetaMap.get(token);
    const p = {
      pointId: `BP-S${String(++seq).padStart(3, '0')}`,
      experimentId: s.experiment_id,
      experimentName: nameOf.get(s.experiment_id) || null,
      tokenAddress: token,
      tokenSymbol: s.token_symbol || meta.symbol || null,
      signalId: s.id,
      signalCreatedAt: s.created_at,
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

    // trades join：signal_id 匹配买腿 + 所属 episode 盈亏（未平仓 pnl=null 只记余量）
    try {
      const { all, epOfTrade } = await loadTradeJoin(s.experiment_id, token);
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
    } catch (e) {
      p.trade = { buyExecuted: null, error: e.message };
    }
    points.push(p);
  }

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
      experiments: exps.map((e) => ({ id: e.id, name: e.experiment_name, createdAt: e.created_at })),
      expSelect: args.exps.length ? 'explicit --exps' : '最近 4 个 trading_mode=live（created_at 降序）',
      dedupeSec: args.dedupeSec,
      horizonsSec: [...FWD_HORIZONS_SEC],
      horizonMin: args.horizonMin,
      anchorBasis: 'anchorCountAt=block_time≤信号 created_at 的行数（宁多勿少近似——引擎墙钟 vs 链钟偏差沿 cheat --experiment 同款）',
      tickWindow: { startBasis: 'token_create.createdAt，缺失回退最早信号−10min（counts.windowStartFallback 计数）', cappedNote: `单 token 超 ${TICK_PAGE * TICK_PAGES_MAX} 行截断（点位 capped=true）` },
      tradeJoin: 'signal_id 匹配买腿（成功/失败/无匹配三态）；episode 盈亏=成功 trades qty 闭合切分（mcap replay 口径），未平仓 pnl=null 只记 openQty',
      sampleCutoff: builtAt,
    },
    counts: {
      experiments: exps.length,
      signalsRaw: raw.length,
      signalsKept: kept.length,
      tokens: byToken.size,
      points: points.length,
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
  console.log(`\n汇总：点位 ${c.points}（信号 ${c.signalsRaw} 去重损耗 ${c.signalsRaw - c.signalsKept}）| token ${c.tokens} | thin(<8) ${c.thin} | anchorZero ${c.anchorZero} | capped token ${c.cappedTokens} | 窗回退 ${c.windowStartFallback}`);
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
