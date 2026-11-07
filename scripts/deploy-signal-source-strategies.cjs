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
//   v5（2026-11-07 v73 时段回测专用腿形，用户裁定）：
//     t6 暴跌抄底整腿删除 + D25-D55 五档回撤臂全删（回撤族整体退役）
//     t0a/t0b 两条更早人气臂新增：6 笔/0.75 BNB/4 真持有者、12 笔/1 BNB/
//            6 真持有者（更早入场点验证门链过滤价值）
//     全腿 buyPhase:'first'（每代币只买一次——T100 既有机制纯配置化）
//     9 腿：t0a/t0b + t1-t4 + N30/N36/N45；回测经 backtest.signalGateReal
//            真调门链（cheat 16 题+BP 题集 Jev；生产 v74 引用 v3 copy-in 不动）
//
//   v6（2026-11-07 首跑对照后用户裁定「去掉 t0a 再跑一次」）：
//     t0a（6 笔/0.75 BNB/4 真持有者）删除——首跑（415749ba）t0a 是 69 触发
//     token 的最早入场点，单独去掉对照「更早人气臂」对门链通过率/盈亏的
//     边际影响；priority 重排 t0b→1 … N45→8（t0b 起步即最早臂）
//     8 腿：t0b + t1-t4 + N30/N36/N45
//
//   v7（2026-11-07 完整窗口回测前用户裁定「t1 删除」）：
//     t1（8 笔/0.75 BNB/6 真持有者）删除——t0b 12 笔起步臂与 t2 16 笔档
//     之间不再保留 8 笔档；priority 重排 t2→2 … N45→7
//     7 腿：t0b + t2-t4 + N30/N36/N45
//
//   v8（2026-11-07 bt-v77 完整窗口复盘后用户裁定，同一轮两改）：
//     NL15/NL20/NL25 三条「接近发行价」臂新增——buyVolumeBnb ≥ 1.5/2/2.5
//     AND currentVsLaunchPct <= 50（新 FA 键 T122：现价较首可靠价涨幅，
//     BP near_launch 同口径 ≤+50% 含破发；null=未见可靠价恒 false 宁拦
//     不冒充）。参考购买前检测中「接近发布价」的判断——热度够+价格还贴
//     发行价的入场点；无 tradeCount/holdersExDust 门=比 t 系更早可触发。
//     同轮配套：cheat 门 CD379 活跃度豁免（activity high/ultra 不拦）。
//     priority 8/9/10 追加在阶梯后；cheatRecheck=true（同 t0b 早臂族，
//     每买信号重判省误杀）
//     10 腿：t0b + t2-t4 + N30/N36/N45 + NL15/NL20/NL25
//
//   v9（2026-11-07 bt-v78 复盘后用户裁定「NL 三臂也根据问题调整一下，
//     tickCount >= 10」）：NL 三臂加 tradeCount >= 10——bt-v78 首跑 114 买
//     中 53 笔（46%）走 BP insufficient_ticks（锚窗 tick<8 不判定）放行漏网
//     （BP10 起改拒）。FA state.tickCount 与发射键 tradeCount 之间零 return
//     恒等（每进 FA 的 tick 两键同步 +1），且 BP 锚 anchorTickCount（落库行
//     含尘 tick）≥ tradeCount——tradeCount ≥ 10 即用户所指 tickCount ≥ 10，
//     且保证 NL 触发时 BP 锚窗必过 minTicks=8（三臂不再产生 insufficient）。
//
//   ⚠ 引用本条目的新实验必须显式配 buySignalMaxPerToken ≥ 10（各腿 1 次
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
    // buyPhase:'first'（v5 全腿，2026-11-07 用户裁定「每个代币只允许买入一次」）：
    // 仅 completedPairs.length===0 可见（T100 既有机制纯配置零新代码——首买/
    // 再买分臂路由）；再买轮全部不可见=每 token 恰一次买入
    buyPhase: 'first',
    signalGate: { maxTriggers: 1, cheatRecheck, bpPassLevels: ['good', 'neutral'] },
    description,
});

