#!/usr/bin/env node
// ============================================================================
// 虚拟↔回测一致性配对（2026-10-10）：a21fa102 虚拟实验（both 事实采集器，
// v6+hg55 门策略线，实跑净 -1.09 BNB / 21 买）同窗同源回测。
//
// 配对口径（差距收敛到引擎管线本身）：
//   - sourceExperimentId = a21fa102 自己 → 回测 token 集合 = 它的
//     experiment_tokens（17871 个，both 全量采集），ticks 按 token 集合全局拉
//     → 两边看到完全相同的 ticks 数据（虚拟自己就是采集器）
//   - 策略整包克隆零改动（买腿 v6+hg55+corpusLag 门 / 5 卖腿 / PM 卡牌 /
//     tokenCycle / stopLoss / TPA）
//   - startTime = 实验创建时刻（10-08 14:37:30Z），endTime = 本脚本运行时刻
//   - 叙事缓存天然一致：虚拟实时分析结果已落 token_narrative，回测直调命中
//
// 用法：node scripts/create-a21fa102-parity-backtest.cjs [--commit]
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const BASE_ID = 'a21fa102-aa00-4d98-b0d9-65f4a2323459';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
// --reuse-window <btId>：复用指定回测实验的窗口（数据点 B/C 控制变量——与 A 同窗，
// 唯一变量是引擎补丁；缺省 = 起点=基底创建时刻、终点=当前时刻）
// --suffix <str>：name/description 尾缀（默认按 REUSE_WINDOW 有无给 '-B止损毕业补齐'；
// 数据点 C 起显式传，如 --suffix '-C前视修复'）
const rwIdx = args.indexOf('--reuse-window');
const REUSE_WINDOW_ID = rwIdx > -1 ? args[rwIdx + 1] : null;
const sfxIdx = args.indexOf('--suffix');
const SUFFIX = sfxIdx > -1 ? args[sfxIdx + 1] : (REUSE_WINDOW_ID ? '-B止损毕业补齐' : '');

async function main() {
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();
  const base = await factory.load(BASE_ID);
  if (!base) throw new Error('基底实验不存在: ' + BASE_ID);

  const cfg = JSON.parse(JSON.stringify(base.config));
  const { dbManager } = require('../src/services/dbManager');
  const client = dbManager.getClient();
  let startTime, endTime;
  if (REUSE_WINDOW_ID) {
    const { data: rw, error } = await client.from('experiments').select('config').eq('id', REUSE_WINDOW_ID).single();
    if (error || !rw?.config?.backtest) throw new Error('复用窗口实验不存在或无 backtest 段: ' + REUSE_WINDOW_ID);
    startTime = rw.config.backtest.startTime;
    endTime = rw.config.backtest.endTime;
    console.log('复用窗口自', REUSE_WINDOW_ID, ':', startTime, '→', endTime);
  } else {
    // 窗口：起点 = 基底创建时刻（其首 token 14:38:13 晚 43s，覆盖完整）；终点 = 当前时刻
    const { data: expRow } = await client.from('experiments').select('created_at').eq('id', BASE_ID).single();
    if (!expRow?.created_at) throw new Error('查不到基底 created_at');
    startTime = expRow.created_at;
    endTime = new Date().toISOString();
  }
  cfg.backtest = {
    sourceExperimentId: BASE_ID,
    startTime,
    endTime,
  };
  cfg.name = '回测-虚拟一致性对拍-a21fa102同窗同源-1010' + SUFFIX;
  cfg.description = '虚拟↔回测一致性配对：a21fa102 整包克隆（v6+hg55+corpusLag 门策略 / both / '
    + 'PM 卡牌 / stopLoss / TPA），sourceExperimentId=自身 → token 集合与 ticks 完全同源；'
    + '窗口 ' + startTime + ' → ' + endTime + '。'
    + (REUSE_WINDOW_ID ? '同窗数据点：复用 ' + REUSE_WINDOW_ID.slice(0, 8) + ' 窗口（引擎补丁变量隔离重跑）。' : '对拍虚拟实跑 21 买 20 卖净 -1.09 BNB。');

  // 差异唯一性自检：除 name/description/backtest 外与基底逐字节全同
  const stripped = JSON.parse(JSON.stringify(cfg));
  delete stripped.name; delete stripped.description; delete stripped.backtest;
  const baseStripped = JSON.parse(JSON.stringify(base.config));
  delete baseStripped.name; delete baseStripped.description;
  if (JSON.stringify(stripped) !== JSON.stringify(baseStripped)) {
    throw new Error('克隆校验失败：除 name/description/backtest 外存在差异');
  }

  console.log('===== 配对回测 =====');
  console.log('  name:', cfg.name);
  console.log('  backtest:', JSON.stringify(cfg.backtest));
  console.log('  策略: 买', cfg.strategiesConfig.buyStrategies.length, '腿 / 卖', cfg.strategiesConfig.sellStrategies.length, '腿');
  console.log('  PM:', JSON.stringify(cfg.positionManagement), '| tokenCycle:', JSON.stringify(cfg.tokenCycle));
  console.log('  stopLoss:', JSON.stringify(cfg.stopLoss));
  console.log('  TPA:', JSON.stringify(cfg.tokenPositionAnalyzer)?.slice(0, 200));

  if (!COMMIT) { console.log('\n[dry-run] 未建实验；加 --commit 真建'); process.exit(0); }

  const container = await factory.createFromConfig(cfg, 'backtest');
  console.log('\n创建成功 →', container.id);
  console.log('PAIR_BASE=' + BASE_ID);
  console.log('PAIR_BACKTEST=' + container.id);
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
