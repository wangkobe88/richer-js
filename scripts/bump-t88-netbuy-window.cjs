#!/usr/bin/env node
// ============================================================================
// 库 T88 净买门 OR 臂键名断代（buy-v2 v43→v44 + buy-early-narrative v2→v3 同批）
//   单处替换（两策略同一形状）：
//     (tradesNetBuyRatio >= 40 OR tradesNetBuyRatioWin >= 40)
//       → (tradesNetBuyRatioLongWin >= 40 OR tradesNetBuyRatioShortWin >= 40)
//   背景：T88（2026-10-28 用户裁定「全量买卖比没必要，检测一个趋势」）FA 全史键
//   tradesNetBuyRatio 断代换尾 M 笔长窗 tradesNetBuyRatioLongWin；T87 短窗键
//   tradesNetBuyRatioWin 改名 tradesNetBuyRatioShortWin（观察键 WinBnb→ShortWinBnb
//   同批）。阈值 40 双臂不动（回放 fire 302/叙事 63/全量池 208 三套数据零进场扰动）。
//   ⚠️ 前置：182 已 pull T88 commit（FA 三键）——旧键名配新 FA=三防线拒启。
//   ⚠️ copy-in 快照语义：改库不影响在跑实验（v47 config 自包含旧键名），新建实验
//      引用新版本才生效（create-v48.cjs）。
// 防呆：断言两策略当前版本 + 旧 OR 臂子串恰一次 → 新子串恰一次 / 兄弟门锚定 /
//   gmgn 与 trigger 不动。
// 用法：node scripts/bump-t88-netbuy-window.cjs [--commit]   （在 182 跑）
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const COMMIT = process.argv.includes('--commit');

const OLD_OR = '(tradesNetBuyRatio >= 40 OR tradesNetBuyRatioWin >= 40)';
const NEW_OR = '(tradesNetBuyRatioLongWin >= 40 OR tradesNetBuyRatioShortWin >= 40)';
const KEEP_SEGS = [
  '(narrativeRating == 2 OR narrativeRating == 3)',
  '(platform != \'flap\' OR tradesRouterPct >= 30)',
  'top1HolderCircPct < 35',
  'maxCopyWalletHolderCircPct < 20',
  'famousCopyWalletCircPct < 15',
  'sybilClusterHolderCircPct < 35',
  'drawdownFromHighest > -70',
  'crashSpeedPctPerSec > -10',
];
const TRIGGER_EXPECT = 'buyVolumeBnb >= 0.1 OR narrativeRetryDue == 1';

const TARGETS = [
  { name: 'buy-v2', fromVersion: 43,
    keeps: [...KEEP_SEGS, 'bundleClusterHoldCircPct < 35', 'top2BundleClusterHoldCircPct < 55',
        'top3BundleClusterHoldCircPct < 75', '(tokenAgeSec < 90 OR tradeCount >= 25)',
        '(buyVolumeBnbExSybil >= 1.25 OR holdersExSybil >= 10)'],
    desc: ' | 2026-10-28 v44（T88 净买门键名断代）：全史臂 tradesNetBuyRatio → 长窗 '
        + 'tradesNetBuyRatioLongWin（尾 100 笔——用户裁定「全量买卖比没必要，检测一个趋势」，'
        + 'M=100「先定 100 吧」拍板）；短窗键 Win → ShortWin 改名。阈值 40 双臂不动（fire 302/'
        + '叙事 234/全量池 208 三套回放零进场扰动；M 档买点行为实证全档同帧）。⚠️copy-in：'
        + '需新建实验引用 v44 才生效。详档 docs/交易策略改进与Case台账.md T88' },
  { name: 'buy-early-narrative', fromVersion: 2,
    keeps: [...KEEP_SEGS, 'tokenAgeSec < 600', 'marketCap > 6.0', 'marketCap < 6.7',
        '(buyVolumeBnbExSybil >= 0.25 OR holdersExSybil >= 4)',
        'bundleClusterHoldCircPct < 45', 'top2BundleClusterHoldCircPct < 65',
        'top3BundleClusterHoldCircPct < 85'],
    cards: 3,
    desc: ' | 2026-10-28 v3（T88 净买门键名断代）：同 buy-v2 v44——全史臂换长窗 100 笔 '
        + '+ 短窗键改名，阈值 40 不动。⚠️copy-in：需新建实验引用 v3 才生效。'
        + '详档 docs/交易策略改进与Case台账.md T88' },
];

async function main() {
  const { StrategyLibraryService } = require('../src/web/services/StrategyLibraryService');
  const svc = new StrategyLibraryService();
  const list = await svc.list('buy');

  for (const t of TARGETS) {
    const entry = list.find((e) => e.name === t.name);
    if (!entry) throw new Error(`库中无 ${t.name} 条目`);
    if (entry.version !== t.fromVersion) {
      throw new Error(`${t.name} 版本=${entry.version}，期望 ${t.fromVersion}（先核对谱系再跑）`);
    }
    const full = await svc.getById(entry.id);
    const legs = full.legs.legs || full.legs;
    if (legs.length !== 1) throw new Error(`${t.name} 条目腿数=${legs.length}，期望 1`);
    let cond = legs[0].condition;
    if (cond.split(OLD_OR).length !== 2) throw new Error(`${t.name} 旧 OR 臂子串非恰好一次: ${OLD_OR}`);
    cond = cond.replace(OLD_OR, NEW_OR);
    if (cond.split(NEW_OR).length !== 2) throw new Error(`${t.name} 新 OR 臂子串非恰好一次: ${NEW_OR}`);
    for (const seg of t.keeps) {
      if (cond.split(seg).length !== 2) throw new Error(`${t.name} 防误伤锚定子串非恰一次: ${seg}`);
    }
    if (!legs[0].gmgnCheckCondition || !legs[0].gmgnCheckCondition.includes('marketCap < 10.7')) {
      throw new Error(`${t.name} gmgnCheckCondition 非预期形状（本批不动它）: ${legs[0].gmgnCheckCondition}`);
    }
    if (legs[0].narrativeTriggerCondition !== TRIGGER_EXPECT) {
      throw new Error(`${t.name} 发起门 trigger 形状非预期: ${legs[0].narrativeTriggerCondition}`);
    }
    if (t.cards != null && legs[0].cards !== t.cards) {
      throw new Error(`${t.name} cards=${legs[0].cards}，期望 ${t.cards}（6 卡制）`);
    }

    console.log(`\n== ${t.name}: v${full.version} → v${full.version + 1}`);
    console.log('new condition:', cond);
    const newDescription = (full.description || '') + t.desc;
    if (!COMMIT) { console.log('[dry-run]'); continue; }

    const outLegs = JSON.parse(JSON.stringify(legs));
    outLegs[0].condition = cond;
    const out = await svc.update(entry.id, {
      name: full.name,
      description: newDescription,
      legs: outLegs,
      expectedVersion: full.version, // 乐观并发门（update 内 version=expectedVersion+1）
    });
    console.log(`✅ committed version=${out.version}`);
  }
  if (!COMMIT) console.log('\n（dry-run 未写库；--commit 执行）');
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
