#!/usr/bin/env node
// 正式克隆工具（2026-11-19 立；T202 策略库二期 2026-11-20 重写）：
// 整包复制基底实验 config + 策略包引用转换。交易策略（买/卖腿+断流/冷盘卖出+
// 四检测模块版本）唯一来源=策略库策略包——克隆产物 config 只携带顶层 strategyId，
// 引擎启动查库解析（启动时取最新 version）。
//
// ── T202 后语义 ──
// * Tier1 门链注入/cards:4 自动补/stallClose.stallMs 标准化 全部退役（策略包拥有
//   门链启停与机制段；--no-gates 参数同步废弃，传入即报错防误用）
// * --pack <name|id>：基底为旧内嵌腿形状（strategiesConfig.buy/sellStrategies）
//   时必须给（按名/uuid 取库最新版，产物 config.strategyId=包 id，剥旧腿/
//   libraryRefs/strategyResolved）；基底已是新形状时缺省沿用其 strategyId，
//   显式 --pack=换包（对拍工作流：clone bt-v163 --pack other-pack）
// * 基底携带的 T202 已归包键一律剥离留痕：ws 段四 enabled 键
//   （cheatCheck.enabled/cheatCheck.actFrontGate/buyPointCheck.enabled/
//   buyPointCheck.factorCheck.enabled）+ 顶层 stallClose/burstCooldown
// * strategiesConfig 的 stats/eventRecording/permanentBlockCondition 保留（实验层）
//
// ── 2026-11-20 实盘恢复对齐扩展（保留）──
// --mode live：从回测基底克隆出实盘实验。转换链：剥 backtest/virtual 段 →
//   钱包注入（--executor/--reuse-wallet 两源，绝不接受明文私钥参数）→ live
//   执行段（缺省同 config/default.json [sec].live）→ 剥回测专用 settleDelayMs:0
//   （live 携 0 会跳过 settle 致 sender 未定值/wallet 口径退化，剥键回落 4000
//   waitIdle 帽）→ Tier2 live ops 标准段（buySignalMaxPerToken/卖确认 5-tick/
//   gate awaitMs+alwaysRecheck+activityExemptLevels/factorSellFilter 等——
//   门链 enabled 不在此，归策略包）。
// --mode virtual：同链剥回测段+加 virtual 段（开启实盘前同 config 冒烟用）。
// trading_mode 陷阱断言（memory clone-script-trading-mode-trap）。
// 只建行不启动（启动走 182 main.js start-experiment）；--dry 打印注入计划不写库。
//
// 用法：
//   node scripts/clone-experiment.cjs --src <expId> --name <新实验名> [--desc "..."] [--dry]
//                                     [--pack <策略包名|uuid>]（旧形状基底必填；新形状=换包）
//                                     [--mode live|virtual]（缺省=继承基底模式）
//                                     [--executor <executorId>] | [--reuse-wallet <expId>]（mode=live 必择一）
//                                     [--reserve-native 0.01] [--slippage 20] [--max-gas 10] [--max-position-tokens 0]
// 示例：
//   node scripts/clone-experiment.cjs --src c73b62be-... --name bt-v164-xxx-36h --dry
//   node scripts/clone-experiment.cjs --src <旧bt> --name bt-v164 --pack trading-standard-v1 --dry
//   node scripts/clone-experiment.cjs --src <bt> --name live-v75 --pack trading-standard-v1 --mode live --executor <id> --dry
// （dbManager 懒 require 在 main 内——单测 require 本模块纯函数零 DB 零副作用）