const LEGS = [
    leg('t0b', 1, 'tradeCount >= 12 AND buyVolumeBnb >= 1 AND holdersExDust >= 6', true,
        '人气臂 b（v5 新增，v6 起为最早臂——t0a 6 笔档 2026-11-07 首跑对照后用户裁定删除）：12 笔/1 BNB/6 真持有者；cheatRecheck=true'),
    leg('t2', 2, 'tradeCount >= 16 AND buyVolumeBnb >= 1 AND holdersExDust >= 9', true,
        '阶梯 2（v4 原文）：16 笔/1 BNB/9 真持有者；cheatRecheck=true'),
    leg('t3', 3, 'tradeCount >= 20 AND buyVolumeBnb >= 1.2 AND holdersExDust >= 12', true,
        '阶梯 3（v4 原文）：20 笔/1.2 BNB/12 真持有者；cheatRecheck=true'),
    leg('t4', 4, 'tradeCount >= 24 AND buyVolumeBnb >= 1.5 AND holdersExDust >= 12', false,
        '阶梯 4（v4 原文）：24 笔/1.5 BNB/12 真持有者；cheatRecheck=false（高热度票 unhealthy 粘滞秒回省配额）'),
    leg('N30', 5, 'tradeCount >= 30 AND buyVolumeBnb >= 1.5 AND holdersExDust >= 12', false,
        '热度腿（T119 用户给定条件串原文，v4 原文）：30 笔/1.5 BNB/12 真持有者——阶梯接棒+节流下实际落点由步进节奏决定，慢热票里程碑摊开'),
    leg('N36', 6, 'tradeCount >= 36 AND buyVolumeBnb >= 1.5 AND holdersExDust >= 12', false,
        '热度腿（T119，v4 原文）：36 笔/1.5 BNB/12 真持有者'),
    leg('N45', 7, 'tradeCount >= 45 AND buyVolumeBnb >= 1.5 AND holdersExDust >= 12', false,
        '热度腿（T119，v4 原文）：45 笔/1.5 BNB/12 真持有者——极高热度确认，任何节奏的票 45 笔=强活跃'),
    // v8 接近发行价臂（T122，2026-11-07 用户裁定「参考购买前检测中『接近发布价』的判断，
    // buyVolumeBnb >= 1.5/2/2.5 且接近发行价」）：currentVsLaunchPct=现价较首可靠价涨幅
    // （FA 新键），<=50 含破发=BP near_launch 同口径贴发行价区；无可靠价 null 恒 false
    // 宁拦不冒充。cheatRecheck=true（t0b 早臂族同款：每买信号重判）。
    // v9（bt-v78 复盘后用户裁定「NL 三臂也根据问题调整一下，tickCount >= 10」）：
    // 三臂加 tradeCount >= 10——FA tickCount 与 tradeCount 恒等（零 return 同步 +1），
    // BP 锚 anchorTickCount ≥ tradeCount ⇒ 触发时 BP 锚窗必过 minTicks=8，
    // 不再产生 insufficient_ticks（bt-v78 53/114 漏网主源头）
    leg('NL15', 8, 'tradeCount >= 10 AND buyVolumeBnb >= 1.5 AND currentVsLaunchPct <= 50', true,
        '接近发行价臂 a（v8 新增 T122；v9 加 tradeCount>=10——tick 数源头门防 BP 锚窗不足）：买量 1.5 BNB ∧ 现价较发行价 ≤+50%（含破发）——热度够+价格贴发行价'),
    leg('NL20', 9, 'tradeCount >= 10 AND buyVolumeBnb >= 2 AND currentVsLaunchPct <= 50', true,
        '接近发行价臂 b（v8 新增 T122；v9 加 tradeCount>=10）：买量 2 BNB ∧ 现价较发行价 ≤+50%（含破发）'),
    leg('NL25', 10, 'tradeCount >= 10 AND buyVolumeBnb >= 2.5 AND currentVsLaunchPct <= 50', true,
        '接近发行价臂 c（v8 新增 T122；v9 加 tradeCount>=10）：买量 2.5 BNB ∧ 现价较发行价 ≤+50%（含破发）——三档中最高热度确认'),
];

const ENTRIES = [
    {
        name: 'signal-source-ladder-v1',
        side: 'buy',
        legs: LEGS,
        description: 'T117/T119 信号源阶梯 v9（2026-11-07 bt-v78 复盘后用户裁定：NL 三臂加 tradeCount >= 10——FA tickCount 与 tradeCount 恒等，BP 锚 anchorTickCount ≥ tradeCount ⇒ 触发时锚窗必过 minTicks=8，bt-v78 114 买中 53 笔 insufficient_ticks 漏网的主源头封堵；其余同 v8=NL15/NL20/NL25 接近发行价三臂（buyVolumeBnb ≥1.5/2/2.5 AND currentVsLaunchPct <= 50，T122 新 FA 键）+ CD379 活跃度豁免）：10 买腿 condition=初始买入信号源（t0b 12 笔起步臂 + t2-t4 热度 + N30/36/45 纯热度 + NL15/20/25 接近发行价臂；全腿 buyPhase:first 每代币只买一次），maxTriggers 全 1 触发即消耗，触发后依次过作弊门（二元版）→ BP 门（good/neutral 过）两门都过才买；纯盘面无叙事层；回测经 backtest.signalGateReal=true 真调门链（缺省回测恒拒现状不变）。⚠ 引用实验须 buySignalMaxPerToken ≥ 10 + cheatCheck.enabled + buyPointCheck.enabled',
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
