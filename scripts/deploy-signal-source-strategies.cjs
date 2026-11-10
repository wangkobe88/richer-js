#!/usr/bin/env node
// ============================================================================
// T117/T119 信号源阶梯策略库条目部署（2026-11-05 买入策略整体调整，用户批准）
//   主条目 signal-source-ladder-v1（side=buy）——买腿 condition=「初始买入信号源」
//   （触发策略），触发后依次过作弊门（二元版）→ 买入点位分析（BP）门，两门都过
//   才买（纯盘面，无叙事/GMGN/preBuy 层）。
//   v17 起另含两条卖出库条目（T133 用户裁定）：famous-entry-exit（famous 在
//   near_launch 进场即全清）+ low-zone-stall-exit（low 区间滞涨全清）——
//   bypassDebounce+cards:all 立即路径，引用实验卖腿区加库引用即生效。
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
//   v10（2026-11-08 CD381 六条批量裁定，用户原话「所有的买入臂都要加入价格
//     要求，都要在 low 范围内」+「增加买入臂 tradeCount >= 10 AND
//     buyVolumeBnb >= 1.5 AND currentVsLaunchPct <= 20」）：
//     ① 全 t/N 系七臂 condition 加 AND currentVsLaunchPct <= 80（新价格档
//        low 上界=+80%；null=未见可靠价恒 false 宁拦不冒充）；NL 三臂维持
//        <=50（接近发行价臂语义不动）
//     ② RL15 重启臂新增：tradeCount >= 10 AND buyVolumeBnb >= 1.5 AND
//        currentVsLaunchPct <= 20（用户给定条件串原文）——经历一定交易量后
//        回到 almost_launch（≤+20 含破发）的重启盘入场点，BP 题面 BP43
//        restart 桶+位置门 ≤+40 配套
//     ③ signalGate.cheatRecheck 字段全删、recheckCondition 表达式接棒
//        （CD381 重判条件因子表达式化）：早臂族七条（t0b/t2/t3/NL15/20/25/
//        RL15）= `preCheatResult == 'unhealthy' OR priceBackToAlmostLaunch == 1`
//        （≈v9 cheatRecheck=true 语义+almost_launch 重检）；高热度四条（t4/
//        N30/N36/N45）= `priceBackToAlmostLaunch == 1`（≈cheatRecheck=false
//        粘滞秒回省配额+almost_launch 重检可翻案）
//     11 腿：t0b + t2-t4 + N30/N36/N45 + NL15/NL20/NL25 + RL15
//
//   v11（2026-11-08 用户裁定「再增加一个买入臂 tradeCount >= 10 AND
//     buyVolumeBnb >= 1.5 AND currentVsLaunchPct <= 10」）：
//     RL10 深重启臂新增（用户条件串原文）——同 RL15 形状但价格门 ≤+10
//     （含破发）：almost_launch 深段（≤+20 为 almost_launch 桶界、≤+10 为
//     其深半区）的更贴发行价入场点；同日 CD380 三修（holdings 臂退出不豁免
//     臂）+CD382 盘面重置对拍语境——bt-s01 类砸回深段的票在 ≤+10 区先触发
//     本腿。recheck=早臂族式（unhealthy 重判 ∪ almost_launch 重检）。
//     12 腿：t0b + t2-t4 + N30/N36/N45 + NL15/NL20/NL25 + RL15 + RL10
//
//   v12（2026-11-08 高大上 0x838657df…7777 单票回测零触发复盘后用户裁定
//     「增加一个 tradeCount >= 9 AND buyVolumeBnb >= 1 AND holdersExDust
//     >= 6 AND currentVsLaunchPct <= 80」）：
//     t0a 更早人气臂新增（用户条件串原文，9 笔档——v5 旧 t0a 为 6 笔档
//     不同参数、v6 删除；本次以 9 笔/1 BNB/6 真持有者/≤+80 重生）。
//     动机=「点火即拉飞」形状（高大上案：13 分钟死盘 → 单笔 0.70B 点火
//     2 秒 9 笔 tc=11 时 t0b 差 1 笔、tc=12 时 curVs 已 +82.5 破 ≤80 门
//     → 全窗零触发错过 10x 毕业票）——9 笔门槛让最早臂在点火初段
//     （tc 9-11、价格尚 ≤+80）即可触发。priority 1 起步即最早臂，
//     原 t0b…RL10 顺移 +1；recheck=早臂族式。
//     13 腿：t0a + t0b + t2-t4 + N30/N36/N45 + NL15/NL20/NL25 + RL15 + RL10
//
//   v13（2026-11-08 bt-v83 完整窗口回测 87/87 reset 小票放行实证后用户裁定 B
//     「量门提高」）：NL15/20/25+RL15/RL10 五臂 tradeCount >= 10→15 ∧
//     buyVolumeBnb 统一 ≥2.5（NL25 原即 2.5 不变）。动机=「10 笔/1.5 BNB」
//     对整票生命周期 30~120 行 tick 的冲高砸落小票无区分度（30 行票
//     tradeCount 也能到 20-30、1.5 BNB 买量几分钟凑满）——量门抬到 NL25
//     既有线五臂同线。t0a/t0b/t2-t4/N 系不动（t0a 9 笔档为「点火即拉飞」
//     早臂语义，与 CD384 fail-closed（cheat 侧同案裁定 A）双防线配合：
//     reset 截窗不足由 cheat 门硬拒、量够窗足的小票由本量门收紧）。
//     13 腿（结构不变）：t0a + t0b + t2-t4 + N30/N36/N45 + NL15/NL20/NL25
//     + RL15 + RL10
//
//   v14（2026-11-09 bt-v91 涨幅 Top10 前期低点分布复盘后用户裁定「near_launch
//     的范围改为涨幅 30% 以下，也就是说当前系统不会买入涨幅超过 27.5 的任何
//     代币……currentVsLaunchPct <= 80 需要改为 currentVsLaunchPct <= 27.5，
//     其它买入臂也是如此」）：全 t/N 系八臂价格门 80→27.5 + NL 三臂 50→27.5
//     （=门上界统一 27.5，系统全局不买现价较发行价 >+27.5% 的票）；RL15 ≤20/
//     RL10 ≤10 刻意不动（已低于 27.5 上界，改 27.5=放宽非收紧）。动机=Top10
//     涨幅票（+499%~+1426%）前期最低点全部在 +23.9% 以内（6 票 ≤+3.3%、
//     2 票破发、来财 +16.6%/吉祥 +12.9%/钱来 +23.9%）——大涨幅票的底都在
//     almost_launch 区附近，+27.5 以上的追高入场无正收益分布支撑。
//     13 腿（结构不变）：t0a + t0b + t2-t4 + N30/N36/N45 + NL15/NL20/NL25
//     + RL15 + RL10
//
//   v15（2026-11-10 T131 吉祥 ea78 0xea7886d5…7777 开盘 25 秒窗差一笔案，
//     用户裁定「针对这个问题，增加一个买入臂吧」「之后的买入点位肯定远不如
//     早期的」+ minTicks 红线配套裁定「可以适当降低一下，例如降低为 7」）：
//     t0 最早臂新增：tradeCount >= 7 AND buyVolumeBnb >= 1 AND
//     holdersExDust >= 4 AND currentVsLaunchPct <= 27.5。动机=ea78 形状
//     「开盘贴发行价慢攒 25 秒 → t+30s 17 笔拉到 +131% 永久离开买窗」：
//     t0a 四门（9 笔/6 人）在唯一价格窗内差 1 笔差 2 人全程未满足；探针
//     实证 7 笔时刻（t+29s）n=7/1.53B/5 钱包/+21.6% 四门全过、8 笔档第 8 笔
//     +27.8% 恰出窗=8 笔档死结——笔数门 7 是唯一能接住该点位的档。配套：
//     cheat/BP 双门 service minTicks 8→7（7 笔触发时锚窗恰过预门不
//     insufficient_ticks；笔数门与预门同线=触发即有效判定）。风险留档：
//     极早窗 7 行证据 Jev 判定方差大，由门链（cheat+BP）兜底。v5 旧 t0a
//     6 笔档（无价格门时代 69 触发被删）与 v7 删 t1 8 笔档均为不同参数，
//     本次 7 笔档带 27.5 价格门+14 腿门链环境重生。
//     priority 1 起步即最早臂，原 t0a…RL10 顺移 +1；recheck=早臂族式。
//     14 腿：t0 + t0a + t0b + t2-t4 + N30/N36/N45 + NL15/NL20/NL25
//     + RL15 + RL10
//
//   v17（2026-11-10 T133 用户四条批量裁定）：① t0 笔数门 7→6 + signalGate
//     .maxTriggers 1→2（t0 专属——「再允许 tradeCount 为 6 的数据允许过两次
//     Jev 模块」：首次 Jev 门拒后允许再判一次；无双买风险——单仓语义
//     status==='bought' 在两引擎买评估入口即阻断，第二次机会只在首次门拒/
//     执行失败时存在）；cheat/BP 双门 minTicks 7→6 同线配套（触发即过预门）
//     ② 全 t/N+NL 系十一臂价格门 27.5→28.5（BP69 统一门同车微放宽——ea78 案
//     同秒 n=8 +27.75 进 BP 锚窗被 27.5 拒 0.25pp 毫秒竞态；「只稍微宽一点，
//     再继续观察」）；RL15 ≤20/RL10 ≤10 刻意不动（已低于上界，改 28.5=放宽
//     非收紧）③ 全 14 腿加 AND actTotalBnb >= 0.1（FA act* 家族第 9 键=10s
//     滑窗买卖合计，「低活跃度」单一因子表达——「买入是不接受低活跃度」；
//     CD act 题 1 BNB/min 死寂线 10s 折算取 0.1）
//
//   ⚠ 引用本条目的新实验必须显式配 buySignalMaxPerToken ≥ 15（t0 两次 +
//   其余十三腿各 1 次触发上限；T110 默认帽 5 会截断阶梯）；并配
//   cheatCheck.enabled=true + buyPointCheck.enabled=true（两门 disabled 时：
//   cheat 门 fail-open 放行、BP 门 fail-closed 全拒=零买入，配置矛盾）。
//
// 防呆：validateLegs 纯函数本地预检零 DB；重名=已建读 id 幂等续跑（同名
// version+1，buy-v2 系惯例——挖掘/引用侧按名拉最新 version 自动跟进）。
// 在 182 跑 --commit（写操作红线）；本地仅 dry-run。
// 用法：node scripts/deploy-signal-source-strategies.cjs [--commit]
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

