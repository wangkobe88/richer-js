// 一次性（本地）：强庄豁免组合规则搜索——档位条件 × 数值阈值网格
const fs = require('fs');
const dig = JSON.parse(fs.readFileSync('/tmp/sbp-digests.json', 'utf8'));
const FIX = require('./cheat-detection/fixtures.json');
const STRONG = ['CD21','CD23','CD41','CD45','CD60','CD73','CD98','CD127','CD191','CD223'];
const grpOf = {};
for (const c of FIX.cases) if (c.expect && c.expect.verdict) grpOf[c.caseId] = c.expect.verdict;

const S = STRONG.filter(id => dig[id] && dig[id].levels);
const pool = Object.keys(dig).filter(id => dig[id].levels && !STRONG.includes(id) && grpOf[id]);

const L = (id, q) => (dig[id].levels[q] || 'none');
const A = (id, k) => { const v = dig[id].anchors && dig[id].anchors[k]; return typeof v === 'number' ? v : null; };
const RANK = { none: 0, weak: 1, moderate: 2, strong: 3 };

// 候选豁免规则（全锚窗内可得）
function rule(id, opt) {
  if (L(id, 'wash_pair') !== 'none') return false;
  if (RANK[L(id, 'same_block_buy_wave')] < 2) return false;          // sbw ≥ moderate
  if (L(id, 'slow_grind_pump') === 'strong') return false;            // 缓推 strong 排除
  if (L(id, 'burst_spike_concentration') === 'strong') return false;  // 尖刺 strong 排除
  if (L(id, 'activity_level') === 'low') return false;                // 死盘排除
  if (opt.sameAmt != null) { const v = A(id, 'sameAmountWalletPct'); if (v == null || v >= opt.sameAmt) return false; }
  if (opt.top1 != null) { const v = A(id, 'top1HoldCircPct'); if (v == null || v >= opt.top1) return false; }
  return true;
}

for (const opt of [{ sameAmt: null, top1: null }, { sameAmt: 15, top1: null }, { sameAmt: 15, top1: 30 }, { sameAmt: null, top1: 30 }]) {
  const sHit = S.filter(id => rule(id, opt));
  const miss = pool.filter(id => rule(id, opt));
  const byG = {};
  for (const id of miss) byG[grpOf[id]] = (byG[grpOf[id]] || 0) + 1;
  console.log(`\n=== 规则（sameAmt<${opt.sameAmt ?? '∞'} top1<${opt.top1 ?? '∞'}）===`);
  console.log(`强庄命中 ${sHit.length}/10：${sHit.map(id => id + '(' + grpOf[id] + ')').join(' ')}`);
  console.log(`误豁 ${miss.length}/${pool.length}：${JSON.stringify(byG)} ${miss.join(',')}`);
}

// 逐条件贡献拆解（基础五档位条件）
console.log('\n=== 条件贡献（对强庄 10 与全部对照误豁）===');
const conds = {
  'wash=none': id => L(id, 'wash_pair') === 'none',
  'sbw≥mod': id => RANK[L(id, 'same_block_buy_wave')] >= 2,
  'pump≠strong': id => L(id, 'slow_grind_pump') !== 'strong',
  'spike≠strong': id => L(id, 'burst_spike_concentration') !== 'strong',
  'act≠low': id => L(id, 'activity_level') !== 'low',
};
let acc = [...S, ...pool];
console.log('起点', acc.length, `（强庄 ${acc.filter(i => STRONG.includes(i)).length}）`);
for (const [name, f] of Object.entries(conds)) {
  acc = acc.filter(f);
  console.log(`+${name} → 剩 ${acc.length}（强庄 ${acc.filter(i => STRONG.includes(i)).length}/10，误豁 ${acc.filter(i => !STRONG.includes(i)).join(',') || '无'}）`);
}
