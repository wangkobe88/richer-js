#!/usr/bin/env node
/**
 * narrativeRetry 实验级配置（C70，2026-10-15 bunker 案 0x2ec1e08c…7777）——源码口径单测
 * （零 DB 零网络，纯源码形状锁定；行为级覆盖在 _test_narrative_account_ttl J/M 节）
 *
 * 四层接线的源码形状（参数化默认值 / 条件注入 / 零接线防线 / UI 物化语义）：
 *   A. 引擎构造段（FourMemeWssTradingEngine）：_mergedWsConfig().narrativeRetry 消费、
 *      enabled !== false 默认开（删段=开，与 dataPrefetch「关=删段」刻意不同）、
 *      intervalMs/maxAnalyses Number.isInteger 条件注入（缺省回落构造器常量）、
 *      windowSec >= 60 缺省 300（不得低于 worker retryWindowSec 的耦合警示）、
 *      shouldBlockOnNarrative 闭包包装第 4 参（消费点签名零改动）
 *   B. BacktestEngine 零接线（前视防线）：NarrativeDirectCaller({ memoryCacheResults: true })
 *      不带 C67/C70 任何键（历史行 analyzed_at 恒早于墙钟，穿透=语料前视）、
 *      _shouldBlockOnNarrative 直挂无闭包、全文件零 narrativeRetry 残留
 *   C. web-server route 校验块：fourmemeWs/flapWs 两 secKey 循环、缺段 continue（默认开
 *      语义——校验不强制存在）、四键整数范围 + enabled 布尔 + 段形状
 *   D. 创建页模板三处物化语义：表单 nr-enabled 默认 checked / 复制回填缺段=开 /
 *      collectFormData 三分支（回测剥离、显式关 enabled:false、开+数字写段——
 *      浅合并保留复制携带的 windowSec、按平台选段删另一段防双段并存）
 *
 * 用法：node scripts/_test_narrative_retry_config.cjs
 */

'use strict';

const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.error(`  ❌ ${name}${detail ? ` | ${detail}` : ''}`); }
}

// ═══ A. 引擎构造段（FourMemeWssTradingEngine）═══
{
    const src = read('src/trading-engine/implementations/FourMemeWssTradingEngine.js');
    console.log('A. 引擎构造段消费 narrativeRetry');

    check('A1 实验级段读取（_mergedWsConfig 浅合并 → flap 实验自动读 flapWs 段）',
        src.includes('const narrativeRetry = this._mergedWsConfig().narrativeRetry || {};'));

    check('A2 enabled !== false 默认开（删段/缺段=开，显式 false 才关）',
        src.includes('accountFailTtlReanalyze: narrativeRetry.enabled !== false,'));

    check('A3 intervalMs 条件注入（Number.isInteger 才透传，缺省回落构造器 10s 常量）',
        src.includes('...(Number.isInteger(narrativeRetry.intervalMs) ? { accountFailTtlMs: narrativeRetry.intervalMs } : {})'));

    check('A4 maxAnalyses 条件注入（缺省回落构造器 3 常量）',
        src.includes('...(Number.isInteger(narrativeRetry.maxAnalyses) ? { maxAnalysesPerToken: narrativeRetry.maxAnalyses } : {})'));

    check('A5 windowSec 下限 60 缺省 300（= worker retryWindowSec 缺省同款；低于 worker 窗=拉黑先于翻正误拉黑）',
        src.includes('this._narrativeRetryWindowSec = Number.isInteger(narrativeRetry.windowSec) && narrativeRetry.windowSec >= 60')
            && src.includes('? narrativeRetry.windowSec : 300;'));

    check('A6 shouldBlockOnNarrative 闭包包装（第 4 参透传，拉黑登记/买腿短路消费点签名零改动）',
        src.includes('this._shouldBlockOnNarrative = (r, s, a) => shouldBlockOnNarrative(r, s, a, this._narrativeRetryWindowSec);'));

    check('A7 键名名实注释（maxAnalyses 非 maxRetries——计含首析的全部真跑）',
        src.includes('故名 maxAnalyses 非 maxRetries'));

    check('A8 windowSec 耦合警示注释（不得低于 worker retryWindowSec——无撤销路径）',
        src.includes('不得低于 worker 的 retryWindowSec'));
}