// CD381 重判条件（v10 起 signalGate.recheckCondition 因子表达式接棒 cheatRecheck）：
// 早臂族=unhealthy 每信号重判（≈v9 cheatRecheck=true）∪ almost_launch 重检；
// 高热度臂=仅 almost_launch 重检（≈v9 cheatRecheck=false 粘滞省配额，但价格
// 回到 ≤+20 可翻案——用户裁定「无论上次检测结果如何都需要重新检测」）
const RECHECK_EARLY = "preCheatResult == 'unhealthy' OR priceBackToAlmostLaunch == 1";
const RECHECK_STICKY = 'priceBackToAlmostLaunch == 1';

const leg = (id, priority, condition, recheckCondition, description, gateOverrides) => ({
    action: 'buy',
    priority,
    condition,
    maxExecutions: null,
    // buyPhase:'first'（v5 全腿，2026-11-07 用户裁定「每个代币只允许买入一次」）：
    // 仅 completedPairs.length===0 可见（T100 既有机制纯配置零新代码——首买/
    // 再买分臂路由）；再买轮全部不可见=每 token 恰一次买入
    buyPhase: 'first',
    // gateOverrides（v17）：t0 专属 maxTriggers 覆盖（2=首次 Jev 门拒后再判一次；
    // 单仓语义防双买——买入成功 status='bought' 即阻断后续触发评估）
    signalGate: { maxTriggers: 1, recheckCondition, bpPassLevels: ['good', 'neutral'], ...(gateOverrides || {}) },
    description,
});

