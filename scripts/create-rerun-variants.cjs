#!/usr/bin/env node
// ============================================================================
// TPA wallet 口径修复后重跑 + lag 门/earlyTradesUniqueWallets 对照建臂（2026-10-10）
//
// 背景：二期（commit 9d18253）TPA 链路 + wallet_offline_profiles 画像库整套切
// sender（wallet）口径，画像库 columnsTag MISS 全量重建后，重跑两实验对拍
// TPA 因子变化；另按用户裁定做两个买门对照：
//   ①「我非常质疑购买条件中 earlyReturn >= 100 是否还有效果……倾向于尽可能早的
//     购入代币，而不是需要一些盘面的确认信息。我的想法是去掉这个条件」——
//     earlyReturn >= 100 是 lag 门 (narrativeCorpusLagSec < 300 OR earlyReturn >= 100)
//     的 OR 右臂（晚票的盘面确认证据）。去掉右臂 = lag>=300 晚票全拦（收紧，
//     与意图相反）；去整条 = 晚票不再要盘面确认（与「尽可能早买入」一致）→ C 臂去整条。
//   ②「earlyTradesUniqueWallets 也是同理，看看是否适合放宽」——D 臂 15→10 / 15→5。
//
// 臂定义（全部 backtest，与源实验同窗口同源 bit-identical）：
//   b1  复刻 e15401a9（三门窗口 2 基底 R0b：src=a21fa102，10-08 14:37→10-10 04:58）
//       —— 对拍基线：源实验净额 -0.9893 BNB（22 票，胜率 22.7%），差分 = 纯 TPA 库切换
//   b2  复刻 3e57ed75（三门验证 G1低名+G7slope+G4bundler：src=36a2c12a，10-04→10-08）
//   c   b1 + pbc 去掉整条 lag 门子句（narrativeCorpusLagSec 与 earlyReturn 两键全退场）
//   d10 b1 + pbc 的 earlyTradesUniqueWallets >= 15 → >= 10
//   d5  b1 + earlyTradesUniqueWallets >= 15 → >= 5
//   gm  b2 基础 + tokenScore 门加 OR 豁免臂 + gmgnFilter{enabled,exemptPct}（2026-10-11
//       用户裁定：GMGN 用户不参与 TPA 分数——触发门/top20 剔除 + 占比达标主导盘豁免；
//       exemptPct 须 tmp_gmgn_dryrun_b2 预演定档后 --gm-pct 显式传入，all 不含 gm）
//
// 叙事缓存：两窗口 J1.29 口径缓存均已落（R0b/载体门臂真调落缓存），全部臂
// 缓存命中零 Jev 真调 → 各臂叙事口径一致，差分纯来自画像库/门子句。
// 跑序无依赖，可串行跑；⚠️ 必须等画像库重建完成 + 删死行之后再启动 run-engine
// （回测启动时读画像库，混杂期数据脏）。
//
// 用法（182）：node scripts/create-rerun-variants.cjs --arm all|b1|b2|c|d10|d5|t22|t20|tnone|notpa|mh8|gm|v0|e50|eno|enl|ec0|pf0|pr1|pr2|tb0 [--gm-pct <50-100>] [--commit]
//   默认 dry-run 打印各臂 diff 摘要；--commit 真建。gm 臂须显式 --gm-pct（dry-run 定档值）。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const E15401A9 = 'e15401a9-ddf9-4760-8ecc-b7b7b75815bc'; // 窗口 2 基底 R0b
const E3E57ED75 = '3e57ed75-133e-497d-b8c8-b190eca2a6b8'; // 窗口 1 三门臂
const ETNONE = '37bd7349-b3b7-4fb5-80af-f9f81615349c'; // 窗口 1 去TPA门臂（2026-10-11 消融链基底）
const EPERF16 = '598a1a73-c509-499e-99f3-326991b9b75a'; // perf16（2026-10-12 perf 链终点，代码=80a591e P15）

