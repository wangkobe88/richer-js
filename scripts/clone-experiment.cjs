#!/usr/bin/env node
// 正式克隆工具（2026-11-19 立，T167c 会话用户裁定「标准克隆模板默认带上 factorCheck」）：
// 整包复制基底实验 config + 门链标准段确保（factorCheck/cheatCheck/actFrontGate/buyPointCheck
// 缺则补 enabled:true——FP 族/CD/AF1/BP 四门在克隆产物永远在位）+ signalGate 买腿 cards:4
// 自动补（bt-v149 作废教训）+ stallClose.stallMs→50000 标准化（T170b 模板默认 50s——
// 2026-11-19 用户发现该裁定只落了文档没落工具，克隆链一直原样携带 40s；仅当 stallClose
// 段在场且 stallMs 已配=机制开着时改值，段缺席/stallMs 未配=机制关不强制开）+
// trading_mode 陷阱断言（克隆脚本 trading-mode-trap memory）。
// 只建行不启动（启动走 182 main.js start-experiment）；--dry 打印注入计划不写库。
//
// ── 2026-11-20 实盘恢复对齐扩展 ──
// --mode live：从回测基底克隆出实盘实验（copy-in 快照语义决定不能从旧实盘克隆——
//   会永远停在旧库腿；正确路径=从引用最新库 v33 的 bt 基底转换）。转换链：
//   剥 backtest/virtual 段 → 钱包注入（--executor/--reuse-wallet 两源，绝不接受明文
//   私钥参数）→ live 执行段（缺省同 config/default.json [sec].live）→ 剥回测专用
//   settleDelayMs:0（live 携 0 会跳过 settle 致 sender 未定值/wallet 口径退化，剥键
//   回落 4000 waitIdle 帽）→ Tier2 live 标准段全套确保（docs/当前最优买卖策略.md
//   L151-168 基准 + 2026-11-20 用户裁定 burstCooldown:{} 启用 / signalGatePerTickEval:
//   false 对齐回测 T154 debounce 形态）。
// --mode virtual：同链剥回测段+加 virtual 段（开启实盘前同 config 冒烟用）。
// 库腿版本 WARN：基底 libraryRefs 版本 ≠ strategy_library 现版本时醒目提示
//   （copy-in 不回溯，换基底解决；--refresh-legs 刻意不做——混合腿风险>收益）。
// Tier1（4 布尔+cards+stallMs）全模式不变=回测克隆 bit 一致；Tier2 仅 live 产物生效。
//
// 用法：
//   node scripts/clone-experiment.cjs --src <expId> --name <新实验名> [--desc "..."] [--dry]
//                                     [--no-gates]（跳过门链注入，纯整包复制）
//                                     [--mode live|virtual]（缺省=继承基底模式）
//                                     [--executor <executorId>] | [--reuse-wallet <expId>]（mode=live 必择一）
//                                     [--reserve-native 0.01] [--slippage 20] [--max-gas 10] [--max-position-tokens 0]
// 示例：
//   node scripts/clone-experiment.cjs --src c73b62be-... --name bt-v155-xxx-36h-win1012 --dry
//   node scripts/clone-experiment.cjs --src <bt-v15x> --name live-v75-ladder-v33 --mode live --executor <id> --dry
// （dbManager 懒 require 在 main 内——单测 require 本模块纯函数零 DB 零副作用）

// ══ Tier2 live 标准段（docs/当前最优买卖策略.md「四、机制与实验配置」基准 +
// 2026-11-20 用户裁定：burstCooldown 启用、per-tick 撤销）——唯一基准是 docs 文档，
// 改这里必须同步 docs。注入语义=段级一层深 merge（绝不单布尔顶段——浅合并陷阱：
// 引擎 _mergedWsConfig 嵌套对象整块替换，单布尔注入会顶掉 gate/memSource 子键）。══
const LIVE_STD_WS = {
  buySignalMaxPerToken: 15,        // docs L37：T110 默认帽 5 会截断 15 信号阶梯
  sellDebounceMinTicks: 5,         // 引擎缺省 0=纯时间门；丢 5-tick 双门=行为回退
  cheatCheck: {
    enabled: true,
    gate: { awaitMs: 60000, alwaysRecheck: true, activityExemptLevels: ['high'] },
    memSource: { enabled: false },
    actFrontGate: { enabled: true },
  },
  buyPointCheck: {
    enabled: true,
    gate: { awaitMs: 60000 },
    memSource: { enabled: false },
    factorCheck: { enabled: true },
  },
  factorSellFilter: { enabled: true },  // 缺段=关=T157/T183/T186 卖保护全丢（docs 明言行为回退）
  factorParams: { netBuyWinTrades: 12 }, // 引擎内建 20；回测最优验证口径 12（单键 merge 保留基底其余键）
  accountHealthCheck: { enabled: true, firstWindowMin: 10, fastIntervalSec: 30, slowIntervalSec: 120 },
  observationSignals: { enabled: true, intervalMs: 60000, maxPerToken: 3, marketCapThreshold: 27 },
  signalGatePerTickEval: false,    // 2026-11-20 裁定：对齐回测 T154「debounce 是对的」形态
};
const LIVE_STD_TOP = {
  positionManagement: { perCardBNB: 0.05 },  // +买腿 cards:4（Tier1 已确保）=0.2 BNB/笔四卡
  stallClose: { stallMs: 50000, minTickBnb: 0.01 },  // merge 保留 almostLaunchStallMs 等延长档
  burstCooldown: {},              // 2026-11-20 裁定启用：段在场=全默认（15s/30s 两批承接检查）
};