const LEGS = [
    // v15 最早臂（T131，2026-11-10 吉祥 ea78 0xea7886d5…7777 开盘 25 秒窗差一笔
    // 案，用户裁定「增加一个买入臂」+ minTicks 8→7 配套）：7 笔/1 BNB/4 真持有
    // 者/≤+27.5——ea78 形状「开盘贴发行价慢攒 25 秒 → t+30s 17 笔拉到 +131%
    // 永久离开买窗」：t0a（9 笔/6 人）在唯一价格窗内差 1 笔差 2 人全程未满足、
    // 探针实证 7 笔时刻（t+29s）四门全过（1.53B/5 钱包/+21.6%）、8 笔档第 8 笔
    // +27.8% 恰出窗——笔数门 7 与 cheat/BP 双门 minTicks（8→7 同车）同线，
    // 触发即有效判定不 insufficient_ticks
    // v17（T133）：笔数门 7→6 + maxTriggers 1→2 + 价格门 28.5 + actTotalBnb
    // 门（ea78 第四跑 t0 触发正确但 BP 同秒 n=8 价 +27.8% 被统一门 27.5 拒
    // 0.25pp 竞态——用户裁定 6 笔档+两次 Jev+统一门 28.5 三件套）
    leg('t0', 1, 'tradeCount >= 6 AND buyVolumeBnb >= 1 AND holdersExDust >= 4 AND currentVsLaunchPct <= 28.5 AND actTotalBnb >= 0.1', RECHECK_EARLY,
        '最早臂（v15/T131 新增——吉祥 ea78 开盘 25 秒窗差一笔错过全窗案；v17/T133：6 笔+两次 Jev——maxTriggers 2 首次门拒后再判一次，单仓语义防双买；cheat/BP minTicks 同线 7→6）：6 笔/1 BNB/4 真持有者；价格 ≤+28.5%；10s 窗买卖合计 ≥0.1 BNB（低活跃度不买）', { maxTriggers: 2 }),
    // v12 更早人气臂（2026-11-08 高大上 0x838657df…7777 单票回测零触发复盘后
    // 用户裁定原文「增加一个 tradeCount >= 9 AND buyVolumeBnb >= 1 AND
    // holdersExDust >= 6 AND currentVsLaunchPct <= 80」）：9 笔/1 BNB/6 真持有
    // 者/≤+80——「点火即拉飞」形状在 tc 9-11、价格尚 ≤+80 的点火初段即可触发
    // （v5 旧 t0a 为 6 笔档不同参数、v6 删除，本次重生）；v15 前为 priority 1
    // 最早臂、v15 t0 插入后顺移 2
    leg('t0a', 2, 'tradeCount >= 9 AND buyVolumeBnb >= 1 AND holdersExDust >= 6 AND currentVsLaunchPct <= 28.5 AND actTotalBnb >= 0.1', RECHECK_EARLY,
        '更早人气臂（v12 新增，用户条件串原文——高大上零触发案：点火即拉飞形状 t0b 十二笔门槛差一笔错过全窗）：9 笔/1 BNB/6 真持有者；价格 ≤+80%（v14 收紧 ≤+27.5%；v17 微放宽 ≤+28.5+actTotalBnb 门；v15 顺移 p2）'),
    leg('t0b', 3, 'tradeCount >= 12 AND buyVolumeBnb >= 1 AND holdersExDust >= 6 AND currentVsLaunchPct <= 28.5 AND actTotalBnb >= 0.1', RECHECK_EARLY,
        '人气臂 b（v5 新增，v12 前为最早臂——t0a 6 笔档 2026-11-07 首跑对照后用户裁定删除、v12 以 9 笔档重生）：12 笔/1 BNB/6 真持有者；v10 加价 ≤+80%、v14 收紧 ≤+27.5%、v17 微放宽 ≤+28.5+actTotalBnb 门、v15 顺移 p3'),
    leg('t2', 4, 'tradeCount >= 16 AND buyVolumeBnb >= 1 AND holdersExDust >= 9 AND currentVsLaunchPct <= 28.5 AND actTotalBnb >= 0.1', RECHECK_EARLY,
        '阶梯 2（v4 原文）：16 笔/1 BNB/9 真持有者；v10 加价 ≤+80%、v14 收紧 ≤+27.5%、v17 微放宽 ≤+28.5+actTotalBnb 门、v15 顺移 p4'),
    leg('t3', 5, 'tradeCount >= 20 AND buyVolumeBnb >= 1.2 AND holdersExDust >= 12 AND currentVsLaunchPct <= 28.5 AND actTotalBnb >= 0.1', RECHECK_EARLY,
        '阶梯 3（v4 原文）：20 笔/1.2 BNB/12 真持有者；v10 加价 ≤+80%、v14 收紧 ≤+27.5%、v17 微放宽 ≤+28.5+actTotalBnb 门、v15 顺移 p5'),
    leg('t4', 6, 'tradeCount >= 24 AND buyVolumeBnb >= 1.5 AND holdersExDust >= 12 AND currentVsLaunchPct <= 28.5 AND actTotalBnb >= 0.1', RECHECK_STICKY,
        '阶梯 4（v4 原文）：24 笔/1.5 BNB/12 真持有者；高热度 unhealthy 粘滞秒回省配额（v10=表达式化）；v10 加价 ≤+80%、v14 收紧 ≤+27.5%、v17 微放宽 ≤+28.5+actTotalBnb 门、v15 顺移 p6'),
    leg('N30', 7, 'tradeCount >= 30 AND buyVolumeBnb >= 1.5 AND holdersExDust >= 12 AND currentVsLaunchPct <= 28.5 AND actTotalBnb >= 0.1', RECHECK_STICKY,
        '热度腿（T119 用户给定条件串原文，v4 原文）：30 笔/1.5 BNB/12 真持有者——阶梯接棒+节流下实际落点由步进节奏决定，慢热票里程碑摊开；v10 加价 ≤+80%、v14 收紧 ≤+27.5%、v17 微放宽 ≤+28.5+actTotalBnb 门、v15 顺移 p7'),
    leg('N36', 8, 'tradeCount >= 36 AND buyVolumeBnb >= 1.5 AND holdersExDust >= 12 AND currentVsLaunchPct <= 28.5 AND actTotalBnb >= 0.1', RECHECK_STICKY,
        '热度腿（T119，v4 原文）：36 笔/1.5 BNB/12 真持有者；v10 加价 ≤+80%、v14 收紧 ≤+27.5%、v17 微放宽 ≤+28.5+actTotalBnb 门、v15 顺移 p8'),
    leg('N45', 9, 'tradeCount >= 45 AND buyVolumeBnb >= 1.5 AND holdersExDust >= 12 AND currentVsLaunchPct <= 28.5 AND actTotalBnb >= 0.1', RECHECK_STICKY,
        '热度腿（T119，v4 原文）：45 笔/1.5 BNB/12 真持有者——极高热度确认，任何节奏的票 45 笔=强活跃；v10 加价 ≤+80%、v14 收紧 ≤+27.5%、v17 微放宽 ≤+28.5+actTotalBnb 门、v15 顺移 p9'),
    // v8 接近发行价臂（T122，2026-11-07 用户裁定「参考购买前检测中『接近发布价』的判断，
    // buyVolumeBnb >= 1.5/2/2.5 且接近发行价」）：currentVsLaunchPct=现价较首可靠价涨幅
    // （FA 新键），<=50 含破发=BP near_launch 同口径贴发行价区；无可靠价 null 恒 false
    // 宁拦不冒充。
    // v9（bt-v78 复盘后用户裁定「NL 三臂也根据问题调整一下，tickCount >= 10」）：
    // 三臂加 tradeCount >= 10——FA tickCount 与 tradeCount 恒等（零 return 同步 +1），
    // BP 锚 anchorTickCount ≥ tradeCount ⇒ 触发时 BP 锚窗必过 minTicks=8，
    // 不再产生 insufficient_ticks（bt-v78 53/114 漏网主源头）
    // v13 量门提高（2026-11-08 bt-v83 完整窗口 87/87 实证后用户裁定 B）：NL/RL 五臂
    // tradeCount >= 10→15 ∧ buyVolumeBnb 统一 ≥2.5——「10 笔/1.5 BNB」对整票生命
    // 周期 30~120 行的冲高砸落小票无区分度（30 行票 tradeCount 也能到 20-30，
    // 1.5 BNB 买量几分钟即凑满），量门抬到 NL25 既有线=五臂同线
    leg('NL15', 10, 'tradeCount >= 15 AND buyVolumeBnb >= 2.5 AND currentVsLaunchPct <= 28.5 AND actTotalBnb >= 0.1', RECHECK_EARLY,
        '接近发行价臂 a（v8 新增 T122；v9 加 tradeCount>=10；v13 量门提高 15 笔/2.5 BNB——bt-v83 87 票小票放行实证；v14 价格门 50→27.5、v17 微放宽 ≤+28.5+actTotalBnb 门）：现价较发行价 ≤+28.5%（含破发）——热度够+价格贴发行价'),
    leg('NL20', 11, 'tradeCount >= 15 AND buyVolumeBnb >= 2.5 AND currentVsLaunchPct <= 28.5 AND actTotalBnb >= 0.1', RECHECK_EARLY,
        '接近发行价臂 b（v8 新增 T122；v9 加 tradeCount>=10；v13 量门提高 15 笔/2.5 BNB；v14 价格门 50→27.5、v17 微放宽 ≤+28.5+actTotalBnb 门）：现价较发行价 ≤+28.5%（含破发）'),
    leg('NL25', 12, 'tradeCount >= 15 AND buyVolumeBnb >= 2.5 AND currentVsLaunchPct <= 28.5 AND actTotalBnb >= 0.1', RECHECK_EARLY,
        '接近发行价臂 c（v8 新增 T122；v9 加 tradeCount>=10；v13 量门提高 tradeCount 10→15，量 2.5 不变；v14 价格门 50→27.5、v17 微放宽 ≤+28.5+actTotalBnb 门）：现价较发行价 ≤+28.5%（含破发）——三档中最高热度确认'),
    // v10 重启臂（CD381 用户给定条件串原文，2026-11-08）：经历一定交易量后回到
    // almost_launch（currentVsLaunchPct <= 20 含破发）——重启盘入场点；BP43
    // restart 桶判形+位置门 ≤+40 配套（本腿自身 ≤20 已天然在门内）；v13 量门
    // 提高 15 笔/2.5 BNB（bt-v83 实证同上）
    leg('RL15', 13, 'tradeCount >= 15 AND buyVolumeBnb >= 2.5 AND currentVsLaunchPct <= 20 AND actTotalBnb >= 0.1', RECHECK_EARLY,
        '重启臂（v10 新增；v13 量门提高 15 笔/2.5 BNB；v17 加 actTotalBnb 门）：现价较发行价 ≤+20%（含破发）——经历交易量后回到 almost_launch 的重启盘入场点'),
    // v11 深重启臂（2026-11-08 用户裁定原文）：同 RL15 形状、价格门 ≤+10=
    // almost_launch 深半区更贴发行价的入场点（≤+20 为桶界）；v13 量门提高同上
    leg('RL10', 14, 'tradeCount >= 15 AND buyVolumeBnb >= 2.5 AND currentVsLaunchPct <= 10 AND actTotalBnb >= 0.1', RECHECK_EARLY,
        '深重启臂（v11 新增；v13 量门提高 15 笔/2.5 BNB；v17 加 actTotalBnb 门）：现价较发行价 ≤+10%（含破发）——回到 almost_launch 深半区的更贴发行价入场点'),
];

