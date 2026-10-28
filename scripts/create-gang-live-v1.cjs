#!/usr/bin/env node
// ============================================================================
// 建 gang live v1 实验行（2026-10-28 T83 用户裁定「直接实盘」）
//   平台首例 gang live：创建即买（gang-genesis-buy v1）+ trailing -5% 30min 超时
//   （gang-trail-exit v1）；GangBawTrader 半自动通道（BAW address-only 钱包）。
//   config 形状与 web 创建链（web-server.js live 分支）逐键对齐：
//     wallet={address}（BAW 第四源）| gangWs={live:{reserveNative,slippageTolerance,
//     maxGasPrice,maxPositionTokens}} | positionManagement.perCardBNB=0.002（试单
//     额度，用户裁定）| stopLoss={priceStopPercent:-50,scanIntervalSec:30}（断流票
//     扫描兜底；gang 曲线价纯函数断流罕见，保命腿独立路径）
//   maxPositionTokens=10：贴 72h 模拟全买形状（378 票全进），敞口帽 10×0.002=0.02
//     BNB + 尘票 <devMode 5000 日限额。
//   ⚠️ 库条目先在 182 跑 deploy-gang-live-strategies.cjs --commit（本脚本锚 v1）；
//     copy-in：改库不影响本实验。起跑须停 v44——一个阶段只跑一个实验，用户确认。
// 防呆：BAW 地址正则 + 库版本锚定 + 两腿 condition 锚定；重名实验拒绝。
// 用法：node scripts/create-gang-live-v1.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');
const BAW_ADDRESS = '0xFC84D51c15ACBdDCC5381fdD389Cb9c99dCE4aBd';

async function main() {
    const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
    const svc = new StrategyLibraryService();

    // ── 库条目拉取 + 锚定（copy-in 两腿）──
    const list = await svc.list('buy');
    const buyEntry = list.find(e => e.name === 'gang-genesis-buy');
    if (!buyEntry || buyEntry.version !== 1) throw new Error('库 gang-genesis-buy 缺失/版本≠1（先在 182 跑 deploy-gang-live-strategies.cjs --commit）');
    const sellList = await svc.list('sell');
    const sellEntry = sellList.find(e => e.name === 'gang-trail-exit');
    if (!sellEntry || sellEntry.version !== 1) throw new Error('库 gang-trail-exit 缺失/版本≠1');
    const buyFull = await svc.getById(buyEntry.id);
    const sellFull = await svc.getById(sellEntry.id);
    const buyLeg = (buyFull.legs.legs || buyFull.legs)[0];
    const sellLeg = (sellFull.legs.legs || sellFull.legs)[0];
    // condition 锚定（防库条目被改后误 copy-in）
    if (!buyLeg.condition.includes('tokenAgeSec < 60')) throw new Error('genesis-buy 腿缺 tokenAgeSec < 60 锚: ' + buyLeg.condition);
    if (buyLeg.cards !== 1 || buyLeg.maxExecutions !== 1) throw new Error('genesis-buy 腿 cards/maxExecutions 非 1/1');
    if (!sellLeg.condition.includes('drawdownFromHighestSinceLastBuy <= -5')) throw new Error('trail-exit 腿缺 trailing -5 锚: ' + sellLeg.condition);
    if (!sellLeg.condition.includes('holdDuration >= 1800')) throw new Error('trail-exit 腿缺 30min 超时锚');
    if (sellLeg.cards !== 'all' || sellLeg.bypassDebounce !== true) throw new Error('trail-exit 腿 cards≠all 或 bypass≠true');
    if (!/^0x[0-9a-fA-F]{40}$/.test(BAW_ADDRESS)) throw new Error('BAW 地址形状非法');

    const now = new Date().toISOString();
    const config = {
        name: 'gang-live-v1-创建即买-trail5-1028',
        description: 'T83 gang live 首例（72h/378 票模拟 trailing -5%@30min +22.27% 完胜固定 5min +13.58%）：'
            + '创建即买（tokenAgeSec<60 裸条件腿，叙事链路整机零激活）×cards1×perCardBNB 0.002（试单额度）；'
            + '卖=trailing -5% 全清 OR 30min 超时强退（bypass=true：gang 曲线价纯函数+App 确认人在环）；'
            + 'GangBawTrader 半自动通道（买全自动 BROADCASTED/卖 PENDING→App 确认）；BAW 钱包 '
            + BAW_ADDRESS + '。止损 -50% 扫描兜底独立路径。maxPositionTokens=10 贴模拟全买形状。',
        blockchain: 'bsc',
        platform: 'gang',
        kline_type: '1m',
        wallet: { address: BAW_ADDRESS },
        // live 执行参数（用户可调项四键；gangCli/熔断/超时走 default.json——引擎浅合并
        // 下 live 段整段替换，trader 内部回落值与 default gangCli 键逐键同值，无损）
        gangWs: {
            live: {
                reserveNative: 0.01,
                slippageTolerance: 20,  // gang CLI 自带 --slippage（trader 不传）；L1=preview expectTokens 校验
                maxGasPrice: 10,        // BAW 通道 gas 由 App 侧定，无操作面（落段无害，web 链同形状）
                maxPositionTokens: 10,
            },
        },
        strategiesConfig: {
            buyStrategies: [JSON.parse(JSON.stringify(buyLeg))],
            sellStrategies: [JSON.parse(JSON.stringify(sellLeg))],
            libraryRefs: [
                { name: 'gang-genesis-buy', side: 'buy', libId: buyEntry.id, version: 1, legCount: 1, snapshotAt: now },
                { name: 'gang-trail-exit', side: 'sell', libId: sellEntry.id, version: 1, legCount: 1, snapshotAt: now },
            ],
        },
        positionManagement: { perCardBNB: 0.002 },
        stopLoss: { priceStopPercent: -50, scanIntervalSec: 30 },
    };

    // ── 防重名 ──
    const { dbManager } = require('../src/services/dbManager');
    const db = dbManager.getClient();
    const { data: dup } = await db.from('experiments').select('id')
        .contains('config', { name: config.name });
    if (dup && dup[0]) throw new Error('同名实验已存在: ' + config.name + ' ' + dup[0].id);

    console.log('name:', config.name);
    console.log('platform:', config.platform, '| wallet:', JSON.stringify(config.wallet));
    console.log('buy[0]:', config.strategiesConfig.buyStrategies[0].condition, '| cards', config.strategiesConfig.buyStrategies[0].cards);
    console.log('sell[0]:', config.strategiesConfig.sellStrategies[0].condition, '| cards', config.strategiesConfig.sellStrategies[0].cards);
    console.log('perCardBNB:', config.positionManagement.perCardBNB, '| stopLoss:', JSON.stringify(config.stopLoss));
    console.log('gangWs.live:', JSON.stringify(config.gangWs.live));
    console.log('libraryRefs:', JSON.stringify(config.strategiesConfig.libraryRefs));
    if (!COMMIT) { console.log('[dry-run]'); process.exit(0); }

    const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
    const factory = ExperimentFactory.getInstance();
    const c = await factory.createFromConfig(config, 'live');
    console.log('GANG_LIVE_V1_ID=' + c.id);
    process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
