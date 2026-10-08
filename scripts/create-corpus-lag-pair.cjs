#!/usr/bin/env node
// ============================================================================
// 双门配对回测创建脚本（2026-10-08，用户裁定：「在 3473dbc0 买卖策略的基础上，
// 增加 er>=100 单门（方向1 晚票门），方向2 上个低档门（referent_memeability
// mem≤1 拦截，J1.28）」）
//
// 基底 R0（冻结，不重建）= 3473dbc0-ef2b-4964-aa74-40bfa7b4da6f
//   「回测-拱形v2重构R3-叙事引擎重测-1008-去router上界」——completed、链上真序
//   代码之上跑完（10-03 14:31Z→10-04 13:10Z，both，signals 1628/trades 234），
//   冻结结果直接当基线（corpus-lag 因子/J1.28 只影响引用它们的路径，基底策略
//   零引用 → 行为不变）。
//
// 两臂同门（唯一 config 差异 = name/description），差分靠**运行时序**隔离：
//   R1 lag 门单臂：先跑（叙事缓存全命中 = 基底同款 J1.27 行）→ diff(R1,R0) =
//      纯晚票门效应（~5min 快跑）
//   R2 lag 门+meme 低档门臂：失效窗口缓存后跑（invalidate-referent-window.cjs
//      --commit → analyze 缓存 miss 重析 J1.28 带 mem≤1 门）→ diff(R2,R0) =
//      双门总效应；diff(R2,R1) = meme 低档门 + J1.28 重析噪声
//
// 方向1 门（0fed29f9 in-window 扫描，三档用户裁定选 er>=100 单门）：
//   AND (narrativeCorpusLagSec < 300 OR earlyReturn >= 100)
//   （写 preBuy 不写主 condition：corpusLagSec 依赖叙事直调结果（主 condition
//    fire 之后才发生），earlyReturn 已注入 preBuy context（drawdownFromHighest
//    同款先例）；null lag/er → 比较恒 false → 落右臂证据门 = fail-closed（5 张
//    无语料时间票实测 4/5 亏）；负 lag = 宣告竞态 = 早票放行）
//
// 用法（182）：node scripts/create-corpus-lag-pair.cjs [--commit]
//   默认 dry-run 打印两臂配置；--commit 真建（R1、R2 各一）。
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const BASE_ID = '3473dbc0-ef2b-4964-aa74-40bfa7b4da6f';
const LAG_CUT = 300;  // 早/晚切点（秒）——0fed29f9 分化最锐切点（180/600 均次之）
const ER_CUT = 100;   // 晚票右臂「用户认同」证据阈值（earlyReturn %）
const GATE = ` AND (narrativeCorpusLagSec < ${LAG_CUT} OR earlyReturn >= ${ER_CUT})`;

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');

async function main() {
  const { ExperimentFactory } = require('../src/trading-engine/factories/ExperimentFactory');
  const factory = ExperimentFactory.getInstance();
  const base = await factory.load(BASE_ID);
  if (!base) throw new Error('基底实验不存在: ' + BASE_ID);

  const legs = [];
  for (const variant of [
    {
      key: 'R1',
      name: '回测-双门-R1-lag门单臂-lag300er100-1008',
      desc: '双门 R1（lag 门单臂）：基底 3473dbc0 整包（R3 去router上界克隆）+ preBuy 追加 '
        + '(narrativeCorpusLagSec < 300 OR earlyReturn >= 100)；先跑=叙事缓存全命中（基底同款 J1.27 行），'
        + 'diff vs 冻结 R0 = 纯晚票门效应；null lag/er fail-closed 落证据门，负 lag=宣告竞态=早票放行',
    },
    {
      key: 'R2',
      name: '回测-双门-R2-lag门+meme低档门-1008',
      desc: '双门 R2（lag 门 + meme 低档门）：config 与 R1 全同（同 GATE）；须在 '
        + 'invalidate-referent-window.cjs --commit 失效窗口 token_narrative 后跑——analyze 缓存 miss '
        + '重析 J1.28（referent_memeability 恒带 + mapper mem≤1 门「不适合成为meme币」）；'
        + 'diff vs R0 = 双门总效应，diff vs R1 = meme 低档门 + J1.28 重析噪声',
    },
  ]) {
    const cfg = JSON.parse(JSON.stringify(base.config));
    // 窗口/源/策略全同基底（同窗同源；唯一策略差异 = 买腿 preBuy 追加双门中的 lag 门）
    const buy = cfg.strategiesConfig.buyStrategies[0];
    if (/narrativeCorpusLagSec/.test(buy.preBuyCheckCondition)) throw new Error('基底 preBuy 已含 corpusLag 门——重复追加');
    buy.preBuyCheckCondition += GATE;
    cfg.name = variant.name;
    cfg.description = variant.desc;
    legs.push({ key: variant.key, cfg });
  }

  // ── dry-run 打印 ──
  for (const { key, cfg } of legs) {
    const buy = cfg.strategiesConfig.buyStrategies[0];
    console.log(`\n===== ${key} =====`);
    console.log('  name:', cfg.name);
    console.log('  condition:', buy.condition);
    console.log('  preBuy:', buy.preBuyCheckCondition);
    console.log('  backtest:', JSON.stringify(cfg.backtest));
    console.log('  卖腿数:', cfg.strategiesConfig.sellStrategies.length,
      '| PM:', JSON.stringify(cfg.positionManagement),
      '| tokenCycle:', JSON.stringify(cfg.tokenCycle),
      '| stopLoss:', JSON.stringify(cfg.stopLoss));
  }
  // 门差异唯一性检查（name/description 外逐字节全同——差分全靠时序）
  const [a, b] = legs.map(l => { const c = JSON.parse(JSON.stringify(l.cfg)); delete c.name; delete c.description; return JSON.stringify(c); });
  if (a !== b) throw new Error('两臂 config 除 name/description 外存在差异——应全同');
  if (a === JSON.stringify((() => { const c = JSON.parse(JSON.stringify(base.config)); return c; })())) {
    // 不会到这里（GATE 已追加），防御性校验门真的写进去了
    throw new Error('门未写入');
  }

  if (!COMMIT) { console.log('\n[dry-run] 未建实验；加 --commit 真建（R1、R2 各一）'); process.exit(0); }

  const ids = [];
  for (const { key, cfg } of legs) {
    const container = await factory.createFromConfig(cfg, 'backtest');
    ids.push(container.id);
    console.log('创建', key, cfg.name, '→', container.id);
  }
  console.log('\n========================================');
  console.log('R1_ID=' + ids[0]);
  console.log('R2_ID=' + ids[1]);
  console.log('R0_ID=' + BASE_ID + '（冻结基底，不重跑）');
  console.log('========================================');
  console.log('下一步（182，严格按序）：');
  console.log('  1) 跑 R1（缓存全命中 ~5min）→ compare R1 vs R0 = lag 门净效应');
  console.log('  2) node scripts/narrative/invalidate-referent-window.cjs ' + BASE_ID + ' --commit');
  console.log('  3) 跑 R2（重析 J1.28，30-90min）→ compare R2 vs R0 / R2 vs R1');
  process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
