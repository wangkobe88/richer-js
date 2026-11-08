#!/usr/bin/env node
// ============================================================================
// 单 token case 门链回测工具（2026-11-08，bt-s01 0x28ad2c7d 翻案迟滞案工具化）：
//   给定基底实验（单票回测形状：signalGateReal+cheat/BP 双门开）+ token 地址，
//   自动建「窗口锚定该 token 生命期 + 买腿换现行库快照」的克隆重跑实验，
//   可选后台跑完并出信号×门链×成交报告（可对照基底实验同票结果）。
//
//   用途：cheat/BP/门链/库条目任何改动后的**单 case 定向回测验证**（频繁使用）——
//   新代码（182 pull 后）+ 现行库腿，看同一票在改动后会不会买/买在哪/结果如何。
//
// 三模式（182 跑；本地只允许 dry-run create / report 小查询）：
//   1) create（缺省 dry）:
//      node scripts/backtest-token-case.cjs --src <基底expId> --token <addr> \
//        [--lib signal-source-ladder-v1] [--pre-min 15] [--post-min 30] \
//        [--start ISO] [--end ISO] [--name <名>] [--commit]
//      - 窗口缺省 = token_create（wss_events 最早行）前 pre-min / 后 post-min；
//        --start/--end 显式覆盖
//      - 买腿 = --lib 现行最新版快照 copy-in（每腿注入 cards:4——卡牌形状裁定）；
//        buySignalMaxPerToken 自动抬到 ≥ 腿数；卖腿/引擎段/双门段整包保留基底
//      - 防呆：基底须 backtest.signalGateReal===true + cheatCheck.enabled +
//        buyPointCheck.enabled（单票门链回测的前提，缺一拒绝）
//   2) run:    node scripts/backtest-token-case.cjs --run <expId> [--timeout-min 40]
//      - setsid 后台 node src/run-engine.js，轮询 experiments.status 至终态
//   3) report: node scripts/backtest-token-case.cjs --report <expId> \
//        [--token <addr>] [--baseline <基底expId>]
//      - 该实验（缺省全部 distinct token）BUY 信号 × cheat 门（grade/exempt/
//        denied/marketReset）× BP 门 × execution_status + trades 盈亏汇总；
//        --baseline 时先打基底同 token 同表对照
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const args = process.argv.slice(2);
const argVal = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const argInt = (k, d) => { const v = argVal(k); return v === null ? d : Number(v); };

const SRC = argVal('--src');
const TOKEN = (argVal('--token') || '').toLowerCase();
const LIB = argVal('--lib') || 'signal-source-ladder-v1';
const PRE_MIN = argInt('--pre-min', 15);
const POST_MIN = argInt('--post-min', 30);
const START = argVal('--start');
const END = argVal('--end');
const NAME = argVal('--name');
const COMMIT = args.includes('--commit');
const RUN_ID = argVal('--run');
const REPORT_ID = argVal('--report');
const BASELINE_ID = argVal('--baseline');
const TIMEOUT_MIN = argInt('--timeout-min', 40);

function usage() {
  console.error('用法见文件头注释。示例：');
  console.error('  node scripts/backtest-token-case.cjs --src <基底> --token 0x... [--commit]');
  console.error('  node scripts/backtest-token-case.cjs --run <expId>');
  console.error('  node scripts/backtest-token-case.cjs --report <expId> [--token 0x...] [--baseline <基底>]');
  process.exit(1);
}