// ═══ B. BacktestEngine 零接线（前视防线）═══
{
    const src = read('src/trading-engine/implementations/BacktestEngine.js');
    console.log('B. BacktestEngine 零接线（回测禁穿透=语料前视防线）');

    check('B1 构造只带 memoryCacheResults（C67/C70 四键全缺=穿透关+缺省常量）',
        src.includes('this._narrativeCaller = new NarrativeDirectCaller({ memoryCacheResults: true });'));

    check('B2 _shouldBlockOnNarrative 直挂（无闭包无 windowSec 定制，缺省 300）',
        src.includes('this._shouldBlockOnNarrative = shouldBlockOnNarrative;'));

    // B3 改剥注释口径（C84 2026-10-17）：锁死注释「narrativeRetryDue 恒 0」合法在场，
    // 防线本体=代码级零 narrativeRetry 接线（无配置读取/无参数透传）
    const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    check('B3 代码级零 narrativeRetry 接线（回测禁穿透防线，注释豁免）',
        !noComments.includes('narrativeRetry'));

    check('B4 全文件零 C67 参数化键残留（accountFailTtlReanalyze/accountFailTtlMs/maxAnalysesPerToken）',
        !src.includes('accountFailTtlReanalyze') && !src.includes('accountFailTtlMs') && !src.includes('maxAnalysesPerToken'));
}

// ═══ C. web-server route 校验块 ═══
{
    const src = read('src/web-server.js');
    console.log('C. route 校验块（四键整数范围 + 缺段放行）');

    check('C1 fourmemeWs/flapWs 两 secKey 循环（flap 单平台配 flapWs 段）',
        src.includes("for (const secKey of ['fourmemeWs', 'flapWs']) {")
            && src.includes('const nr = (config[secKey] || {}).narrativeRetry;'));

    check('C2 缺段/null continue（校验不强制存在=引擎默认开语义）',
        src.includes('if (nr === undefined || nr === null) continue;'));

    check('C3 段形状校验（对象非数组）',
        src.includes("typeof nr !== 'object' || Array.isArray(nr)"));

    check('C4 enabled 须布尔',
        src.includes("nr.enabled !== undefined && typeof nr.enabled !== 'boolean'"));

    check('C5 intervalMs ∈ [1000,600000] 整数',
        src.includes('!intInRange(nr.intervalMs, 1000, 600000)'));

    check('C6 maxAnalyses ∈ [1,50] 整数',
        src.includes('!intInRange(nr.maxAnalyses, 1, 50)'));

    check('C7 windowSec ∈ [60,7200] 整数（下限对齐引擎构造点 ≥60 校验）',
        src.includes('!intInRange(nr.windowSec, 60, 7200)'));

    check('C8 noCorpusIntervalMs ∈ [1000,600000] 整数（C162 零语料臂补轮间隔）',
        src.includes('!intInRange(nr.noCorpusIntervalMs, 1000, 600000)'));
    check('C9 noCorpusMaxAnalyses ∈ [1,50] 整数（C162 零语料臂真跑上限）',
        src.includes('!intInRange(nr.noCorpusMaxAnalyses, 1, 50)'));
}