const ENTRIES = [
    {
        name: 'signal-source-ladder-v1',
        side: 'buy',
        legs: LEGS,
        description: 'T117/T119 信号源阶梯 v17（2026-11-10 v17=T133 用户四条批量：t0 笔数门 7→6 + signalGate.maxTriggers 1→2（「允许过两次 Jev 模块」——首次门拒后再判一次；单仓语义 status=bought 阻断=无双买）+ 全 14 腿加 actTotalBnb >= 0.1（FA act* 第 9 键=10s 滑窗买卖合计，「买入不接受低活跃度」——CD 1 BNB/min 死寂线 10s 折算）+ t/N/NL 十一臂价格门 27.5→28.5（BP69 统一门同车「只稍微宽一点，再继续观察」；RL15 ≤20/RL10 ≤10 已低于上界不动）+ cheat/BP 双门 minTicks 7→6 同线；v15=T131 吉祥 ea78 开盘 25 秒窗差一笔案：t0 最早臂新增 + 双门 minTicks 8→7 配套——「之后的买入点位肯定远不如早期的」，最早入场点由 t0 接住；2026-11-09 v14=T129 价格门统一 27.5：全 t/N 系八臂 80→27.5 + NL 三臂 50→27.5（用户裁定「系统不买入涨幅超过 27.5 的任何代币」）——Top10 涨幅票前期低点全在 +23.9% 以内、+27.5 以上追高无正收益分布支撑；2026-11-08 v10=CD381 六条批量裁定：全 t/N 系七臂加价格门 ≤+80、RL15 重启臂（≤+20）新增、cheatRecheck 全删 recheckCondition 表达式接棒；v11 RL10 深重启臂；v12 t0a 更早人气臂 9 笔档；v13 五臂量门 15 笔/2.5 BNB）：14 买腿 condition=初始买入信号源（t0/t0a/t0b/t2-t4 热度 + N30/36/45 纯热度 + NL15/20/25 接近发行价臂 + RL15/RL10 重启臂；全腿 buyPhase:first 每代币只买一次），maxTriggers t0=2 其余 1 触发即消耗，触发后依次过作弊门（二元版）→ BP 门（good/neutral 过）两门都过才买；纯盘面无叙事层；回测经 backtest.signalGateReal=true 真调门链（缺省回测恒拒现状不变）。⚠ 引用实验须 buySignalMaxPerToken ≥ 15 + cheatCheck.enabled + buyPointCheck.enabled',
    },
    // ── T133 两条卖出臂（2026-11-10 用户裁定「3. 卖出方面，也做一下更改：
    //    买入后有 famous 钱包在 near_launch 区间内入场，立即全部卖出，代币在
    //    价格 low 区间（不包含 near_launch 区间），活跃度掉到 low，立即全部
    //    卖出」）——「立即全部卖出」=bypassDebounce 走立即路径（不等 3.5s+5tick
    //    确认窗）+ cards:'all' 全清。两腿均 FA 因子条件（实时/回测同源）。
    {
        name: 'famous-entry-exit',
        side: 'sell',
        legs: [{
            action: 'sell',
            priority: 1,
            condition: 'sinceEntryFamousNearLaunchBuys >= 1',
            maxExecutions: null,
            cards: 'all',
            bypassDebounce: true,
            description: 'famous 进场撤离臂（T133 2026-11-10 用户裁定「买入后有 famous 钱包在 near_launch 区间内入场，立即全部卖出」）：FA 因子 sinceEntryFamousNearLaunchBuys=本仓入场锚以来 famous roster 钱包在 near_launch 区间（curVs ∈ (+10,+40]）的可靠价买入次数（T113 差值 latch 同构，FA _famousNearLaunchBuys 全史计数器）——≥1 即 famous 在 near_launch 窗口进场（BP61/65 案法：famous 在场/收割前兆），立即全清 bypass 确认窗；未持仓 null fail-closed 恒不触发',
        }],
        description: 'T133 famous 进场撤离臂 v1（2026-11-10）：sinceEntryFamousNearLaunchBuys >= 1 → 立即全清（bypassDebounce+cards:all）；FA 载体=famous-copy-wallets roster × near_launch 区间 (10,40] 可靠价买入 × 入场锚差值（setBuyState 快照/补买轮重锚）；回测同源（回放正序直计）',
    },
    {
        name: 'low-zone-stall-exit',
        side: 'sell',
        legs: [{
            action: 'sell',
            priority: 1,
            condition: 'currentVsLaunchPct > 40 AND currentVsLaunchPct <= 80 AND actTotalBnb < 0.1',
            maxExecutions: null,
            cards: 'all',
            bypassDebounce: true,
            description: '低位滞涨撤离臂（T133 2026-11-10 用户裁定「代币在价格 low 区间（不包含 near_launch 区间），活跃度掉到 low，立即全部卖出」）：currentVsLaunchPct ∈ (+40,+80]（BP43 六桶 low 档 +40~80，刻意不含 near_launch +10~40——贴发行价的低活跃是黄金点域非撤离域）AND actTotalBnb < 0.1（FA act* 第 9 键=10s 滑窗买卖合计，「低活跃度」单一因子表达——CD act 题 1 BNB/min 死寂线 10s 折算）→ 已脱离发行价区+成交枯竭=滞涨死盘，立即全清 bypass 确认窗',
        }],
        description: 'T133 低位滞涨撤离臂 v1（2026-11-10）：low 区间 (+40,+80] × actTotalBnb < 0.1 → 立即全清（bypassDebounce+cards:all）；与买入侧 actTotalBnb >= 0.1 门（T133 指令④）互为镜像——买不进低活跃、持有遇低活跃（且已脱离 near_launch）即撤',
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
