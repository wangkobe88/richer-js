#!/usr/bin/env node
// ============================================================================
// T117/T119 信号源阶梯策略库条目部署（2026-11-05 买入策略整体调整，用户批准）
//   单条目 signal-source-ladder-v1（side=buy）——买腿 condition=「初始买入信号源」
//   （触发策略），触发后依次过作弊门（二元版）→ 买入点位分析（BP）门，两门都过
//   才买（纯盘面，无叙事/GMGN/preBuy 层）。
//
//   v3（T119，2026-11-05 吉祥 0xea7886d5 复盘五轮裁定）：
//     t1-t4  热度门槛递升（原七臂不动）+ N30/N36/N45 三条纯热度腿（用户给定
//            条件串原文——阶梯接棒+T110 节流下实际触发落点由步进节奏决定，
//            吉祥案实证全落贴高段与 t2/t3 同域；慢热票里程碑摊开才有价值）
//     t6     跌回低市值 OR 深回撤（v2 峰门版不动，priority 6→8）
//     D25-D55 五条回撤臂（纯阈值+峰门 15，浅到深排布=回撤进行时先穿浅档
//            先消耗、加深后深档接力「每个深度一次机会」；不加活跃度门——
//            BP 门 market_heat 已兜底，2026-11-05 用户裁定）
//     t5 急砸/t7 跌底放量两臂删除（同日用户裁定；recentBlockDropPct 阈值
//     本为占位、quiet 三键 FA 触发键保留无消费者=未来翻案可复用）
//   合并制探索否决留档：等值 OR 链（tradeCount == 8/20/32…）求值器支持但被
//   买腿 debounce 否决（signalDebounceMs 200 slot 合并+fire 重评，等值点窗尾
//   重评时 tradeCount 已 +1=翻假丢里程碑；范围带=变相多臂）——终裁多臂制。
//   急拉票回撤点 BP12 判 poor=BP11 接受现状复裁维持（D 臂价值在慢推票）。
//
//   ⚠ 引用本条目的新实验必须显式配 buySignalMaxPerToken ≥ 13（13 腿各 1 次
//   触发上限；T110 默认帽 5 会截断阶梯）；并配 cheatCheck.enabled=true +
//   buyPointCheck.enabled=true（两门 disabled 时：cheat 门 fail-open 放行、
//   BP 门 fail-closed 全拒=零买入，配置矛盾）。
//
// 防呆：validateLegs 纯函数本地预检零 DB；重名=已建读 id 幂等续跑（同名
// version+1，buy-v2 系惯例——挖掘/引用侧按名拉最新 version 自动跟进）。
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
        '阶梯 1（最早最松）：8 笔/0.75 BNB/6 真持有者即触发门链；cheatRecheck=true（首触发源值得 unhealthy 重判攒判定轨迹）——吉祥案 t1 信号时刻双截窗重析=neutral 0.76 应过门（生产被 settle 锚窗漂移吞）'),
    leg('t2', 2, 'tradeCount >= 16 AND buyVolumeBnb >= 1 AND holdersExDust >= 9', true,
        '阶梯 2：16 笔/1 BNB/9 真持有者；cheatRecheck=true'),
    leg('t3', 3, 'tradeCount >= 20 AND buyVolumeBnb >= 1.2 AND holdersExDust >= 12', true,
        '阶梯 3：20 笔/1.2 BNB/12 真持有者；cheatRecheck=true'),
    leg('t4', 4, 'tradeCount >= 24 AND buyVolumeBnb >= 1.5 AND holdersExDust >= 12', false,
        '阶梯 4：24 笔/1.5 BNB/12 真持有者；cheatRecheck=false（高热度票 unhealthy 粘滞秒回省配额）'),
    leg('N30', 5, 'tradeCount >= 30 AND buyVolumeBnb >= 1.5 AND holdersExDust >= 12', false,
        '热度腿 5（T119 用户给定条件串原文）：30 笔/1.5 BNB/12 真持有者——阶梯接棒+节流下实际落点由步进节奏决定，慢热票里程碑摊开'),
    leg('N36', 6, 'tradeCount >= 36 AND buyVolumeBnb >= 1.5 AND holdersExDust >= 12', false,
        '热度腿 6（T119）：36 笔/1.5 BNB/12 真持有者'),
    leg('N45', 7, 'tradeCount >= 45 AND buyVolumeBnb >= 1.5 AND holdersExDust >= 12', false,
        '热度腿 7（T119）：45 笔/1.5 BNB/12 真持有者——极高热度确认，任何节奏的票 45 笔=强活跃'),
    leg('t6', 8, '(mcapPeakBnb >= 15 AND marketCap > 0 AND marketCap <= 7.5) OR mcapFromPeakPct >= 60', false,
        '跌回低市值（峰 ≥15=涨出 7.5 低线至少翻倍，市值 ≤7.5 时隐含回撤 ≥50%——峰门防出生票市值从 0 涨起前几笔必 ≤7.5 的即触发）OR 较峰回撤 ≥60%'),
    leg('D25', 9, 'mcapPeakBnb >= 15 AND mcapFromPeakPct >= 25', false,
        '回撤臂 25%（T119 五臂之一，浅到深排布=先穿浅档先消耗）：峰 ≥15 峰门（实证后果留档：吉祥首峰 13.3 BNB<15 首波回撤点不触发，五臂实际覆盖 $10.7k+ 峰值票，阈值库中可调）∧ 较峰回撤 ≥25%；急拉票回撤点 BP12 判 poor=BP11 接受现状维持，本臂价值在慢推票深回撤企稳'),
    leg('D30', 10, 'mcapPeakBnb >= 15 AND mcapFromPeakPct >= 30', false,
        '回撤臂 30%（T119）：峰 ≥15 ∧ 较峰回撤 ≥30%'),
    leg('D35', 11, 'mcapPeakBnb >= 15 AND mcapFromPeakPct >= 35', false,
        '回撤臂 35%（T119）：峰 ≥15 ∧ 较峰回撤 ≥35%'),
    leg('D45', 12, 'mcapPeakBnb >= 15 AND mcapFromPeakPct >= 45', false,
        '回撤臂 45%（T119）：峰 ≥15 ∧ 较峰回撤 ≥45%'),
    leg('D55', 13, 'mcapPeakBnb >= 15 AND mcapFromPeakPct >= 55', false,
        '回撤臂 55%（T119）：峰 ≥15 ∧ 较峰回撤 ≥55%'),
];

