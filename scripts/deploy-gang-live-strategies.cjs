#!/usr/bin/env node
// ============================================================================
// gang live 策略库条目部署（2026-10-28 用户裁定「直接实盘」）
//   1. 买腿条目 gang-genesis-buy：创建即买（裸条件腿=叙事链路整机零激活——
//      无 narrativeCall/Trigger/preBuy/gmgn 任一字段，prefetch no-op/trigger 早退/
//      无否决短路，已核实）。E2 语义：创建者首买与 Created 同 tx，首个 Buy tick
//      →去抖→ fire，tokenAgeSec<60 覆盖；maxExecutions=1 生命周期一次；
//      cards=1 × perCardBNB=0.002（试单额度，用户裁定）
//   2. 卖腿条目 gang-trail-exit：trailing -5%（峰值回撤）+ 30min 超时强退
//      （2026-10-28 用户裁定，72h/378 票模拟 trailing -5%@30min +22.27% 完胜
//      固定 5min +13.58%，回撤挡单调递增无二次冲高形状）
//      - drawdownFromHighestSinceLastBuy = FA 价格口径负值（峰源离群剔除链，
//        按 fire 价锚体系，T80 v44 已在 live 消费——零新机制）
//      - bypassDebounce=true：gang 曲线价=纯函数（Q=Q0+dw4），无 tick=价格真
//        冻结，等 tick 确认无意义；且卖出须 App 人工确认（分钟级人在环），引擎
//        侧 3.5s+5tick 确认窗拖延 App 确认窗口（与现行「卖腿 bypass=false」裁定
//        的语境差异：该裁定防 AMM 快照失真，gang 曲线无此形状）
//
// 防呆：validateLegs 纯函数本地预检零 DB；重名=已建读 id 幂等续跑。
// 在 182 跑 --commit（写操作红线）；本地仅 dry-run。
// 用法：node scripts/deploy-gang-live-strategies.cjs [--commit]
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const BUY_LEG = {
    action: 'buy',
    priority: 1,
    condition: 'currentPrice > 0 AND tokenAgeSec < 60',
    maxExecutions: 1,
    cards: 1,
    description: 'gang 创建即买（E2：出生冲量市场，72h 模拟 +22.27%/票 @trailing -5% 出场）。裸条件腿叙事链路整机零激活（gang 叙事恒 miss，buy-v2 的 narrativeRating==2 OR 3 腿永不买）；gang 集中度门刻意不照搬 buy-v2（gang 基线 bundle 88%/even 57% 爆表）。maxExecutions=1 生命周期恰买一次；cards=1 × perCardBNB（实验级 0.002 试单额度）',
};

const SELL_LEG = {
    action: 'sell',
    priority: 1,
    condition: 'drawdownFromHighestSinceLastBuy <= -5 OR holdDuration >= 1800',
    cards: 'all',
    cooldownSec: null,
    bypassDebounce: true,
    description: 'gang trailing -5% 全清 + 30min 超时强退（2026-10-28 用户裁定：72h/378 票模拟 trailing -5%@30min +22.27% 完胜固定 5min +13.58%，回撤挡单调递增；出生冲量市场到峰中位 12s、峰后长尾阴跌不回头，出场点=峰值×0.95）。drawdownFromHighestSinceLastBuy=FA 价格口径负值（T80 已消费零新机制）；bypass=true：gang 曲线价纯函数无 tick=价格真冻结+卖出须 App 确认（半自动通道），引擎确认窗无意义拖延；cooldown 不设（卖出失败每轮重试直到清仓，与现行裁定一致）',
};

const ENTRIES = [
    { name: 'gang-genesis-buy', side: 'buy', legs: [BUY_LEG] },
    { name: 'gang-trail-exit', side: 'sell', legs: [SELL_LEG] },
];

async function main() {
    // ── 本地纯函数预检（零 DB）：validateLegs 三防线认得全部因子 ──
    const { validateLegs } = require('../src/web/services/StrategyLibraryService');
    for (const e of ENTRIES) {
        const check = validateLegs(e.side, e.legs);
        if (!check.valid) throw new Error(`validateLegs 拒绝 ${e.name}: ` + check.errors.join('; '));
        console.log(`[OK] validateLegs(${e.side}) 零错误: ${e.name}`);
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
            console.log(`[DRY-RUN] 库条目将 INSERT: ${e.name} side=${e.side}`);
            console.log('  condition:', e.legs[0].condition);
            continue;
        }
        const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
        const svc = new StrategyLibraryService();
        const created = await svc.create({
            name: e.name, description: e.legs[0].description || '', side: e.side, legs: e.legs,
        });
        console.log(`[OK] strategy_library INSERT: ${created.id} ${e.name} side=${e.side} version=${created.version}`);
    }
    if (!COMMIT) console.log('\n[DRY-RUN] 未写入。182 上 --commit 执行');
    process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
