#!/usr/bin/env node
// ============================================================================
// C166 账号信息复检卖臂部署（2026-10-22 一次性专号 rug 家族案 SL/FOURGE）
//   1. 策略库建条目 rug-exit-account-arm（side='sell' 首例）
//      condition = issuerAccountState == 'deleted' OR issuerAccountState == 'tweets_gone'
//   2. 目标实验 config：sellStrategies 追加（16→17）+ libraryRefs 追加 +
//      fourmemeWs.accountHealthCheck 开段（默认关，实验级显式开——gwp 物化语义；
//      只加腿不开复检=因子恒 null 死腿，两动作必须同批）
//
// 防呆：目标实验存在；卖腿无 issuerAccountState 残留；库重名即报（幂等半途续跑：
//   条目已建时打印 libId 供 --lib-id 复用）；validateLegs 纯函数本地预检零 DB。
//
// ⚠ 部署对象裁定待用户：v28 原地加腿（--exp 缺省）或并入人气门案 v29（先跑其
//   create-v29.cjs 再挂 v29 id——其防呆断言卖腿数=16 会挡，须两案协调顺序）。
//   在 182 跑 --commit（写操作红线）；本地仅 dry-run。
// 用法：node scripts/deploy-c166-account-arm.cjs [--exp <id>] [--commit]
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const EXP_ARG = (process.argv.includes('--exp') ? process.argv[process.argv.indexOf('--exp') + 1] : null)
    || 'a97e4f25-dcaa-4c80-a719-944ded2c5b5f'; // 缺省 v28 live both

const LEG = {
    cards: 'all',
    priority: 2,
    condition: "issuerAccountState == 'deleted' OR issuerAccountState == 'tweets_gone'",
    cooldownSec: null,
    description: '账号 rug 前兆全清臂（C166，2026-10-22 SL 0x58417f3f…affff / FOURGE 0xf9de0ca2…ffff 一次性专号 rug 家族案：买入后 3 分钟内同块协同砸盘 -56%，价格止损永远吃残值）：持仓期 AccountHealthMonitor 裸调 apidance 复检宣告账号（前 10min 每 30s 高频/之后每 2min），删号（空响应骨架特异形状）或宣告推被删（严格 tweet_id 比对，防 tweets[0] 兜底坑）或推文清零 → issuerAccountState 置 deleted/tweets_gone 全清；active/null（未检测/无宣告账号/API 故障 fail-open）恒不卖；maxExecutions 刻意不设（卖出失败每轮重试直到清仓）；回测零接线因子恒 null 零影响（时序穿越防线）',
    bypassDebounce: false,
    sellPercentage: 1,
};
const LIB_NAME = 'rug-exit-account-arm';
const AHC = { enabled: true, firstWindowMin: 10, fastIntervalSec: 30, slowIntervalSec: 120 };

async function main() {
    // ── 本地纯函数预检（零 DB）：validateLegs 三防线认得 issuerAccountState ──
    const { validateLegs } = require('../src/web/services/StrategyLibraryService');
    const check = validateLegs('sell', [LEG]);
    if (!check.valid) throw new Error('validateLegs 拒绝卖腿: ' + check.errors.join('; '));
    console.log('[OK] validateLegs(sell) 零错误（issuerAccountState 已入 FA 键集）');

    const { dbManager } = require('../src/services/dbManager');
    const db = dbManager.getClient();

    // ── 实验行读取 + 形状防呆 ──
    const { data: exps, error: eErr } = await db.from('experiments').select('id,experiment_name,status,config').eq('id', EXP_ARG);
    if (eErr || !exps || !exps.length) throw new Error('目标实验不存在: ' + EXP_ARG);
    const exp = exps[0];
    const cfg = JSON.parse(JSON.stringify(exp.config));
    const sells = cfg.strategiesConfig?.sellStrategies;
    if (!Array.isArray(sells)) throw new Error('目标 config 无 sellStrategies');
    if (sells.some(s => String(s.condition || '').includes('issuerAccountState'))) {
        throw new Error('目标已含 issuerAccountState 卖臂，中止防重复');
    }
    console.log(`目标: ${exp.experiment_name} (${exp.status}) | 卖腿 ${sells.length} → ${sells.length + 1}`);

    // ── 库条目（幂等：重名=已建，读出 libId 供 refs）──
    const { data: dup } = await db.from('strategy_library').select('id,name,side,version').eq('name', LIB_NAME);
    let libId = dup && dup[0] && dup[0].id;
    if (!libId && COMMIT) {
        const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
        const svc = new StrategyLibraryService();
        const created = await svc.create({ name: LIB_NAME, description: LEG.description, side: 'sell', legs: [LEG] });
        libId = created.id;
        console.log('[OK] strategy_library INSERT:', libId, 'side=sell version=' + created.version);
    } else if (libId) {
        console.log('[SKIP] 库条目已存在:', libId, 'version=' + dup[0].version);
    } else {
        console.log('[DRY-RUN] 库条目将 INSERT:', LIB_NAME, 'side=sell');
    }

    // ── config 三处变更（卖腿 append / libraryRefs append / accountHealthCheck 开段）──
    sells.push(JSON.parse(JSON.stringify(LEG)));
    if (!cfg.fourmemeWs) cfg.fourmemeWs = {};
    cfg.fourmemeWs.accountHealthCheck = AHC;
    const ref = {
        name: LIB_NAME, side: 'sell', libId: libId || '(待建)',
        version: 1, legCount: 1, snapshotAt: new Date().toISOString(),
    };
    (cfg.strategiesConfig.libraryRefs = cfg.strategiesConfig.libraryRefs || []).push(ref);

    console.log('\n=== 卖腿 condition ===\n', LEG.condition);
    console.log('\n=== libraryRefs（追加项）===\n', JSON.stringify(ref));
    console.log('=== fourmemeWs.accountHealthCheck ===\n', JSON.stringify(AHC));
    console.log('name/description 保持不变:', cfg.name || exp.experiment_name);
    if (!COMMIT) { console.log('\n[DRY-RUN] 未写入。--commit 执行：库 INSERT + 实验 config UPDATE'); process.exit(0); }

    const { error: uErr } = await db.from('experiments')
        .update({ config: cfg }).eq('id', EXP_ARG);
    if (uErr) throw new Error('实验 config 更新失败: ' + uErr.message);
    console.log('\n[OK] experiments config UPDATE:', EXP_ARG);
    console.log('\nNEXT: 停进程（先确认无持仓 SOP）→ 重启（setsid nohup --force）→ 回查 17 卖腿 + 复检 interval + 宣告账号接线日志');
    process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
