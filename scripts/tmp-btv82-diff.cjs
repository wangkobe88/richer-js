// 一次性：bt-v82 vs bt-v81 票级差异对拍——消失 4 票拦点/新进 6 票原拦点/六判例
// 182 跑。用法：node scripts/tmp-btv82-diff.cjs
const { dbManager } = require('../src/services/dbManager.js');

const V81 = 'a5b43ad1-78b0-450e-bd9d-3dde74fbf713';
const V82 = 'd8d3f246-6767-4192-804c-3dabdeb15baa';
const GONE = ['0x78cd05', '0x0cd4ce', '0x600c92', '0x275c17']; // v81 有 v82 无（前缀）
const NEW = ['0x73d03d', '0x32f18a', '0x25c6fb', '0x77777b', '0x459f1d', '0xd16d9a']; // v82 新进
const SIX = [
  '0xcb70708ebe85cd4de4735776feef20d9c3654444',
  '0x94ea754b80bbafd776accf85d0df7f92dd73ffff',
  '0xb788e63b15c2dfa508bb9c52b34d287d07f47777',
  '0xd0fbcc7be56f6e8eb1e9be01f456de0093ee7777',
  '0x4b3f1f7a70fbc09b54c4ca209749c5124055ffff',
  '0x06810806709ae1082214624d447669e9014a7777',
];
const parse = (m) => { try { return typeof m === 'string' ? JSON.parse(m) : (m || {}); } catch { return {}; } };

async function pull(c, exp) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await c.from('strategy_signals')
      .select('id,token_address,created_at,metadata,signal_type')
      .eq('experiment_id', exp).order('id').range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}
function pathOf(s) {
  const m = parse(s.metadata);
  const cc = m.cheatCheck, bp = m.buyPoint, a = (bp && bp.assessment) || {};
  const pat = bp && bp.dimensions && bp.dimensions.market_pattern ? bp.dimensions.market_pattern : null;
  const cheat = !cc ? '无段' : cc.grade + (cc.exempt ? '(豁免←' + cc.exempt.originalGrade + ')' : '') + (cc.exemptDenied ? '[denied:' + cc.exemptDenied + ']' : '');
  const bpS = !bp ? '无BP段' : (a.bucket || bp.status) + (a.rule ? '(' + a.rule + ')' : '') + (pat && pat.bucket ? '[' + pat.bucket + ']' : '') + (pat && pat.exempt ? '{机械门豁免:' + pat.exempt.code + '}' : '');
  return { at: s.created_at, exec: m.execution_status, cheat, bp: bpS };
}

(async () => {
  const c = await dbManager.getClient();
  const s81 = await pull(c, V81), s82 = await pull(c, V82);
  for (const [label, prefixes, src, other, otherTag] of [
    ['v82 消失票（v81 成交）', GONE, s81, s82, 'v82'],
    ['v82 新进票（v81 被拦）', NEW, s82, s81, 'v81'],
    ['CD380 六判例', SIX.map(x => x.slice(0, 8)), s82, s81, 'v81'],
  ]) {
    console.log(`\n===== ${label} =====`);
    for (const p of prefixes) {
      const a = src.filter(s => s.token_address && s.token_address.startsWith(p) && s.signal_type === 'BUY');
      const b = other.filter(s => s.token_address && s.token_address.startsWith(p) && s.signal_type === 'BUY');
      const pa = a.map(pathOf), pb = b.map(pathOf);
      console.log(`${p}… 信号数 ${label.includes('消失') ? 'v81=' + a.length + ' v82=' + b.length : 'v82=' + a.length + ' v81=' + b.length}`);
      for (const x of pa) console.log(`  [主] @${x.at} exec=${x.exec} | cheat=${x.cheat} | bp=${x.bp}`);
      for (const x of pb.slice(0, 3)) console.log(`  [对] @${x.at} exec=${x.exec} | cheat=${x.cheat} | bp=${x.bp}`);
      if (pb.length > 3) console.log(`  [对] …另 ${pb.length - 3} 行`);
    }
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