// ─────────────────────────── create ───────────────────────────
async function create() {
  if (!SRC || !TOKEN) usage();
  const { dbManager } = require('../src/services/dbManager.js');
  const db = dbManager.getClient();

  // 1) 基底 config
  const { data: expRows, error: e1 } = await db.from('experiments')
    .select('id,experiment_name,config').eq('id', SRC).limit(1);
  if (e1) throw new Error(e1.message);
  if (!expRows || !expRows.length) throw new Error('基底实验不存在: ' + SRC);
  const cfg = JSON.parse(JSON.stringify(expRows[0].config));

  // 防呆：门链回测前提三段
  if (cfg.backtest?.signalGateReal !== true) throw new Error('基底 backtest.signalGateReal !== true——不是门链回测形状，拒绝克隆');
  if (cfg.fourmemeWs?.cheatCheck?.enabled !== true) throw new Error('基底 fourmemeWs.cheatCheck.enabled 未开——拒绝克隆');
  if (cfg.fourmemeWs?.buyPointCheck?.enabled !== true) throw new Error('基底 fourmemeWs.buyPointCheck.enabled 未开——拒绝克隆');

  // 2) token_create 锚定窗口
  const { data: evRows, error: e2 } = await db.from('wss_events')
    .select('block_time').eq('kind', 'token_create').eq('token_address', TOKEN)
    .order('block_time', { ascending: true }).limit(1);
  if (e2) throw new Error(e2.message);
  if (!evRows || !evRows.length) throw new Error('wss_events 无 token_create 行: ' + TOKEN);
  const createdAt = new Date(evRows[0].block_time);
  const startIso = START || new Date(createdAt.getTime() - PRE_MIN * 60000).toISOString();
  const endIso = END || new Date(createdAt.getTime() + POST_MIN * 60000).toISOString();

  // 3) 现行库快照
  const { data: libRows, error: e3 } = await db.from('strategy_library')
    .select('id,name,side,version,legs,updated_at')
    .eq('name', LIB).eq('side', 'buy')
    .order('version', { ascending: false }).limit(1);
  if (e3) throw new Error(e3.message);
  if (!libRows || !libRows.length) throw new Error('库条目不存在: ' + LIB + '/buy');
  const lib = libRows[0];
  if (!Array.isArray(lib.legs) || !lib.legs.length) throw new Error('库条目 legs 为空');
  const buyLegs = JSON.parse(JSON.stringify(lib.legs)).map((l) => {
    if (l.cards === undefined) l.cards = 4; // 卡牌形状裁定（2026-11-07）：缺省 1 卡=阶梯退化
    return l;
  });

  // 4) 组装 cfg
  cfg.backtest = { ...cfg.backtest, startTime: startIso, endTime: endIso };
  cfg.strategiesConfig = { ...cfg.strategiesConfig, buyStrategies: buyLegs };
  const refs = Array.isArray(cfg.strategiesConfig.libraryRefs) ? [...cfg.strategiesConfig.libraryRefs] : [];
  const snapAt = new Date().toISOString();
  const refIdx = refs.findIndex((r) => r.name === LIB && r.side === 'buy');
  const ref = { name: LIB, side: 'buy', libId: lib.id, version: lib.version, legCount: buyLegs.length, snapshotAt: snapAt };
  if (refIdx >= 0) refs[refIdx] = ref; else refs.push(ref);
  cfg.strategiesConfig.libraryRefs = refs;
  const fm = { ...cfg.fourmemeWs };
  const cur = Number(fm.buySignalMaxPerToken || 0);
  if (cur < buyLegs.length) fm.buySignalMaxPerToken = buyLegs.length; // 帽 ≥ 腿数（T123/T124 惯例）
  cfg.fourmemeWs = fm;
  const baseLegN = (expRows[0].config.strategiesConfig?.buyStrategies || []).length;
  cfg.name = NAME || `bt-case-${TOKEN.slice(0, 8)}-${LIB}-v${lib.version}门链`;
  cfg.description = `单 case 门链回测（backtest-token-case.cjs）：基底 ${SRC.slice(0, 8)} ${expRows[0].experiment_name}；token ${TOKEN}；买腿=${LIB} v${lib.version}（${buyLegs.length} 腿，基底 ${baseLegN} 腿）；窗口 ${startIso} → ${endIso}`;

  // 5) dry-run 打印
  const sells = cfg.strategiesConfig?.sellStrategies || [];
  console.log('== 基底 ==', expRows[0].experiment_name, `(${SRC.slice(0, 8)})`);
  console.log('== token ==', TOKEN, '| 创建锚', createdAt.toISOString());
  console.log('== 窗口 ==', startIso, '→', endIso, `（前 ${PRE_MIN}min/后 ${POST_MIN}min${START || END ? ' 显式覆盖' : ''}）`);
  console.log('== 买腿 ==', `${LIB} v${lib.version}（${buyLegs.length} 腿，copy-in ${snapAt}）：`);
  for (const l of buyLegs) console.log(`   p${l.priority} ${l.condition}${l.cards ? ` [cards:${l.cards}]` : ''}`);
  console.log('== 卖腿 ==', sells.length + ' 条（整包保留基底）');
  console.log('== 帽 == buySignalMaxPerToken =', fm.buySignalMaxPerToken, '| signalGateReal =', cfg.backtest.signalGateReal,
    '| cheat/BP 双门 =', fm.cheatCheck?.enabled, '/', fm.buyPointCheck?.enabled);
  console.log('== 新名 ==', cfg.name);

  if (!COMMIT) { console.log('\n[dry-run] 未建实验；加 --commit 真建'); return; }

  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();
  const container = await factory.createFromConfig(cfg, 'backtest');
  console.log('\n========================================');
  console.log('NEW_EXP_ID=' + container.id);
  console.log('========================================');
  console.log('跑（182）: node scripts/backtest-token-case.cjs --run ' + container.id);
}

