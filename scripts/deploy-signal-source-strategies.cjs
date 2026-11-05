#!/usr/bin/env node
// ============================================================================
// T117 信号源阶梯策略库条目部署（2026-11-05 买入策略整体调整，用户批准方案）
//   单条目 signal-source-ladder-v1（side=buy）七腿阶梯递进——买腿 condition=
//   「初始买入信号源」（触发策略），触发后依次过作弊门（二元版）→ 买入点位
//   分析（BP）门，两门都过才买（纯盘面，无叙事/GMGN/preBuy 层）。
//
//   阶梯设计（触发即消耗 maxTriggers=1 不返还——门拒/超时均算消耗，7 条递进
//   阈值=多次机会设计，2026-11-05 用户裁定）：
//     t1-t4 热度门槛递升（tradeCount/buyVolumeBnb/holdersExDust——t1 最早最松
//          优先级最高；t4 同 holders 更高热度）
//     t5    块窗砸盘形状（recentBlockDropPct≥12 阈值占位，用户库中调）
//     t6    低市值 OR 深回撤（marketCap>0 前卫防 supply 缺失=0 误触发）
//     t7    跌底放量（深回撤+静默段后 surge 放量）
//   t1-t3 cheatRecheck:true（unhealthy 重判）；t4-t7 false（unhealthy 粘滞秒回
//   拒省配额——低阶触发源不值得烧 Jev 重判）。
//
//   ⚠ 引用本条目的新实验必须显式配 buySignalMaxPerToken ≥ 7（T110 默认帽 5
//   < 7 腿会截断阶梯——7 条腿 per token 各 1 次触发 = 帽 5 只放 5 次）；
//   并配 cheatCheck.enabled=true + buyPointCheck.enabled=true（两门 disabled
//   时：cheat 门 fail-open 放行、BP 门 fail-closed 全拒=零买入，配置矛盾）。
//
// 防呆：validateLegs 纯函数本地预检零 DB；重名=已建读 id 幂等续跑。
// 在 182 跑 --commit（写操作红线）；本地仅 dry-run。
// 用法：node scripts/deploy-signal-source-strategies.cjs [--commit]
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const leg = (id, priority, condition, cheatRecheck, description) => ({
    action: 'buy',
    priority,
    condition,
    maxExecutions: null,
    signalGate: { maxTriggers: 1, cheatRecheck, bpPassLevels: ['good', 'neutral'] },
    description,
});

const LEGS = [
    leg('t1', 1, 'tradeCount >= 8 AND buyVolumeBnb >= 0.75 AND holdersExDust >= 6', true,
        '阶梯 1（最早最松）：8 笔/0.75 BNB/6 真持有者即触发门链；cheatRecheck=true（首触发源值得 unhealthy 重判攒判定轨迹）'),
    leg('t2', 2, 'tradeCount >= 16 AND buyVolumeBnb >= 1 AND holdersExDust >= 9', true,
        '阶梯 2：16 笔/1 BNB/9 真持有者；cheatRecheck=true'),
    leg('t3', 3, 'tradeCount >= 20 AND buyVolumeBnb >= 1.2 AND holdersExDust >= 12', true,
        '阶梯 3：20 笔/1.2 BNB/12 真持有者；cheatRecheck=true'),
    leg('t4', 4, 'tradeCount >= 24 AND buyVolumeBnb >= 1.5 AND holdersExDust >= 12', false,
        '阶梯 4：24 笔/1.5 BNB/12 真持有者（最高热度门）；cheatRecheck=false（高热度票 unhealthy 粘滞秒回省配额）'),
    leg('t5', 5, 'recentBlockDropPct >= 12', false,
        '阶梯 5：块收盘环窗（≤4 块 1/2/3 块窗最深跌幅）≥12% 砸盘形状；阈值占位待票池分布校准（用户库中调）'),
    leg('t6', 6, 'marketCap > 0 AND marketCap <= 7.5 OR mcapFromPeakPct >= 60', false,
        '阶梯 6：低市值（≤7.5 BNB，marketCap>0 前卫防 supply 缺失=0 误触发）OR 较峰回撤 ≥60%'),
    leg('t7', 7, 'mcapFromPeakPct >= 60 AND quietSpanMs >= 60000 AND quietSurgeBuyBnb >= 0.5', false,
        '阶梯 7：跌底放量——深回撤 ≥60% + ≥60s 静默段后 surge 买量 ≥0.5 BNB'),
];

const ENTRIES = [
    {
        name: 'signal-source-ladder-v1',
        side: 'buy',
        legs: LEGS,
        description: 'T117 信号源阶梯（2026-11-05 用户批准）：七买腿 condition=初始买入信号源（触发策略），触发即消耗（maxTriggers=1）后依次过作弊门（二元版）→ BP 门（good/neutral 过）两门都过才买；纯盘面无叙事层；回测恒拒（signalGate 腿全量排除）。⚠ 引用实验须 buySignalMaxPerToken ≥ 7 + cheatCheck.enabled + buyPointCheck.enabled',
    },
];

async function main() {
    // ── 本地纯函数预检（零 DB）：validateLegs 三防线认得全部因子（含 T117 五新键）──
    const { validateLegs } = require('../src/web/services/StrategyLibraryService');
    for (const e of ENTRIES) {
        const check = validateLegs(e.side, e.legs);
        if (!check.valid) throw new Error(`validateLegs 拒绝 ${e.name}: ` + check.errors.join('; '));
        console.log(`[OK] validateLegs(${e.side}) 零错误: ${e.name}（${e.legs.length} 腿）`);
    }

    const { dbManager } = require('../src/services/dbManager');
    const db = dbManager.getClient();

    for (const e of ENTRIES) {
        const { data: dup } = await db.from('strategy_library').select('id,name,side,version').eq('name', e.name);
        if (dup && dup[0]) {
            console.log(`[SKIP] 库条目已存在: ${e.name} ${dup[0].id} side=${dup[0].side} version=${dup[0].version}`);
            continue;
        }
        if (!COMMIT) {
            console.log(`[DRY-RUN] 库条目将 INSERT: ${e.name} side=${e.side}（${e.legs.length} 腿）`);
            for (const l of e.legs) console.log(`  p${l.priority} ${l.condition}  signalGate=${JSON.stringify(l.signalGate)}`);
            continue;
        }
        const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
        const svc = new StrategyLibraryService();
        const created = await svc.create({
            name: e.name, description: e.description, side: e.side, legs: e.legs,
        });
        console.log(`[OK] strategy_library INSERT: ${created.id} ${e.name} side=${e.side} version=${created.version}`);
    }
    if (!COMMIT) console.log('\n[DRY-RUN] 未写入。182 上 --commit 执行');
    process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