// ══ Tier2 live ops 标准段（docs/当前最优买卖策略.md「四、机制与实验配置」基准的
// 实验层部分；门链 enabled 已归策略包不在列）——唯一基准是 docs 文档，改这里必须
// 同步 docs。注入语义=段级一层深 merge（绝不单布尔顶段——浅合并陷阱：引擎
// _mergedWsConfig 嵌套对象整块替换，单布尔注入会顶掉 gate/memSource 子键）。══
const LIVE_STD_WS = {
  buySignalMaxPerToken: 15,        // docs：T110 默认帽 5 会截断 15 信号阶梯
  sellDebounceMinTicks: 5,         // 引擎缺省 0=纯时间门；丢 5-tick 双门=行为回退
  cheatCheck: {
    gate: { awaitMs: 60000, alwaysRecheck: true, activityExemptLevels: ['high'] },
    memSource: { enabled: false },
  },
  buyPointCheck: {
    gate: { awaitMs: 60000 },
    memSource: { enabled: false },
  },
  factorSellFilter: { enabled: true },  // 缺段=关=T157/T183/T186 卖保护全丢（docs 明言行为回退）
  factorParams: { netBuyWinTrades: 12 }, // 引擎内建 20；回测最优验证口径 12（单键 merge 保留基底其余键）
  accountHealthCheck: { enabled: true, firstWindowMin: 10, fastIntervalSec: 30, slowIntervalSec: 120 },
  observationSignals: { enabled: true, intervalMs: 60000, maxPerToken: 3, marketCapThreshold: 27 },
  signalGatePerTickEval: false,    // 2026-11-20 裁定：对齐回测 T154「debounce 是对的」形态
};
const LIVE_STD_TOP = {
  positionManagement: { perCardBNB: 0.05 },  // 张数在包腿上（cards:4）=0.2 BNB/笔四卡
};