// ─────────────────────────── run ───────────────────────────
const TERMINAL_STATUS = ['completed', 'failed', 'stopped', 'error'];

async function run() {
  const { spawn } = require('child_process');
  const { dbManager } = require('../src/services/dbManager.js');
  const db = dbManager.getClient();
  // 防呆（bt-s02 双跑教训 2026-11-08）：run-engine 无状态检查，终态实验重跑=信号行翻倍污染
  //（同实验每跑一遍 BUY 信号各写一遍——20 行=10 信号×2 的现场）。重跑请另建新实验。
  {
    const { data, error } = await db.from('experiments').select('status').eq('id', RUN_ID).limit(1);
    if (error) throw new Error(error.message);
    const pre = data && data[0] && data[0].status;
    if (TERMINAL_STATUS.includes(pre)) {
      throw new Error(`实验已终态（${pre}）——拒绝重跑（防信号行翻倍）；重跑请 --src --token --commit 另建新实验`);
    }
  }
  const logFile = path.join(__dirname, '..', 'data', `btc-${RUN_ID.slice(0, 8)}.log`);
  const child = spawn('node', ['src/run-engine.js', RUN_ID], {
    cwd: path.join(__dirname, '..'),
    detached: true, stdio: ['ignore', 'ignore', 'ignore'],
  });
  const fs = require('fs');
  const out = fs.openSync(logFile, 'a');
  // 简化：stdout/stderr 走 run-engine 自身实验日志；此文件仅存 PID 存根
  fs.writeSync(out, `# spawn pid=${child.pid} at ${new Date().toISOString()}\n`);
  fs.closeSync(out);
  child.unref();
  console.log(`已后台启动 pid=${child.pid}（日志: run-engine 实验日志 + ${logFile}）`);
  console.log('轮询状态…');
  const deadline = Date.now() + TIMEOUT_MIN * 60000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 15000));
    const { data, error } = await db.from('experiments').select('status').eq('id', RUN_ID).limit(1);
    if (error) throw new Error(error.message);
    const st = data && data[0] && data[0].status;
    process.stdout.write(`  [${new Date().toISOString().slice(11, 19)}] status=${st}\n`);
    if (TERMINAL_STATUS.includes(st)) {
      console.log('\n终态 =', st);
      console.log('报告: node scripts/backtest-token-case.cjs --report ' + RUN_ID);
      return;
    }
    if (Date.now() > deadline) { console.log('\n超时（' + TIMEOUT_MIN + 'min）——进程仍在跑，可自行查 status'); return; }
  }
}

// ─────────────────────────── report ───────────────────────────
// 同实验双跑会让同 (created_at, legId, triggerNo) 信号各写一遍——打印前去重并留痕
function dedupeSignals(rows) {
  const seen = new Set();
  const out = [];
  let dup = 0;
  for (const s of rows || []) {
    const k = `${s.created_at}|${s.metadata?.signalGate?.legId}|${s.metadata?.signalGate?.triggerNo}`;
    if (seen.has(k)) dup++; else { seen.add(k); out.push(s); }
  }
  return { out, dup };
}

