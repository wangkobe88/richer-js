#!/usr/bin/env node
// ============================================================================
// FA holders 钱包口径配对回测创建（2026-10-01，GMGN 案 B 验证，bSTOCKS 案衍生）
//
// 用法：
//   node scripts/create-holders-denomination-pair.cjs [--base <expId>] [--source <expId>]
//        [--start <ISO>] [--end <ISO>] [--suffix <str>]
//   默认：--base/source 02c60e50（buy-v2 v4 实跑虚拟实验 = config 基底 + token 集合源）
//         --start 2026-09-30T11:00:00Z（首 token 11:06:51Z 前的整点，零损失）
//         --end   2026-10-01T00:45:00Z（实验仍在跑；固定闭窗到数据齐备时刻，
//                  两臂同窗，尾部票卖腿余量按强平收尾——配对差分不受影响）
//
// 两臂（同一新代码，唯一差异变量 = sender 口径）：
//   H0 = config.backtest.stripSenderAddress: true —— 回放 tick 剥 sender → FA holders 族
//        + pre-buy top1/sniper 全部回退 trader 口径 = 修正前行为（单测 B4 bit-identical）
//   H1 = 默认（不配开关）—— wallet 口径（sender||trader COALESCE，commit 50d4138）
//   差分即「holders>5 买门 + top1 门的口径切换」在本窗的净效应
//
// ⚠️ sourceExperimentId 决定 token 全集（_loadTokenMetadata 拉源实验 experiment_tokens）；
//    02c60e50 仍在跑，创建时刻集合含 END 之后发现的 token——窗口外 token 零 tick 零信号，无害。
// ⚠️ 两臂共用 BacktestTickCache（(source,platform) 键控；strip 只剥内存回放对象不动缓存行）。
//
// 启动（182，串行防 tick 缓存双写竞态）：
//   node main.js start-experiment -e <H0_ID> && node main.js start-experiment -e <H1_ID>
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const DEFAULT_BASE = '02c60e50-1f99-4279-b71b-3d192a5018a4';
const DEFAULT_START = '2026-09-30T11:00:00.000Z';
const DEFAULT_END = '2026-10-01T00:45:00.000Z';

const args = process.argv.slice(2);
function argVal(name, dflt) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : dflt;
}
const BASE = argVal('--base', DEFAULT_BASE);
const SOURCE = argVal('--source', BASE);
const START = argVal('--start', DEFAULT_START);
const END = argVal('--end', DEFAULT_END);
const SUFFIX = argVal('--suffix', '');

async function main() {
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();
  const base = await factory.load(BASE);
  if (!base) throw new Error(`基底实验不存在: ${BASE}`);

  // buy-v2 v4 买门断言（holders>5 在主条件里 = 口径切换的作用面；漏了说明基底选错）
  const buyCond = base.config?.strategiesConfig?.buyStrategies?.[0]?.condition || '';
  if (!/holders\s*>\s*5/.test(buyCond)) {
    throw new Error(`基底买腿 condition 缺 holders 门（条件: ${buyCond}）——配对无作用面`);
  }

  const backtestSection = {
    initialBalance: 100,
    sourceExperimentId: SOURCE,
    minMaxChangePercent: 0,
    startTime: START,
    endTime: END,
  };

  // ── H0 对照臂：剥 sender = 修正前 trader 口径 ──
  const h0Config = {
    ...JSON.parse(JSON.stringify(base.config)),  // 深拷贝整包（tokenCycle/stopLoss/TPA/卡牌全保留）
    name: `回测-H0-旧trader口径-holders${SUFFIX}`,
    description: `GMGN 案 B 配对对照臂：02c60e50 config 整包（buy-v2 v4 + 17 卖腿），stripSenderAddress=true 剥 sender → holders/top1 全回退 trader 口径（=修正前行为）；源=${SOURCE.slice(0, 8)} 集合，窗 ${START}→${END}`,
    backtest: { ...backtestSection, stripSenderAddress: true },
  };
  const h0 = await factory.createFromConfig(h0Config, 'backtest');

  // ── H1 修正臂：默认 wallet 口径（不配开关）──
  const h1Config = JSON.parse(JSON.stringify(h0Config));
  delete h1Config.backtest.stripSenderAddress;
  h1Config.name = `回测-H1-钱包口径-holders${SUFFIX}`;
  h1Config.description = `GMGN 案 B 配对修正臂：同 H0 config 整包，默认 wallet 口径（sender||trader COALESCE，50d4138）；唯一差异变量 = holders/top1 口径切换；源=${SOURCE.slice(0, 8)} 集合，窗 ${START}→${END}`;
  const h1 = await factory.createFromConfig(h1Config, 'backtest');

  console.log('\n========================================');
  console.log('H0_ID=' + h0.id);
  console.log('H1_ID=' + h1.id);
  console.log('========================================');
  console.log(`启动（182，串行）：node main.js start-experiment -e ${h0.id} && node main.js start-experiment -e ${h1.id}`);
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