// lag 门整条子句（含前导 AND，与源 pbc 逐字对齐）
const LAG_CLAUSE = ' AND (narrativeCorpusLagSec < 300 OR earlyReturn >= 100)';
const UW_OLD = 'earlyTradesUniqueWallets >= 15';
// TPA tokenScore 门（condition 内；t 臂 2026-10-11 追加：wallet 口径拆散 GMGN 合并像后
// 分布整体下移——3.5+ 档 1223→259、approve 率 64.6%→46.5%，2.5 门等效变严，重校准对照）
const TS_OLD = 'TPAPre_tokenScore > 2.5';
// tokenScore 门整条子句（含前导 AND，tnote 去除用；TPA 机制照跑落表，仅不拦买）
const TS_CLAUSE = ' AND TPAPre_tokenScore > 2.5';
// minHolders 触发门（tokenPositionAnalyzer.trigger 内；mh 臂 2026-10-11 追加：
// wallet 口径 holderCount 膨胀致触发提前——1293 票提前触发 + 889 票独有触发 tc p50=11
// 刚过 tradeCount 门就触发、画像窗口极短 miss 增多，4→8 翻倍推迟到真实买家更多时）
const MH_OLD = 4;
// GMGN 豁免臂（gm，2026-10-11 用户裁定）：TPAPre_tokenScore 门加 OR 豁免臂 + gmgnFilter 开启。
//   TS 门替换为 (TS_OLD OR TPAPre_gmgnExempt == 1)——GMGN 主导盘（占比 ≥ exemptPct 量加权）
//   verdict 改写 approve 放行；exemptPct 由 tmp_gmgn_dryrun_b2 预演定档（--gm-pct 必传）。
const TS_EXEMPT = '(TPAPre_tokenScore > 2.5 OR TPAPre_gmgnExempt == 1)';

// ── pbc 门消融臂（2026-10-11 用户裁定，基底=tnone：删 covered/top1 + router 放宽 → er 变体）──
// 门消融数据（tnone 11,106 评估 metadata 重判）：covered 首拦=0（tokenAgeSec<90 保证恒 1，死代码）、
// top1 唯一阻断=0（纯冗余）、router 唯一阻断 30 token maxRet p50 124.6%（与实买票 192% 同档）→ 放宽
// 50→30（[30,50) 质量好且与 9-30 先验冲突最小）；er 右臂直接证据 lag>=300 组 36 票 +11.12 胜率 78%，
// 但右臂强制等 er 涨到 100% 才进场 = 进场价 ≥ 出生价×2（用户裁定：折扣不小要回测定档）。
const TOP1_CLAUSE = ' AND earlyTradesTop1BuySharePct < 60';
const COVERED_CLAUSE = ' AND earlyTradesTop1BuyCovered == 1';
const ROUTER_OLD = 'earlyTradesRouterPct >= 50';
const ER_OLD = 'earlyReturn >= 100';
// 买腿 cycle 冷档门子句（ec0 臂 2026-10-11：用户裁定 tokenCycle 机制已算废除——卖侧
// 路由腿已全无 groups，机制只剩此买侧子句 + enforce 开关；删子句 + 删 config 段 = 彻底关，
// v0 vs ec0 差分 = 冷档门纯效应）
const CYCLE_CLAUSE = ' AND (tokenCycle != 1 OR tokenCycle IS NULL)';
/** tnone 源 pbc → v0 基线（删 top1/covered 子句 + router 50→30），返回新 pbc */
function pbcToV0(pbc) {
    for (const c of [TOP1_CLAUSE, COVERED_CLAUSE]) {
        if (!pbc.includes(c)) throw new Error('源 pbc 未含子句（替换落空防静默）: ' + c);
        pbc = pbc.replace(c, '');
    }
    if (!pbc.includes(ROUTER_OLD)) throw new Error('源 pbc 未含 ' + ROUTER_OLD);
    return pbc.replace(ROUTER_OLD, 'earlyTradesRouterPct >= 30');
}

