// 一次性探针（182 跑）：bt-v95 十票+bt-v94 用户新点三票 entry 锚全打印——定 crash「当下急跌」必要条件判读线。
// 需全中：LOVE/STOCKLESS/币安之心（1 类砸盘）；需全不中：28ad/c84a/f485/a813/40a2（用户判慢跌可接受）+米/施工鸭（2 类放行）。
const { dbManager } = require('../../src/services/dbManager.js');

const EXPS = {
  v95: '675c71a1-0e19-49b6-924b-facffc073afd',
  v94: '85cbad14-696f-49b2-baa4-a5407df4a2d2',
};
const TOKENS = [
  { exp: 'v95', tag: 'LOVE-砸盘(应crash)', addr: '0xf0b83df726bba9a8a01fcd5da0b2303e83ca7777' },
  { exp: 'v95', tag: 'STOCKLESS-砸盘(应crash)', addr: '0xb6f4e229d446747c41dc1c7eb631816f95f17777' },
  { exp: 'v95', tag: '币安之心-砸盘(应crash)', addr: '0x08aa150d7d86c4a0dfa37f310c1380de9c187777' },
  { exp: 'v95', tag: '米-对倒(应放行)', addr: '0x338a510c6c7abd4c714d74225086542270427777' },
  { exp: 'v95', tag: '施工鸭-对倒(应放行)', addr: '0x459f1d098437fad48931372f9b16b6ad25297777' },
  { exp: 'v95', tag: '苍蝇-衰减(应拒)', addr: '0x04323e04c5f48587951c2d974b7f1b007b6e7777' },
  { exp: 'v95', tag: 'YiYi-尖刺(应拒)', addr: '0xbfc8f025427ef4049b6d679c0506cdf2b4164444' },
  { exp: 'v95', tag: '28ad-restart(用户:非crash)', addr: '0x28ad2c7d08d83a85467bd4afcfd673dfce564444' },
  { exp: 'v95', tag: 'c84a-慢跌(用户:非crash)', addr: '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777' },
  { exp: 'v95', tag: 'a8e70(用户:应pvp)', addr: '0xa8e70ca07b68a07683c963513a26f2fa91647777' },
  { exp: 'v94', tag: 'f485-慢跌(用户:可接受)', addr: '0xf485ec1d518185e73ca53164ddaa85dcfde77777' },
  { exp: 'v94', tag: 'a813-慢跌(用户:可接受)', addr: '0xa813cd684ce664d2dcde26797246e3b4ffd37777' },
  { exp: 'v94', tag: '40a2-慢跌(用户:可接受)', addr: '0x40a2e8f5ceb8ee6aec025512596b9ffaaa954444' },
];
// 新判读线（BP58 二修草案）：①当下急跌臂 chg5<=-10 ∨ chg10<=-15 ∨ chg30<=-25；②深跌∧未止跌 (curVsAth<=-25 ∨ nDn5<=-15 ∨ minGap<=2pp) ∧ (chg5<=-5 ∨ chg10<=-10)
function arms(an) {
  const n = (k) => Number(an[k]);
  const a1 = n('chg5Pct') <= -10 || n('chg10Pct') <= -15 || n('chg30Pct') <= -25;
  const deep = n('currentVsAthPct') <= -25 || n('nearMaxDn5Pct') <= -15 || n('curVsMinGapPct') <= 2;
  const falling = n('chg5Pct') <= -5 || n('chg10Pct') <= -10;
  return { a1, a2: deep && falling };
}

async function main() {
  const client = await dbManager.getClient();
  for (const t of TOKENS) {
    const { data: sigs, error } = await client.from('strategy_signals')
      .select('id,created_at,metadata')
      .eq('experiment_id', EXPS[t.exp]).eq('token_address', t.addr)
      .order('id', { ascending: true }).limit(30);
    if (error) { console.log(`${t.tag} 查询错误: ${error.message}`); continue; }
    const bps = (sigs || []).filter((s) => s.metadata && s.metadata.buyPoint);
    if (!bps.length) { console.log(`\n${t.tag}: 无 BP 信号行`); continue; }
    console.log(`\n## ${t.tag}（${bps.length} 条 BP 信号，打前 5）`);
    for (const s of bps.slice(0, 5)) {
      const bp = s.metadata.buyPoint, an = bp.anchors || {}, d = bp.dimensions || {}, a = bp.assessment || {};
      const es = (d.entry_shape || {}).bucket;
      const ar = arms(an);
      console.log(`${s.created_at.slice(11, 19)} 综=${a.bucket}/${a.rule} entry=${es} 新线=${ar.a1 || ar.a2 ? (ar.a1 ? '①急跌' : '') + (ar.a2 ? '②深跌未止' : '') : '不中'} | curVs=${an.currentVsLaunchPct} curVsAth=${an.currentVsAthPct} chg5=${an.chg5Pct} chg10=${an.chg10Pct} chg30=${an.chg30Pct} nUp5=${an.nearMaxUp5Pct} nDn5=${an.nearMaxDn5Pct} minGap=${an.curVsMinGapPct}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