function arg(k) {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** ws 段标准注入：LIVE_STD_WS 深一层 merge 进 cfg[sec]（gate/memSource/actFrontGate/
 * factorCheck/observationSignals 等嵌套段单独 merge 保基底其余键），逐键留痕。纯函数（单测覆盖）。 */
function ensureLiveStandardSections(cfg, sec, changes) {
  cfg[sec] = cfg[sec] || {};
  const ws = cfg[sec];
  for (const [k, v] of Object.entries(LIVE_STD_WS)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const base = ws[k] || {};
      const merged = { ...base, ...v };
      // 二层嵌套段（gate/memSource/actFrontGate/factorCheck）再 merge 一层保基底其余键
      for (const [k2, v2] of Object.entries(v)) {
        if (v2 !== null && typeof v2 === 'object' && !Array.isArray(v2)) {
          merged[k2] = { ...(base[k2] || {}), ...v2 };
        }
      }
      if (JSON.stringify(base) !== JSON.stringify(merged)) {
        ws[k] = merged;
        changes.push(sec + '.' + k + '→' + JSON.stringify(v));
      }
    } else if (ws[k] !== v) {
      ws[k] = v;
      changes.push(sec + '.' + k + '=' + JSON.stringify(v));
    }
  }
  for (const [k, v] of Object.entries(LIVE_STD_TOP)) {
    const base = cfg[k];
    if (base === undefined || base === null || typeof base !== 'object' || Array.isArray(base)) {
      cfg[k] = { ...v };
      changes.push(k + '→' + JSON.stringify(v));
    } else {
      const merged = { ...base, ...v };
      if (JSON.stringify(base) !== JSON.stringify(merged)) {
        cfg[k] = merged;
        changes.push(k + ' merge←' + JSON.stringify(v));
      }
    }
  }
}

/** 模式转换链（纯函数，单测覆盖）：baseMode→targetMode 的段剥离/Tier2 标准段/live 段注入。
 * wallet/liveParams 由 main() 异步解析后传入（DB 查表在 main）。
 * 返回 { cfg, mode, changes }。 */
function convertMode(cfg, baseMode, targetMode, opts) {
  const changes = [];
  const mode = targetMode || baseMode;
  if (mode !== baseMode) {
    // 跨模式转换：剥源模式专属段（backtest 含 signalGateReal/窗口/sourceExperimentId）
    if (baseMode === 'backtest' && cfg.backtest) { delete cfg.backtest; changes.push('剥 backtest 段（含 signalGateReal/窗口）'); }
    if (cfg.virtual && mode !== 'virtual') { delete cfg.virtual; changes.push('剥 virtual 段'); }
  }
  if (mode === 'live') {
    const plat = cfg.platform || 'fourmeme';
    const sec = plat === 'flap' ? 'flapWs' : plat === 'gang' ? 'gangWs' : 'fourmemeWs';
    cfg[sec] = cfg[sec] || {};
    // 回测专用 settleDelayMs:0 必须剥（live 携 0=跳过 settle→sender 未定值→wallet 口径
    // 退化；剥键回落引擎 4000 waitIdle 帽=同语义不同实现，docs L172 生产/回测差异注记）
    for (const seg of ['cheatCheck', 'buyPointCheck']) {
      if (cfg[sec][seg] && 'settleDelayMs' in cfg[sec][seg]) {
        delete cfg[sec][seg].settleDelayMs;
        changes.push('剥 ' + sec + '.' + seg + '.settleDelayMs（回测直通值，live 回落 4000 waitIdle 帽）');
      }
    }
    if (mode !== baseMode) {
      // bt→live 转换：钱包（两源择一已由 main fail-fast 保证）+ live 执行段（同 web-server 形状）
      if (!opts.wallet || !opts.wallet.address) throw new Error('mode=live 转换缺钱包（--executor / --reuse-wallet 必择一）');
      cfg.wallet = opts.wallet;
      changes.push('wallet 注入: address=' + opts.wallet.address.slice(0, 10) + '… (' + (opts.wallet.executorId ? 'executorId 引用' : 'reuse 密文') + ')');
      cfg[sec].live = opts.liveParams;
      changes.push(sec + '.live=' + JSON.stringify(opts.liveParams));
    }
    ensureLiveStandardSections(cfg, sec, changes);
  } else if (mode === 'virtual' && mode !== baseMode) {
    cfg.virtual = { initialBalance: 100, tradeAmount: 0.1 };
    changes.push('virtual={initialBalance:100,tradeAmount:0.1}');
  }
  return { cfg, mode, changes };
}