function fmtSignals(rows, label) {
  console.log(`\n──── ${label} ────`);
  if (!rows || !rows.length) { console.log('（无 BUY 信号）'); return; }
  const { out, dup } = dedupeSignals(rows);
  if (dup > 0) console.log(`⚠ 检测到 ${dup} 行重复信号（同时刻同腿——疑似同实验被跑过多次），已按 (时刻,腿,triggerNo) 去重展示`);
  for (const s of out) {
    const m = s.metadata || {};
    const sg = m.signalGate || {};
    const cc = m.cheatCheck || {};
    const ex = cc.exempt ? ` exempt:${cc.exempt.code}←${cc.exempt.originalGrade}` : '';
    const dn = cc.exemptDenied ? ` denied:${cc.exemptDenied}` : '';
    const rs = cc.marketReset ? ` reset(${typeof cc.marketReset === 'object' ? (cc.marketReset.minVsLaunchPct ?? '?') : 'y'})` : '';
    const lv = cc.levels || {};
    const arms = [lv.slowGrindPump >= 3 && 'pump', lv.washPair >= 3 && 'wash', lv.holdingsBalance >= 3 && 'holdings'].filter(Boolean).join(',');
    console.log(`${s.created_at} ${String(sg.legId ?? '-').padEnd(9)} t${sg.triggerNo ?? '-'} | cheat=${cc.grade ?? cc.status ?? '-'}${ex}${dn}${rs}${arms ? ' 三臂:' + arms : ''}`);
    const bp = m.buyPoint;
    if (bp) {
      const as = bp.assessment || {}; // bucket/rule/prob 在 assessment 子对象（model,usage,passed,status,anchors,qualities,assessment,dimensions,passLevels）
      const qs = Object.entries(bp.qualities || {}).map(([k, v]) => `${k.slice(0, 4)}:${v.bucket}(${v.prob})`).join(' ');
      console.log(`    bp=${as.bucket ?? bp.status ?? '-'} rule=${as.rule ?? '-'} prob=${as.prob ?? '-'}${qs ? ' | ' + qs : ''}`);
    }
    console.log(`    exec=${m.execution_status ?? '-'} ${m.execution_reason ? '| ' + String(m.execution_reason).slice(0, 80) : ''}`);
  }
}

async function report() {
  const { dbManager } = require('../src/services/dbManager.js');
  const db = dbManager.getClient();
  const tok = TOKEN || null;
  async function pull(expId, t) {
    let q = db.from('strategy_signals')
      .select('created_at,metadata,reason,token_address')
      .eq('experiment_id', expId).eq('signal_type', 'BUY')
      .order('created_at', { ascending: true }).limit(500);
    if (t) q = q.eq('token_address', t);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data || [];
  }
  async function nameOf(expId) {
    const { data } = await db.from('experiments').select('experiment_name').eq('id', expId).limit(1);
    return (data && data[0] && data[0].experiment_name) || expId.slice(0, 8);
  }
  async function pnl(expId, t) {
    let q = db.from('trades')
      .select('token_address,trade_direction,input_currency,input_amount,output_currency,output_amount,success,sold_cards')
      .eq('experiment_id', expId).limit(2000);
    if (t) q = q.eq('token_address', t);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    let buy = 0, sell = 0, nB = 0, nS = 0;
    for (const r of data || []) {
      if (r.success === false) continue;
      if (r.trade_direction === 'buy') {
        // 买入成本 = BNB 侧投入（input 或 output 中的 BNB 腿）
        const bnbIn = r.input_currency === 'BNB' ? Number(r.input_amount || 0)
          : r.output_currency === 'BNB' ? Number(r.output_amount || 0) : 0;
        buy += bnbIn; nB++;
      } else if (r.trade_direction === 'sell') {
        const bnbOut = r.output_currency === 'BNB' ? Number(r.output_amount || 0)
          : r.input_currency === 'BNB' ? Number(r.input_amount || 0) : 0;
        sell += bnbOut; nS++;
      }
    }
    return { buy, sell, net: sell - buy, nB, nS, tokens: new Set((data || []).map((r) => r.token_address)).size };
  }
  if (BASELINE_ID) {
    const rows = await pull(BASELINE_ID, tok);
    fmtSignals(rows, `基底 ${await nameOf(BASELINE_ID)}（${BASELINE_ID.slice(0, 8)}）${tok ? ' token=' + tok.slice(0, 10) : ''}`);
    const p = await pnl(BASELINE_ID, tok);
    console.log(`  成交: 买 ${p.nB} 笔 ${p.buy.toFixed(4)} BNB / 卖 ${p.nS} 笔 ${p.sell.toFixed(4)} BNB → 净 ${p.net >= 0 ? '+' : ''}${p.net.toFixed(4)}`);
  }
  const rows = await pull(REPORT_ID, tok);
  fmtSignals(rows, `本次 ${await nameOf(REPORT_ID)}（${REPORT_ID.slice(0, 8)}）${tok ? ' token=' + tok.slice(0, 10) : '（全部 token）'}`);
  const p = await pnl(REPORT_ID, tok);
  console.log(`  成交: 买 ${p.nB} 笔 ${p.buy.toFixed(4)} BNB / 卖 ${p.nS} 笔 ${p.sell.toFixed(4)} BNB → 净 ${p.net >= 0 ? '+' : ''}${p.net.toFixed(4)}`);
}

async function main() {
  if (RUN_ID) return run();
  if (REPORT_ID) return report();
  return create();
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