const ARMS = {
    b1: { src: E15401A9, suffix: '-TPAwallet重跑', desc: 'TPA wallet 口径修复后重跑（b1）' },
    b2: { src: E3E57ED75, suffix: '-TPAwallet重跑', desc: 'TPA wallet 口径修复后重跑（b2）' },
    c: { src: E15401A9, suffix: '-去lag门', desc: 'lag 门整条去除对照臂（c）' },
    d10: { src: E15401A9, suffix: '-uw10', desc: 'earlyTradesUniqueWallets 15→10 放宽臂（d10）' },
    d5: { src: E15401A9, suffix: '-uw5', desc: 'earlyTradesUniqueWallets 15→5 放宽臂（d5）' },
    t22: { src: E3E57ED75, suffix: '-tpa22', desc: 'TPA tokenScore 门 2.5→2.2 降档臂（t22，与中性分对齐）' },
    t20: { src: E3E57ED75, suffix: '-tpa20', desc: 'TPA tokenScore 门 2.5→2.0 降档臂（t20，夹逼下界）' },
    tnone: { src: E3E57ED75, suffix: '-去TPA门', desc: '去 TPA tokenScore 门整条臂（tnone，TPA 照跑落表仅不拦买）' },
    notpa: { src: E3E57ED75, suffix: '-不激活TPA', desc: 'TPA 模块整体不激活臂（notpa，config 删 tokenPositionAnalyzer 段+condition 删 TPAPre 子句）' },
    mh8: { src: E3E57ED75, suffix: '-mh8', desc: 'TPA 触发门 minHolders 4→8 臂（mh8，推迟触发等画像更全）' },
    gm: { src: E3E57ED75, suffix: '-gmgn豁免', desc: 'TPA GMGN 用户剔除+主导盘豁免臂（gm）' },
    v0: { src: ETNONE, suffix: '-门基线v0', desc: 'pbc 门基线 v0（删 covered/top1 + router 50→30）' },
    e50: { src: ETNONE, suffix: '-er50', desc: 'v0 + lag 门右臂 earlyReturn 100→50（更早进场）' },
    eno: { src: ETNONE, suffix: '-去er右臂', desc: 'v0 + lag 门删右臂（lag<300 单臂，晚票全拦）' },
    enl: { src: ETNONE, suffix: '-去lag门整条', desc: 'v0 + lag 门整条去除（时间锚与 er 全不筛）' },
    ec0: { src: ETNONE, suffix: '-去cycle门', desc: 'v0 + condition 删 cycle 子句 + config 删 tokenCycle 段（cycle 门纯效应）' },
    pf0: { src: ETNONE, suffix: '-pf验证', desc: 'v0 + backtest.faPreFilter=true（P2-1 双跑验证：超龄未持仓 tick 跳过因子构建，开/关 trades 须 bit-identical）' },
    perf: { src: ETNONE, suffix: '-perf基准', desc: '性能基准臂（v0 config 逐字复刻：P1 探针 + P2a/b/c + 叙事预载 + preFilter 修复后首次实跑；对拍 5517e3db=同 config 旧代码 64.4min/129.97 万 tick）' },
    perf2: { src: ETNONE, suffix: '-perf2快照缓存', desc: '性能臂二代（2026-10-12：perf config + AVE 同名搜索 TTL 缓存 300s + 快照化代码 b5eccae。perf 实测定因：preBuy 拦截 token 每 fire 重走全链，AVE 实时搜索 ~2.7×调用量成主耗时；TTL 内同 symbol 复用搜索结果省 95%+ 网络往返，同 symbol 窗口内数据一致=回测决定性更强）' },
    // ── P17/P18 验证臂（2026-10-13，源=perf16；pr1 逐字克隆 / pr2·tb0 cycle 手术，见 main 里独立分支）──
    pr1: { src: EPERF16, suffix: '-pr1-P17prune', desc: 'P17 虚拟时钟 prune 对拍臂（perf16 config 逐字复刻，唯一变量=代码 80a591e→HEAD：P5 死删+P17 prune+P18 关侧三批联合；验收=trades/signals 对拍 perf16 bit 一致 + --max-old-space-size=2048 全窗存活（此前 2G 双崩）+ faPruned>0）' },
    pr2: { src: EPERF16, suffix: '-pr2-去cycle基底', desc: 'P18 验证基底臂（perf16 config − cycle 冷档门子句 − tokenCycle 段=ec0 同款手术；对拍 tb0 的 skip 关侧；经 pr1 中性验证后 vs perf16 = cycle 门纯效应，恰好补上卡死 initializing 的 ec0）' },
    tb0: { src: EPERF16, suffix: '-tb0-P18tickBuildSkip', desc: 'P18 tick 路径 build 条件化对拍臂（pr2 + backtest.tickBuildSkip=true；与 pr2 同代码同 config 唯一差异=开关，trades/signals bit 一致后翻默认 true。perf16 原 config 直引 tokenCycle+enforce=true 与 skip 启动互斥（latch candidateSince 置位依赖 build 调用史），故用去 cycle 基底）' },
};

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const armIdx = args.indexOf('--arm');
const ARM = armIdx > -1 ? args[armIdx + 1] : 'all';
if (ARM !== 'all' && !Object.keys(ARMS).includes(ARM)) {
    throw new Error('--arm 只接受 all|' + Object.keys(ARMS).join('|') + '，收到: ' + ARM);
}
// gm 臂 exemptPct（dry-run 定档）：'all' 不含 gm（防误建未定档臂），单建 gm 须显式传
const GM_PCT_IDX = args.indexOf('--gm-pct');
const GM_PCT = GM_PCT_IDX > -1 ? Number(args[GM_PCT_IDX + 1]) : null;
if (ARM === 'gm') {
    if (!Number.isFinite(GM_PCT) || GM_PCT < 50 || GM_PCT > 100) {
        throw new Error('gm 臂须 --gm-pct <50-100>（tmp_gmgn_dryrun_b2 定档值）');
    }
}