module.exports = { LIVE_STD_WS, LIVE_STD_TOP, ensureLiveStandardSections, convertMode };

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const src = arg('src');
  const name = arg('name');
  const desc = arg('desc');
  const dry = process.argv.includes('--dry');
  const noGates = process.argv.includes('--no-gates');
  const modeArg = arg('mode');
  const executorId = arg('executor');
  const reuseWalletExp = arg('reuse-wallet');
  if (!src || !name) {
    console.error('用法: --src <expId> --name <名> [--desc ..] [--dry] [--no-gates] [--mode live|virtual]\n' +
      '                       [--executor <executorId> | --reuse-wallet <expId>] [--reserve-native N] [--slippage N] [--max-gas N] [--max-position-tokens N]');
    process.exit(1);
  }
  if (modeArg && modeArg !== 'live' && modeArg !== 'virtual') {
    console.error('FATAL --mode 仅支持 live|virtual（缺省=继承基底模式）'); process.exit(1);
  }

  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*').eq('id', src).limit(1);
  if (error) throw new Error(error.message);
  if (!data.length) throw new Error('基底实验不存在: ' + src);
  const e = data[0];
  const cfg = JSON.parse(JSON.stringify(e.config));
  const baseMode = e.trading_mode;
  const targetMode = modeArg || baseMode;
  if (targetMode === 'live' && targetMode !== baseMode && !executorId && !reuseWalletExp) {
    console.error('FATAL --mode live（从 ' + baseMode + ' 转换）必须指定钱包源：--executor <executorId> 或 --reuse-wallet <expId>（不接受明文私钥参数）');
    process.exit(1);
  }
  if (targetMode === baseMode && !modeArg && baseMode === 'backtest') {
    console.log('⚠ 未指定 --mode：产物=回测克隆（trading_mode 原样继承基底）');
  }

  // ── 钱包/live 参数解析（DB/文件读取在 main；形状照抄 web-server live 创建段）──
  let wallet = null;
  if (targetMode === 'live' && targetMode !== baseMode) {
    if (executorId) {
      const { data: executor, error: execError } = await c.from('executors')
        .select('name, address, blockchain').eq('id', executorId).single();
      if (execError || !executor) throw new Error('执行器不存在: ' + executorId);
      if (executor.blockchain !== 'bsc') throw new Error('执行器区块链不符: ' + executor.blockchain + '（BSC-only）');
      wallet = { executorId, address: executor.address };
    } else {
      const { data: srcExp, error: srcErr } = await c.from('experiments')
        .select('config').eq('id', reuseWalletExp).limit(1);
      if (srcErr || !srcExp.length) throw new Error('复用钱包源实验不存在: ' + reuseWalletExp);
      const sw = (srcExp[0].config || {}).wallet;
      if (!sw || !sw.address) throw new Error('源实验 ' + reuseWalletExp + ' 无钱包配置，无法复用');
      // 两形态：executorId 引用（v74 系实际形态，私钥单一真相源在 executors 表=拷引用不挪密钥）
      // / privateKey 密文（web-server L745 同款直拷）
      wallet = sw.executorId
        ? { executorId: sw.executorId, address: sw.address }
        : { address: sw.address, ...(sw.privateKey ? { privateKey: sw.privateKey } : {}) };
      if (!wallet.executorId && !wallet.privateKey) throw new Error('源实验 ' + reuseWalletExp + ' 钱包无私钥亦无 executorId，无法复用');
    }
  }
  let liveParams = null;
  if (targetMode === 'live' && targetMode !== baseMode) {
    const plat = cfg.platform || 'fourmeme';
    const sec = plat === 'flap' ? 'flapWs' : plat === 'gang' ? 'gangWs' : 'fourmemeWs';
    const liveDefaults = require('../config/default.json')[sec].live || {};
    const rn = arg('reserve-native');
    const sl = arg('slippage');
    const mg = arg('max-gas');
    const mp = arg('max-position-tokens');
    liveParams = {
      reserveNative: rn !== undefined ? parseFloat(rn) : liveDefaults.reserveNative ?? 0.01,
      slippageTolerance: sl !== undefined ? parseFloat(sl) : liveDefaults.slippageTolerance ?? 20,
      maxGasPrice: mg !== undefined ? parseFloat(mg) : liveDefaults.maxGasPrice ?? 10,
      maxPositionTokens: mp !== undefined ? (parseInt(mp, 10) || 0) : 0,
    };
  }

  const changes = [];

  if (!noGates) {
    // 门链标准段（Tier1，全模式不变）：注入到平台主段（both/fourmeme→fourmemeWs；flap→flapWs；gang→gangWs）
    const plat = cfg.platform || 'fourmeme';
    const sec = plat === 'flap' ? 'flapWs' : plat === 'gang' ? 'gangWs' : 'fourmemeWs';
    cfg[sec] = cfg[sec] || {};
    // ① FP 因子门（T143/T167c——用户裁定「factorCheck 一直都需要打开」）
    cfg[sec].buyPointCheck = cfg[sec].buyPointCheck || {};
    if (cfg[sec].buyPointCheck.enabled !== true) { cfg[sec].buyPointCheck.enabled = true; changes.push(sec + '.buyPointCheck.enabled=true'); }
    cfg[sec].buyPointCheck.factorCheck = cfg[sec].buyPointCheck.factorCheck || {};
    if (cfg[sec].buyPointCheck.factorCheck.enabled !== true) { cfg[sec].buyPointCheck.factorCheck.enabled = true; changes.push(sec + '.buyPointCheck.factorCheck.enabled=true'); }
    // ② cheat 门 + AF1 前置门（灰度布尔显式开——缺省 false 防回归）
    cfg[sec].cheatCheck = cfg[sec].cheatCheck || {};
    if (cfg[sec].cheatCheck.enabled !== true) { cfg[sec].cheatCheck.enabled = true; changes.push(sec + '.cheatCheck.enabled=true'); }
    cfg[sec].cheatCheck.actFrontGate = cfg[sec].cheatCheck.actFrontGate || {};
    if (cfg[sec].cheatCheck.actFrontGate.enabled !== true) { cfg[sec].cheatCheck.actFrontGate.enabled = true; changes.push(sec + '.cheatCheck.actFrontGate.enabled=true'); }
    // ③ signalGate 买腿 cards:4 自动补（bt-v149 作废教训：换库腿漏 cards=卡牌阶梯退化）
    const sc = cfg.strategiesConfig || cfg.strategy || {};
    for (const l of (sc.buyStrategies || [])) {
      if (l.signalGate && l.cards !== 4) { l.cards = 4; changes.push('买腿[' + (l.name || 'leg') + '] cards→4'); }
    }
    // ④ 断流卖出时长标准化（T170b 模板默认 50s，2026-11-19 用户裁定实装）：
    //    stallClose 段在场且 stallMs 已配（=机制开着）→ 改值 50000 并留痕；
    //    段缺席 / stallMs 未配（=机制关）不强制开机制，保持克隆语义。
    //    对拍实验需保留其它值时走 --no-gates 纯整包复制，或建行后手改 config。
    if (cfg.stallClose && typeof cfg.stallClose.stallMs === 'number' && cfg.stallClose.stallMs > 0) {
      if (cfg.stallClose.stallMs !== 50000) {
        changes.push('stallClose.stallMs ' + cfg.stallClose.stallMs + '→50000（T170b 模板默认 50s）');
        cfg.stallClose.stallMs = 50000;
      }
    }
  }

  // ── 模式转换（Tier2 在内；--no-gates 跳过 Tier1 但转换链不跳——mode 显式指定即用户意图）──
  const conv = convertMode(cfg, baseMode, modeArg || null, { wallet, liveParams });
  const mode = conv.mode;
  for (const ch of conv.changes) changes.push(ch);

  // trading_mode 陷阱断言（memory clone-script-trading-mode-trap）：仅未转换时按基底断言
  if (!modeArg && mode === 'backtest') {
    if (!cfg.backtest) throw new Error('回测基底缺 backtest 段');
    if (!cfg.backtest.startTime || !cfg.backtest.endTime) throw new Error('回测基底缺 startTime/endTime（缺一 fail-fast 拒启）');
  }

  // ── 库腿版本 WARN（copy-in 不回溯：基底引用旧版库=产物永远停在旧门形状）──
  const libRefs = (cfg.strategiesConfig || cfg.strategy || {}).libraryRefs;
  if (Array.isArray(libRefs) && libRefs.length) {
    for (const ref of libRefs) {
      if (!ref || !ref.libId) continue;
      const { data: lib } = await c.from('strategy_library')
        .select('name, side, version').eq('id', ref.libId).single();
      if (!lib) { console.log('⚠ libraryRef ' + (ref.name || ref.libId) + ' 在 strategy_library 无对应条目（可能已删）'); continue; }
      if (String(ref.version) !== String(lib.version)) {
        console.log('⚠⚠ 库腿快照过期: ' + ref.name + ' 基底 v' + ref.version + ' ≠ 库最新 v' + lib.version +
          '——copy-in 不回溯，产物腿=旧版门形状；请换引用最新版的基底克隆');
      } else {
        console.log('库腿版本一致: ' + ref.name + ' v' + lib.version + '（最新）');
      }
    }
  } else {
    console.log('⚠ 基底无 strategiesConfig.libraryRefs（手工载体实验——腿快照来源不明确，人工核对）');
  }

  console.log('基底:', e.experiment_name, '| mode:', baseMode + (modeArg ? ' → ' + mode : ''), '| platform:', cfg.platform);
  console.log('窗口:', cfg.backtest ? cfg.backtest.startTime + ' ~ ' + cfg.backtest.endTime : '(非回测)');
  const sc2 = cfg.strategiesConfig || cfg.strategy || {};
  console.log('腿: buy=' + ((sc2.buyStrategies || []).length) + ' sell=' + ((sc2.sellStrategies || []).length));
  console.log('注入/修正 ' + changes.length + ' 处' + (changes.length ? '：\n  - ' + changes.join('\n  - ') : '（基底已全在位零改动）'));

  if (mode === 'live') {
    console.log('\n━━ 启动前 checklist（docs/live-acceptance-runbook.md）━━');
    console.log('  1. 查持仓：历史 live 钱包链上 balanceOf 终裁，残余先处置（live-restart-positions-check 纪律）');
    console.log('  2. 0.001 BNB 验收闭环（新钱包/执行器时必做，runbook §2）');
    console.log('  3. 启动（182 screen）: node main.js start-experiment -e <新id>（run-engine 拒 live）');
    console.log('  4. 启动日志核对「⛓ 门链配置」汇总行 + 名单装载行（cheat-crew/famous/smartmoney）');
  }
  if (dry) {
    if (mode === 'live') {
      const plat = cfg.platform || 'fourmeme';
      const sec = plat === 'flap' ? 'flapWs' : plat === 'gang' ? 'gangWs' : 'fourmemeWs';
      console.log('\n===CONFIG_JSON===');
      console.log(JSON.stringify({
        trading_mode: mode,
        wallet: cfg.wallet ? { address: cfg.wallet.address, executorId: cfg.wallet.executorId || null } : null,
        [sec]: cfg[sec],
        stallClose: cfg.stallClose || null,
        positionManagement: cfg.positionManagement || null,
        burstCooldown: cfg.burstCooldown || null,
      }, null, 2));
    }
    console.log('[dry] 未写库'); process.exit(0);
  }
  const row = {
    id: crypto.randomUUID(),
    experiment_name: name,
    experiment_description: desc || ('克隆自 ' + e.experiment_name + '（' + src + '），门链标准段经 clone-experiment.cjs 确保' + (changes.length ? '：' + changes.join('；') : '（基底已全在位）')),
    trading_mode: mode,
    strategy_type: e.strategy_type,
    blockchain: e.blockchain,
    kline_type: e.kline_type,
    status: 'stopped',
    config: { ...cfg, name },
  };
  const { error: ie } = await c.from('experiments').insert(row);
  if (ie) throw new Error(ie.message);
  console.log('NEW_ID=' + row.id);
  process.exit(0);
}
if (require.main === module) {
  main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
}