function arg(k) {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** T202 已归包键剥离（纯函数，单测覆盖）：ws 段四 enabled 键 + 顶层 stallClose/
 * burstCooldown。克隆基底（旧形状实验）携带时剥除留痕——引擎读包不看这些键，
 * 剥离防混读与后续 web 层 400。 */
function stripPackOwnedKeys(cfg, changes) {
  for (const sec of ['fourmemeWs', 'flapWs', 'gangWs']) {
    const ws = cfg[sec];
    if (!ws || typeof ws !== 'object') continue;
    for (const seg of ['cheatCheck', 'buyPointCheck']) {
      const section = ws[seg];
      if (!section || typeof section !== 'object') continue;
      if ('enabled' in section) { delete section.enabled; changes.push('剥 ' + sec + '.' + seg + '.enabled（T202 归策略包）'); }
      if (seg === 'cheatCheck' && 'actFrontGate' in section) { delete section.actFrontGate; changes.push('剥 ' + sec + '.cheatCheck.actFrontGate（T202 归策略包）'); }
      if (seg === 'buyPointCheck' && section.factorCheck && typeof section.factorCheck === 'object'
        && 'enabled' in section.factorCheck) {
        delete section.factorCheck.enabled;
        changes.push('剥 ' + sec + '.buyPointCheck.factorCheck.enabled（T202 归策略包）');
      }
    }
  }
  if ('stallClose' in cfg) { delete cfg.stallClose; changes.push('剥顶层 stallClose（T202 归策略包 definition）'); }
  if ('burstCooldown' in cfg) { delete cfg.burstCooldown; changes.push('剥顶层 burstCooldown（T202 归策略包 definition）'); }
}

/** 策略包引用转换（纯函数，单测覆盖）：
 *  - base 有 strategyId 且未换包 → 保留（剥 strategyResolved 陈旧审计）
 *  - 换包/旧形状 → cfg.strategyId=packId，剥旧腿形状（buy/sellStrategies/libraryRefs）
 *  - stats/eventRecording/permanentBlockCondition 恒保留（实验层）
 * 返回 { strategyId, isLegacy } 供 main 打印。 */
function applyPackReference(cfg, packId, changes) {
  const legacy = !!(cfg.strategiesConfig
    && (Array.isArray(cfg.strategiesConfig.buyStrategies) || Array.isArray(cfg.strategiesConfig.sellStrategies)));
  if (cfg.strategyId) delete cfg.strategyResolved;
  if (packId) {
    cfg.strategyId = packId;
    changes.push('config.strategyId=' + packId + (legacy ? '（旧腿形状转换）' : '（换包）'));
  } else if (!cfg.strategyId) {
    throw new Error('基底为旧内嵌腿形状（strategiesConfig.buy/sellStrategies）——T202 后克隆必须 --pack <策略包名|uuid> 转换（旧腿不迁移不复制）');
  }
  if (legacy) {
    const sc = cfg.strategiesConfig;
    const n = (sc.buyStrategies || []).length + (sc.sellStrategies || []).length;
    delete sc.buyStrategies;
    delete sc.sellStrategies;
    if (Array.isArray(sc.libraryRefs)) delete sc.libraryRefs;
    changes.push('剥旧内嵌腿 ' + n + ' 条+libraryRefs（T202：腿唯一来源=策略包）');
  }
  return { strategyId: cfg.strategyId, isLegacy: legacy };
}

/** ws 段标准注入：LIVE_STD_WS 深一层 merge 进 cfg[sec]（gate/memSource/
 * observationSignals 等嵌套段单独 merge 保基底其余键），逐键留痕。纯函数（单测覆盖）。 */
function ensureLiveStandardSections(cfg, sec, changes) {
  cfg[sec] = cfg[sec] || {};
  const ws = cfg[sec];
  for (const [k, v] of Object.entries(LIVE_STD_WS)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const base = ws[k] || {};
      const merged = { ...base, ...v };
      // 二层嵌套段（gate/memSource）再 merge 一层保基底其余键
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

/** 模式转换链（纯函数，单测覆盖）：baseMode→targetMode 的段剥离/Tier2 ops 标准段/live 段注入。
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
    // 退化；剥键回落引擎 4000 waitIdle 帽=同语义不同实现，docs 生产/回测差异注记）
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

module.exports = { LIVE_STD_WS, LIVE_STD_TOP, ensureLiveStandardSections, convertMode, stripPackOwnedKeys, applyPackReference };

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const src = arg('src');
  const name = arg('name');
  const desc = arg('desc');
  const dry = process.argv.includes('--dry');
  const packArg = arg('pack');
  const modeArg = arg('mode');
  const executorId = arg('executor');
  const reuseWalletExp = arg('reuse-wallet');
  if (process.argv.includes('--no-gates')) {
    console.error('FATAL --no-gates 已随 T202 策略库二期废弃（门链启停归策略包 modules，克隆不再注入）');
    process.exit(1);
  }
  if (!src || !name) {
    console.error('用法: --src <expId> --name <名> [--desc ..] [--dry] [--pack <策略包名|uuid>]\n' +
      '                       [--mode live|virtual] [--executor <executorId> | --reuse-wallet <expId>]\n' +
      '                       [--reserve-native N] [--slippage N] [--max-gas N] [--max-position-tokens N]');
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

  // ── 策略包解析（--pack <name|uuid> → 最新版行；缺省沿用基底 strategyId）──
  let packId = null;
  if (packArg) {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const packQuery = c.from('strategy_library').select('id, name, version, definition').limit(1);
    const { data: packRows } = UUID_RE.test(packArg)
      ? await packQuery.eq('id', packArg)
      : await packQuery.eq('name', packArg);
    const row = (packRows || [])[0];
    if (!row) throw new Error('策略包不存在: ' + packArg + '（--pack 须为库内 name 或 uuid）');
    packId = row.id;
    const def = row.definition || {};
    const mods = Object.entries(def.modules || {}).map(([k, v]) => k + ':' + v).join(' ') || '无（四门全关）';
    console.log('策略包: ' + row.name + ' v' + row.version + ' | 买' + ((def.buyLegs || []).length) + '/卖' + ((def.sellLegs || []).length) + ' 腿' +
      ' | stallClose=' + (def.stallClose ? 'on' : 'off') + ' burstCooldown=' + (def.burstCooldown != null ? 'on' : 'off') +
      ' | modules=' + mods);
  }

  const changes = [];

  // ── T202 归包键剥离 + 策略包引用转换（旧形状必须 --pack，纯函数抛错 fail-fast）──
  stripPackOwnedKeys(cfg, changes);
  const packRef = applyPackReference(cfg, packId, changes);

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
      // / privateKey 密文（web-server 同款直拷）
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

  // ── 模式转换（Tier2 ops 标准段在内）──
  const conv = convertMode(cfg, baseMode, modeArg || null, { wallet, liveParams });
  const mode = conv.mode;
  for (const ch of conv.changes) changes.push(ch);

  // trading_mode 陷阱断言（memory clone-script-trading-mode-trap）：仅未转换时按基底断言
  if (!modeArg && mode === 'backtest') {
    if (!cfg.backtest) throw new Error('回测基底缺 backtest 段');
    if (!cfg.backtest.startTime || !cfg.backtest.endTime) throw new Error('回测基底缺 startTime/endTime（缺一 fail-fast 拒启）');
  }

  // ── 引用包存在性/版本核对（打印解析；缺包 fail-fast）──
  {
    const { data: lib } = await c.from('strategy_library')
      .select('name, version, definition').eq('id', cfg.strategyId).single();
    if (!lib) throw new Error('产物 config.strategyId 在 strategy_library 无对应策略包（可能已删）: ' + cfg.strategyId);
    const def = lib.definition || {};
    const mods = Object.entries(def.modules || {}).map(([k, v]) => k + ':' + v).join(' ') || '无（四门全关）';
    console.log('引用策略包: ' + lib.name + ' v' + lib.version + ' | 买' + ((def.buyLegs || []).length) + '/卖' + ((def.sellLegs || []).length) + ' 腿' +
      ' | stallClose=' + (def.stallClose ? 'on' : 'off') + ' burstCooldown=' + (def.burstCooldown != null ? 'on' : 'off') +
      ' | modules=' + mods);
  }

  console.log('基底:', e.experiment_name, '| mode:', baseMode + (modeArg ? ' → ' + mode : ''), '| platform:', cfg.platform);
  console.log('窗口:', cfg.backtest ? cfg.backtest.startTime + ' ~ ' + cfg.backtest.endTime : '(非回测)');
  console.log('策略: strategyId=' + cfg.strategyId + (packRef.isLegacy ? '（旧形状转换）' : ''));
  console.log('修正 ' + changes.length + ' 处' + (changes.length ? '：\n  - ' + changes.join('\n  - ') : '（零改动）'));

  if (mode === 'live') {
    console.log('\n━━ 启动前 checklist（docs/live-acceptance-runbook.md）━━');
    console.log('  1. 查持仓：历史 live 钱包链上 balanceOf 终裁，残余先处置（live-restart-positions-check 纪律）');
    console.log('  2. 0.001 BNB 验收闭环（新钱包/执行器时必做，runbook §2）');
    console.log('  3. 启动（182 screen）: node main.js start-experiment -e <新id>（run-engine 拒 live）');
    console.log('  4. 启动日志核对「📦 策略包解析」+「⛓ 门链配置」汇总行 + 名单装载行（cheat-crew/famous/smartmoney）');
  }
  if (dry) {
    if (mode === 'live') {
      const plat = cfg.platform || 'fourmeme';
      const sec = plat === 'flap' ? 'flapWs' : plat === 'gang' ? 'gangWs' : 'fourmemeWs';
      console.log('\n===CONFIG_JSON===');
      console.log(JSON.stringify({
        trading_mode: mode,
        strategyId: cfg.strategyId || null,
        wallet: cfg.wallet ? { address: cfg.wallet.address, executorId: cfg.wallet.executorId || null } : null,
        [sec]: cfg[sec],
        positionManagement: cfg.positionManagement || null,
      }, null, 2));
    }
    console.log('[dry] 未写库'); process.exit(0);
  }
  const row = {
    id: crypto.randomUUID(),
    experiment_name: name,
    experiment_description: desc || ('克隆自 ' + e.experiment_name + '（' + src + '），策略包引用/归包键剥离经 clone-experiment.cjs' + (changes.length ? '：' + changes.join('；') : '（零改动）')),
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