/** 还原 name/description 后 JSON 串（diff 校验用） */
function strip(cfg) {
    const s = JSON.parse(JSON.stringify(cfg));
    delete s.name;
    delete s.description;
    return JSON.stringify(s);
}

async function main() {
    const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
    const factory = ExperimentFactory.getInstance();
    const [srcA, srcB, srcT, srcP] = await Promise.all([
        factory.load(E15401A9), factory.load(E3E57ED75), factory.load(ETNONE), factory.load(EPERF16),
    ]);
    if (!srcA) throw new Error('源实验不存在: ' + E15401A9);
    if (!srcB) throw new Error('源实验不存在: ' + E3E57ED75);
    if (!srcT) throw new Error('源实验不存在: ' + ETNONE);
    if (!srcP) throw new Error('源实验不存在: ' + EPERF16);

    const toRun = ARM === 'all' ? Object.keys(ARMS).filter(a => a !== 'gm' && a !== 'perf' && a !== 'perf2' && a !== 'pr1' && a !== 'pr2' && a !== 'tb0') : [ARM]; // all 不含 gm（须单建+定档）/perf/perf2/pr1/pr2/tb0（须单建）
    const created = [];

    for (const arm of toRun) {
        const def = ARMS[arm];
        const src = def.src === E15401A9 ? srcA : (def.src === ETNONE ? srcT : (def.src === EPERF16 ? srcP : srcB));
        const cfg = JSON.parse(JSON.stringify(src.config));
        const buy = cfg.strategiesConfig.buyStrategies[0];
        const origPbc = buy.preBuyCheckCondition;

        if (arm === 'c') {
            if (!origPbc.includes(LAG_CLAUSE)) {
                throw new Error(`[${arm}] 源 pbc 未含 lag 门子句（替换落空防静默），pbc=${origPbc}`);
            }
            buy.preBuyCheckCondition = origPbc.replace(LAG_CLAUSE, '');
            if (buy.preBuyCheckCondition.includes('narrativeCorpusLagSec')
                || buy.preBuyCheckCondition === origPbc) {
                throw new Error(`[${arm}] lag 门子句替换后校验失败`);
            }
        } else if (arm === 'd10' || arm === 'd5') {
            if (!origPbc.includes(UW_OLD)) {
                throw new Error(`[${arm}] 源 pbc 未含 ${UW_OLD}（替换落空防静默），pbc=${origPbc}`);
            }
            buy.preBuyCheckCondition = origPbc.replace(UW_OLD,
                'earlyTradesUniqueWallets >= ' + (arm === 'd10' ? '10' : '5'));
        } else if (arm === 't22' || arm === 't20') {
            if (!buy.condition.includes(TS_OLD)) {
                throw new Error(`[${arm}] 源 condition 未含 ${TS_OLD}（替换落空防静默），condition=${buy.condition}`);
            }
            buy.condition = buy.condition.replace(TS_OLD,
                'TPAPre_tokenScore > ' + (arm === 't22' ? '2.2' : '2.0'));
        } else if (arm === 'tnone') {
            if (!buy.condition.includes(TS_CLAUSE)) {
                throw new Error(`[${arm}] 源 condition 未含 tokenScore 门整条（替换落空防静默），condition=${buy.condition}`);
            }
            buy.condition = buy.condition.replace(TS_CLAUSE, '');
            if (buy.condition.includes('TPAPre_tokenScore') || buy.condition === src.config.strategiesConfig.buyStrategies[0].condition) {
                throw new Error(`[${arm}] tokenScore 门整条去除后校验失败`);
            }
        } else if (arm === 'notpa') {
            // 2026-10-11 用户裁定：tokenScore 分桶矩阵各段胜率 70-88% 趋平无区分度，
            // 倾向整体不激活 TPA——config 删段（零构造/零触发/零落表/零画像现算）
            // + condition 删 TPAPre 子句（tnone 同款删法，防未知因子拒启）。
            if (!buy.condition.includes(TS_CLAUSE)) {
                throw new Error(`[${arm}] 源 condition 未含 tokenScore 门整条（替换落空防静默），condition=${buy.condition}`);
            }
            buy.condition = buy.condition.replace(TS_CLAUSE, '');
            if (buy.condition.includes('TPAPre_') || !cfg.tokenPositionAnalyzer) {
                throw new Error(`[${arm}] 校验失败：condition 残留 TPAPre_ 或源 config 无 tokenPositionAnalyzer 段`);
            }
            delete cfg.tokenPositionAnalyzer;
        } else if (arm === 'mh8') {
            const trig = cfg.tokenPositionAnalyzer && cfg.tokenPositionAnalyzer.trigger;
            if (!trig || trig.minHolders !== MH_OLD) {
                throw new Error(`[${arm}] 源 trigger.minHolders != ${MH_OLD}（替换落空防静默），trigger=${JSON.stringify(trig)}`);
            }
            trig.minHolders = 8;
        } else if (arm === 'gm') {
            // ① condition：tokenScore 门加 OR 豁免臂（括号防优先级歧义）
            if (!buy.condition.includes(TS_OLD)) {
                throw new Error(`[${arm}] 源 condition 未含 ${TS_OLD}（替换落空防静默），condition=${buy.condition}`);
            }
            buy.condition = buy.condition.replace(TS_OLD, TS_EXEMPT);
            if (!buy.condition.includes('TPAPre_gmgnExempt == 1')) {
                throw new Error(`[${arm}] 豁免臂替换后校验失败`);
            }
            // ② tokenPositionAnalyzer.gmgnFilter 开启（触发门剔除 + top20 剔除 + 主导盘豁免）
            if (!cfg.tokenPositionAnalyzer || !cfg.tokenPositionAnalyzer.trigger) {
                throw new Error(`[${arm}] 源 config 无 tokenPositionAnalyzer.trigger 段`);
            }
            cfg.tokenPositionAnalyzer.gmgnFilter = { enabled: true, exemptPct: GM_PCT };
        } else if (arm === 'v0' || arm === 'perf' || arm === 'perf2' || arm === 'e50' || arm === 'eno' || arm === 'enl') {
            // pbc 门消融链（2026-10-11 用户裁定）：v0=删 covered/top1 + router 50→30；
            // e50/eno/enl 在 v0 上叠加 er 变体。源=tnone（去 TPA 门，pbc 与 3e57ed75 逐字同）。
            // perf=v0 config 逐字复刻（2026-10-12 性能基准臂：唯一变量 = 代码版本）。
            if (buy.condition.includes('TPAPre_tokenScore')) {
                throw new Error(`[${arm}] 源应为 tnone（condition 无 TPA 门），condition=${buy.condition}`);
            }
            let pbc = pbcToV0(origPbc);
            if (arm === 'e50') {
                if (!pbc.includes(ER_OLD)) throw new Error(`[${arm}] pbc 未含 ${ER_OLD}`);
                pbc = pbc.replace(ER_OLD, 'earlyReturn >= 50');
            } else if (arm === 'eno') {
                if (!pbc.includes(LAG_CLAUSE)) throw new Error(`[${arm}] pbc 未含 lag 门子句`);
                pbc = pbc.replace(LAG_CLAUSE, ' AND (narrativeCorpusLagSec < 300)');
                if (pbc.includes('earlyReturn')) throw new Error(`[${arm}] eno 后 pbc 残留 earlyReturn`);
            } else if (arm === 'enl') {
                if (!pbc.includes(LAG_CLAUSE)) throw new Error(`[${arm}] pbc 未含 lag 门子句`);
                pbc = pbc.replace(LAG_CLAUSE, '');
                if (pbc.includes('narrativeCorpusLagSec') || pbc.includes('earlyReturn')) {
                    throw new Error(`[${arm}] enl 后 pbc 残留 lag/er 键`);
                }
            }
            if (pbc.includes('earlyTradesTop1Buy') || pbc.includes(ROUTER_OLD)) {
                throw new Error(`[${arm}] v0 基线校验失败（top1/covered/router 残留）`);
            }
            buy.preBuyCheckCondition = pbc;
            if (arm === 'perf2') {
                // 唯一增量变量：AVE 同名搜索 TTL 缓存（perf 臂定因——AVE 实时调用
                // ~2.7× 是主耗时；TTL 300s 同 symbol 复用原始搜索结果，行级
                // 发布前过滤仍 per-token 重跑，缓存后过滤=语义不变）
                cfg.preBuyCheck = { ...(cfg.preBuyCheck || {}), sameNameSearchCacheTtlSec: 300 };
            }
        } else if (arm === 'ec0') {
            // cycle 门纯效应臂：v0 的 pbc + condition 删 cycle 子句 + config 删 tokenCycle 段。
            // 卖腿 5 条 condition 均不引用 tokenCycle（2026-10-11 查证）→ 删段对卖腿零影响。
            if (buy.condition.includes('TPAPre_tokenScore')) {
                throw new Error(`[${arm}] 源应为 tnone（condition 无 TPA 门），condition=${buy.condition}`);
            }
            if (!buy.condition.includes(CYCLE_CLAUSE)) {
                throw new Error(`[${arm}] 源 condition 未含 cycle 子句（替换落空防静默），condition=${buy.condition}`);
            }
            buy.condition = buy.condition.replace(CYCLE_CLAUSE, '');
            if (buy.condition.includes('tokenCycle') || !cfg.tokenCycle) {
                throw new Error(`[${arm}] 校验失败：condition 残留 tokenCycle 或源 config 无 tokenCycle 段`);
            }
            delete cfg.tokenCycle;
            const pbc = pbcToV0(origPbc);
            if (pbc.includes('earlyTradesTop1Buy') || pbc.includes(ROUTER_OLD)) {
                throw new Error(`[${arm}] v0 基线校验失败（top1/covered/router 残留）`);
            }
            buy.preBuyCheckCondition = pbc;
        } else if (arm === 'pf0') {
            // P2-1 双跑验证臂（2026-10-12）：v0 的 pbc/condition 逐字同 + backtest.faPreFilter=true。
            // FA preFilter 默认关（红线注释：跳过连带跳过 TPA 触发与 cycle latch 推进 = 决策
            // 行为变化，开启前须开/关双跑 trades 一致）。本臂即「开」侧，对拍 v0（关侧）。
            if (buy.condition.includes('TPAPre_tokenScore')) {
                throw new Error(`[${arm}] 源应为 tnone（condition 无 TPA 门），condition=${buy.condition}`);
            }
            if (!cfg.backtest) throw new Error(`[${arm}] 源 config 无 backtest 段`);
            const pbc = pbcToV0(origPbc);
            if (pbc.includes('earlyTradesTop1Buy') || pbc.includes(ROUTER_OLD)) {
                throw new Error(`[${arm}] v0 基线校验失败（top1/covered/router 残留）`);
            }
            buy.preBuyCheckCondition = pbc;
            cfg.backtest.faPreFilter = true;
        } else if (arm === 'pr1' || arm === 'pr2' || arm === 'tb0') {
            // P17/P18 验证臂（2026-10-13）：
            //   pr1 = perf16 config 逐字克隆零改动——唯一变量=代码版本（80a591e→HEAD，
            //         P5 死删+P17 prune+P18 关侧三批联合中性验证，对拍 perf16）
            //   pr2 = perf16 − cycle 冷档门子句 − tokenCycle 段（ec0 同款手术）——
            //         tb0 的 skip 关侧基底；perf16 直引 tokenCycle 且 enforce=true，
            //         与 tickBuildSkip 启动互斥（latch candidateSince 置位依赖 build
            //         调用史，直引下 skip 与全量不可 bit 一致）
            //   tb0 = pr2 + backtest.tickBuildSkip=true——与 pr2 唯一差异=开关，
            //         bit 一致后翻默认；pr2 vs perf16（经 pr1 中性验证）= cycle 门纯效应
            if (!cfg.backtest) throw new Error(`[${arm}] 源 config 无 backtest 段`);
            if (arm !== 'pr1') {
                if (!buy.condition.includes(CYCLE_CLAUSE)) {
                    throw new Error(`[${arm}] 源 condition 未含 cycle 子句（替换落空防静默），condition=${buy.condition}`);
                }
                buy.condition = buy.condition.replace(CYCLE_CLAUSE, '');
                if (buy.condition.includes('tokenCycle') || !cfg.tokenCycle) {
                    throw new Error(`[${arm}] 校验失败：condition 残留 tokenCycle 或源 config 无 tokenCycle 段`);
                }
                delete cfg.tokenCycle;
                if (arm === 'tb0') {
                    if (cfg.backtest.tickBuildSkip !== undefined) {
                        throw new Error(`[${arm}] 源 backtest 已含 tickBuildSkip（意外形状防静默覆盖）`);
                    }
                    cfg.backtest.tickBuildSkip = true;
                }
            }
        }

        // diff 校验：b1/b2 与源零差异；c/d10/d5 除 pbc 外零差异；t22/t20 除 condition 外零差异
        const chk = JSON.parse(JSON.stringify(cfg));
        delete chk.name; delete chk.description;
        if (arm === 'b1' || arm === 'b2' || arm === 'pr1') {
            if (JSON.stringify(chk) !== JSON.stringify((({ name, description, ...rest }) => rest)(src.config))) {
                throw new Error(`[${arm}] 与源实验差异超出 name/description——应零差异`);
            }
        } else {
            const base = JSON.parse(JSON.stringify(src.config));
            delete base.name; delete base.description;
            if (arm === 'c' || arm === 'd10' || arm === 'd5') {
                base.strategiesConfig.buyStrategies[0].preBuyCheckCondition = buy.preBuyCheckCondition;
            } else if (arm === 'mh8') { // 差异仅 trigger.minHolders
                base.tokenPositionAnalyzer.trigger.minHolders = 8;
            } else if (arm === 'notpa') { // 差异仅 condition + 删 tokenPositionAnalyzer 段
                base.strategiesConfig.buyStrategies[0].condition = buy.condition;
                delete base.tokenPositionAnalyzer;
            } else if (arm === 'ec0') { // 差异仅 pbc + condition + 删 tokenCycle 段
                base.strategiesConfig.buyStrategies[0].preBuyCheckCondition = buy.preBuyCheckCondition;
                base.strategiesConfig.buyStrategies[0].condition = buy.condition;
                delete base.tokenCycle;
            } else if (arm === 'pf0') { // 差异仅 pbc + backtest.faPreFilter
                base.strategiesConfig.buyStrategies[0].preBuyCheckCondition = buy.preBuyCheckCondition;
                base.backtest.faPreFilter = true;
            } else if (arm === 'gm') { // 差异仅 condition + gmgnFilter
                base.strategiesConfig.buyStrategies[0].condition = buy.condition;
                base.tokenPositionAnalyzer.gmgnFilter = { enabled: true, exemptPct: GM_PCT };
            } else if (arm === 'v0' || arm === 'perf' || arm === 'e50' || arm === 'eno' || arm === 'enl') { // 差异仅 pbc
                base.strategiesConfig.buyStrategies[0].preBuyCheckCondition = buy.preBuyCheckCondition;
            } else if (arm === 'perf2') { // 差异仅 pbc + preBuyCheck.sameNameSearchCacheTtlSec
                base.strategiesConfig.buyStrategies[0].preBuyCheckCondition = buy.preBuyCheckCondition;
                base.preBuyCheck = { ...(base.preBuyCheck || {}), sameNameSearchCacheTtlSec: 300 };
            } else if (arm === 'pr2') { // 差异仅 condition 删 cycle 子句 + 删 tokenCycle 段
                base.strategiesConfig.buyStrategies[0].condition = buy.condition;
                delete base.tokenCycle;
            } else if (arm === 'tb0') { // 差异仅 pr2 手术 + backtest.tickBuildSkip
                base.strategiesConfig.buyStrategies[0].condition = buy.condition;
                delete base.tokenCycle;
                base.backtest.tickBuildSkip = true;
            } else { // t22/t20/tnone：差异仅 condition
                base.strategiesConfig.buyStrategies[0].condition = buy.condition;
            }
            if (JSON.stringify(chk) !== JSON.stringify(base)) {
                const field = (arm === 'c' || arm === 'd10' || arm === 'd5' || arm === 'v0' || arm === 'perf' || arm === 'e50' || arm === 'eno' || arm === 'enl') ? 'pbc'
                    : (arm === 'mh8' ? 'trigger.minHolders'
                        : (arm === 'notpa' ? 'condition+去tokenPositionAnalyzer段'
                            : (arm === 'ec0' ? 'pbc+condition+去tokenCycle段'
                                : (arm === 'pf0' ? 'pbc+faPreFilter'
                                : (arm === 'perf2' ? 'pbc+sameNameTTL'
                                : (arm === 'pr2' ? 'condition+去tokenCycle段'
                                : (arm === 'tb0' ? 'condition+去tokenCycle段+tickBuildSkip'
                                : (arm === 'gm' ? 'condition+gmgnFilter' : 'condition'))))))));
                require('fs').writeFileSync(`/tmp/arm_diff_chk_${arm}.json`, JSON.stringify(chk, null, 1));
                require('fs').writeFileSync(`/tmp/arm_diff_base_${arm}.json`, JSON.stringify(base, null, 1));
                throw new Error(`[${arm}] 与源实验差异超出 name/description/${field}——应零差异（两侧已写 /tmp/arm_diff_{chk,base}_${arm}.json 可 diff）`);
            }
        }

        cfg.name = (src.config.name || src.config.experiment_name || '回测') + def.suffix;
        if (arm === 'pr1' || arm === 'pr2' || arm === 'tb0') {
            const shape = arm === 'pr1'
                ? 'bit-identical 逐字复刻'
                : (arm === 'pr2' ? '去 cycle 手术（− 冷档门子句 − tokenCycle 段）'
                    : '去 cycle 手术 + 唯一增量 backtest.tickBuildSkip=true');
            cfg.description = `${def.desc}（perf16 config ${shape}；跑法 NODE_OPTIONS=--max-old-space-size=2048 node src/run-engine.js <id>）`;
        } else {
        cfg.description = `${def.desc}：源 ${def.src} config ` + (arm === 'b1' || arm === 'b2'
            ? 'bit-identical（同窗口同源），唯一变量 = TPA 链路+画像库二期切 wallet 口径（9d18253）'
            : (arm === 'c'
                ? '去 lag 门整条 (narrativeCorpusLagSec < 300 OR earlyReturn >= 100)——晚票不再要盘面确认（用户裁定 2026-10-10）'
                : (arm === 't22' || arm === 't20'
                    ? `condition ${TS_OLD} 降档（用户裁定 2026-10-11：wallet 口径分布下移致 2.5 门等效变严，重校准对照）`
                    : (arm === 'tnone'
                        ? `condition 去 ${TS_OLD} 整条（用户裁定 2026-10-11：TPA 照跑落表仅不拦买）`
                        : (arm === 'notpa'
                            ? `config 删 tokenPositionAnalyzer 段（TPA 不构造）+ condition 删 TPAPre 子句（用户裁定 2026-10-11：分桶矩阵分数无区分度，整体不激活对照）`
                            : (arm === 'mh8'
                            ? `TPA 触发门 minHolders 4→8（用户裁定 2026-10-11：wallet 口径触发提前画像窗口过短）`
                            : (arm === 'gm'
                                ? `condition ${TS_OLD} → (… OR TPAPre_gmgnExempt == 1) + gmgnFilter{enabled,exemptPct:${GM_PCT}}（用户裁定 2026-10-11：GMGN 用户剔除+主导盘豁免；触发门/top20 剔除+占比 ≥${GM_PCT}% verdict 改写 approve）`
                                : (arm === 'v0'
                                    ? 'pbc 删 covered（死代码，首拦=0）+ 删 top1（唯一阻断=0 纯冗余）+ router 50→30（唯一阻断 30 token maxRet p50 124.6% 与实买票同档）（用户裁定 2026-10-11）'
                                    : (arm === 'e50'
                                        ? 'v0 基础 + lag 门右臂 earlyReturn >= 100 → >= 50：lag>=300 晚票更早进场（用户裁定 2026-10-11：er>=100 等待期进场价 ≥ 出生价×2 折扣不小）'
                                        : (arm === 'eno'
                                            ? 'v0 基础 + lag 门删右臂：lag<300 单臂（lag null fail-closed 拦），lag>=300 晚票全拦对照'
                                            : (arm === 'enl'
                                                ? 'v0 基础 + lag 门整条去除：时间锚与 er 均不筛（c 臂同款删法，新基线上重测）'
                                                : (arm === 'ec0'
                                                    ? 'v0 基础 + condition 删 (tokenCycle != 1 OR tokenCycle IS NULL) + config 删 tokenCycle 段（用户裁定 2026-10-11：机制已算废除，卖侧无 groups 仅剩买侧此门；v0 vs ec0 差分 = cycle 门纯效应）'
                                                    : (arm === 'pf0'
                                                        ? 'v0 基础 + backtest.faPreFilter=true（2026-10-12 P2-1 双跑验证：超龄未持仓 tick 跳过因子构建；v0=关侧对照，trades 须 bit-identical + TPA 行数差 = 超龄触发损失面）'
                                                        : `pbc ${UW_OLD} 放宽（用户裁定 2026-10-10）`)))))))))))))
            + `；画像库 = 二期 sender 口径重建版。`;
        }

        console.log(`\n===== 臂 ${arm}（源 ${def.src}）=====`);
        console.log('  name:', cfg.name);
        console.log('  condition:', buy.condition);
        console.log('  preBuy:', buy.preBuyCheckCondition);
        if (cfg.tokenPositionAnalyzer) console.log('  tpa:', JSON.stringify(cfg.tokenPositionAnalyzer));
        console.log('  backtest:', JSON.stringify(cfg.backtest));
        created.push({ arm, cfg });
    }

    if (!COMMIT) { console.log('\n[dry-run] 未建实验；加 --commit 真建'); process.exit(0); }

    for (const { arm, cfg } of created) {
        const container = await factory.createFromConfig(cfg, 'backtest');
        console.log(`\n[${arm}] created: ${container.id}`);
        console.log(`  下一步：node src/run-engine.js ${container.id}  # 须画像库重建完成后`);
    }
    process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