// ═══ E. C162 noCorpus* 两键接线（引擎构造段）═══
{
    const src = read('src/trading-engine/implementations/FourMemeWssTradingEngine.js');
    console.log('E. C162 noCorpus* 两键（零语料臂节奏，双 BINA 案）');

    check('E1 实验级 noCorpusIntervalMs 条件注入（缺省回落 60s）',
        src.includes('this._narrativeTriggerNoCorpusIntervalMs = Number.isInteger(narrativeRetry.noCorpusIntervalMs) && narrativeRetry.noCorpusIntervalMs > 0')
            && src.includes('? narrativeRetry.noCorpusIntervalMs : _nrDefaults.noCorpusIntervalMs;'));

    check('E2 实验级 noCorpusMaxAnalyses 条件注入（缺省回落 8）',
        src.includes('this._narrativeTriggerNoCorpusMaxAnalyses = Number.isInteger(narrativeRetry.noCorpusMaxAnalyses) && narrativeRetry.noCorpusMaxAnalyses >= 0')
            && src.includes('? narrativeRetry.noCorpusMaxAnalyses : _nrDefaults.noCorpusMaxAnalyses;'));

    check('E3 补轮判据双臂形状（noCorpusArm 互斥分流 + 按臂选参）',
        src.includes('const noCorpusArm = st.corpusEmpty === true && st.accountOnly !== true;')
            && src.includes("const maxAnalyses = noCorpusArm ? this._narrativeTriggerNoCorpusMaxAnalyses : this._narrativeTriggerMaxAnalyses;")
            && src.includes("const intervalMs = noCorpusArm ? this._narrativeTriggerNoCorpusIntervalMs : this._narrativeTriggerIntervalMs;"));
}

// ═══ D. 创建页模板三处物化语义 ═══
{
    const src = read('src/web/templates/create_experiment.html');
    console.log('D. 模板三处（表单 / 复制回填 / collectFormData 物化语义）');

    // D 节-1 表单
    check('D1 nr-enabled 默认勾选（UI 与引擎默认开对齐）',
        src.includes('id="nr-enabled" class="rounded" checked'));
    check('D2 数字框 placeholder 10000 / 3（空值=引擎默认）',
        src.includes('id="nr-interval-ms" placeholder="10000"')
            && src.includes('id="nr-max-analyses" placeholder="3"'));
    check('D3 windowSec 无表单项说明（复制链路整段携带）',
        src.includes('豁免窗 windowSec 无表单项'));

    // D 节-2 复制回填
    check('D4 回填缺段=开（源段 enabled===false 才显示为关——物化语义与 dataPrefetch 反向）',
        src.includes('nrCb.checked = !(nr && nr.enabled === false);'));
    check('D5 数字键 Number.isInteger 才回填（非整数不灌表单）',
        src.includes('if (nrInterval && Number.isInteger(nr.intervalMs)) nrInterval.value = nr.intervalMs;')
            && src.includes('if (nrMax && Number.isInteger(nr.maxAnalyses)) nrMax.value = nr.maxAnalyses;'));

    // D 节-3 collectFormData 三分支
    check('D6 回测模式整段剥离（引擎不消费+防前视配置漂移）',
        src.includes("if (tradingMode === 'backtest') {")
            && src.includes('if (adv[k]) delete adv[k].narrativeRetry;'));
    check('D7 显式关分支写 enabled:false（删段=静默重开，关必须物化）',
        src.includes('narrativeRetry: { ...(adv[sec]?.narrativeRetry || {}), enabled: false } };'));
    check('D8 显式关不写数字键（enabled!==false 短路在先，写了是死配置——注释锁定）',
        src.includes('数字键即便填了也不写'));
    check('D9 开+数字分支条件注入（intervalMs/maxAnalyses 展开写段）',
        src.includes('...(nrInterval !== null ? { intervalMs: nrInterval } : {})')
            && src.includes('...(nrMax !== null ? { maxAnalyses: nrMax } : {})'));
    check('D10 浅合并保留复制携带的 windowSec（两个写段分支同款展开前缀）',
        (src.match(/narrativeRetry: \{ \.\.\.\(adv\[sec\]\?\.narrativeRetry \|\| \{\}\)/g) || []).length === 2);
    check('D11 按平台选段+删另一段同键（防双段并存）',
        src.includes("const other = (sec === 'flapWs') ? 'fourmemeWs' : 'flapWs';")
            && src.includes('if (other !== sec && adv[other]) delete adv[other].narrativeRetry;'));
    check('D12 开且无数字输入=复制段原样保留（可能带 windowSec；无段=引擎默认）',
        src.includes('开且无数字输入：复制携带的段原样保留'));
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