const ENTRIES = [
    {
        name: 'signal-source-ladder-v1',
        side: 'buy',
        legs: LEGS,
        description: 'T117/T119 信号源阶梯 v3（2026-11-05 吉祥复盘裁定）：13 买腿 condition=初始买入信号源（t1-t4 热度+N30/36/45 纯热度+t6 低市值OR深回撤+D25-D55 五档回撤臂，maxTriggers 全 1 触发即消耗；t5 急砸/t7 跌底放量已删），触发后依次过作弊门（二元版）→ BP 门（good/neutral 过）两门都过才买；纯盘面无叙事层；回测恒拒（signalGate 腿全量排除）。⚠ 引用实验须 buySignalMaxPerToken ≥ 13 + cheatCheck.enabled + buyPointCheck.enabled',
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
        const { data: dup } = await db.from('strategy_library').select('id,name,side,version,legs').eq('name', e.name);
        if (dup && dup[0]) {
            // 同名迭代（buy-v2 系惯例：同名条目 version+1 而非新名）：legs/description 任一变化才 update
            const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
            const svc = new StrategyLibraryService();
            const legsChanged = JSON.stringify(dup[0].legs) !== JSON.stringify(e.legs);
            const descChanged = JSON.stringify(dup[0].description || '') !== JSON.stringify(e.description);
            if (!legsChanged && !descChanged) {
                console.log(`[SKIP] 库条目已是目标形状: ${e.name} ${dup[0].id} version=${dup[0].version}`);
                continue;
            }
            if (!COMMIT) {
                console.log(`[DRY-RUN] 库条目已存在将 UPDATE（version ${dup[0].version}→${dup[0].version + 1}）: ${e.name}`);
                for (const l of e.legs) console.log(`  p${l.priority} ${l.condition}  signalGate=${JSON.stringify(l.signalGate)}`);
                continue;
            }
            const updated = await svc.update(dup[0].id, {
                name: e.name, description: e.description, legs: e.legs, expectedVersion: dup[0].version,
            });
            console.log(`[OK] strategy_library UPDATE: ${e.name} version ${dup[0].version}→${updated.version}（腿形变化=${legsChanged} 描述变化=${descChanged}）`);
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
