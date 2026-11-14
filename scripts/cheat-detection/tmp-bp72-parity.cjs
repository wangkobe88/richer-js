// 一次性对拍（182 跑）：BP72 两臂（v100 族二裁定）——fresh gateBuyPoint persist:false。
//   臂 A（问题一 7 票）：本地买方缺席的单边下跌段（「先买入拉起、然后只有卖出」）→ 期望 entry_shape 翻 crash → entry_gate 拒
//   臂 B（问题二 6 票）：近期暴跌后的余波小活跃（近 30s 未收复深 5s 段）→ 期望 crash → entry_gate 拒
//   B2（臂 B 正例 2 票）：f485/40a2——旧「数值双中形态照常照放」判例已被用户裁定推翻（「暴跌后的交易小活跃期
//   ……显然也不是正常的交易换手」）：买点深段未收复坐实 → 期望 crash（首跑 0.94/0.97 已翻=方向正确）
//   RE（真保护 3 票）：a813 阶梯阴跌/米+施工鸭 对倒正例 → 期望 entry_gate 不拦（综合拒非 entry 责任不算失败）
//   OB（观察 2 票）：28ad/c84a——生产锚本就 crash（非放行反例）；修正判据下走向两可（28ad V 形收复判据应放/
//   c84a 平缓换手判据应放，但生产锚数值未取证明），读数留档不计达成
// 锚=生产最后一条带 buyPoint metadata 的 BUY 信号行（放行/拒点位即生产实际评估点）。
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');

const V100 = '11fc182a-b051-4665-857c-5c14e6713334'; // bt-v100
const V95 = '675c71a1-0e19-49b6-924b-facffc073afd';   // bt-v95
const V94 = '85cbad14-696f-49b2-baa4-a5407df4a2d2';   // bt-v94
const TOKENS = [
  // 臂 A：本地买方缺席的单边下跌段（问题一）
  { g: 'A', exp: V100, key: 'idx19-Flap',      addr: '0xe622a0ec83546b63db65e9b9bf5c225aec417777', expect: '翻 crash → entry_gate 拒' },
  { g: 'A', exp: V100, key: 'idx26-LABU',      addr: '0x1ac4a310874e29290720d2fb55300a91a23e7777', expect: '翻 crash → entry_gate 拒' },
  { g: 'A', exp: V100, key: 'idx181-汤圆',     addr: '0xeaeb67c29c73d86da820265748e4f043871d7777', expect: '翻 crash → entry_gate 拒' },
  { g: 'A', exp: V100, key: 'idx52-王涛',      addr: '0x1cf8569749438a7bea491438383698040207ffff', expect: '翻 crash → entry_gate 拒' },
  { g: 'A', exp: V100, key: 'idx98-불개미',    addr: '0xb54e248fae36131958085f2ec5524de4c3524444', expect: '翻 crash → entry_gate 拒' },
  { g: 'A', exp: V100, key: 'idx175-海水过滤器', addr: '0x30238ffd6137cd0fa70e681d0d5585d413cbffff', expect: '翻 crash → entry_gate 拒' },
  { g: 'A', exp: V100, key: 'idx185-CR',       addr: '0x57d431ae0a47d57be9bae3623ce35fb805747777', expect: '翻 crash → entry_gate 拒' },
  // 臂 B：近期暴跌后的余波小活跃（问题二）
  { g: 'B', exp: V100, key: 'idx5-苹果SI',     addr: '0xc9bf4530033f6497002d228296fedb45036f7777', expect: '翻 crash → entry_gate 拒' },
  { g: 'B', exp: V100, key: 'idx168-LOVE',     addr: '0xf0b83df726bba9a8a01fcd5da0b2303e83ca7777', expect: '翻 crash → entry_gate 拒' },
  { g: 'B', exp: V100, key: 'idx190-赵公主',   addr: '0x258e485725b8d799b885b9f079241e2c812d7777', expect: '翻 crash → entry_gate 拒' },
  { g: 'B', exp: V100, key: 'idx195-币安之心', addr: '0x08aa150d7d86c4a0dfa37f310c1380de9c187777', expect: '翻 crash → entry_gate 拒' },
  { g: 'B', exp: V100, key: 'idx206-蝴蝶人生路', addr: '0xb359716d1affde1fb9d351fec71a0f2e79257777', expect: '翻 crash → entry_gate 拒' },
  { g: 'B', exp: V100, key: 'idx210-屎壳郎自拉', addr: '0x2ef6c0e630d34b78ad36aabe04cd90f57e3c7777', expect: '翻 crash → entry_gate 拒' },
  // A2：a813——BP58 时代仅看尾段+价格形态曾放行的阶梯阴跌票，按 BP72 近窗延展收回臂 A 正例
  //   （近 30s 买 0.04×3/卖 0.55×10 买方整体缺席——用户裁定看「买入前一段时间（或者说一批交易）」）
  { g: 'A2', exp: V95, key: 'A2-a813-近窗买方缺席', addr: '0xa813cd684ce664d2dcde26797246e3b4ffd37777', expect: 'crash → entry_gate 拒（BP72 收回正例）' },
  // B2：臂 B 正例（旧「形态照常照放」判例被用户裁定推翻——深段未收复坐实照拒）
  { g: 'B2', exp: V94, key: 'B2-f485-深段未收复巨量', addr: '0xf485ec1d518185e73ca53164ddaa85dcfde77777', expect: 'crash（臂 B 正例：-26.7% 距 27s 未收复 -39.8+近窗双边巨量=出货承接进行时）' },
  { g: 'B2', exp: V94, key: 'B2-40a2-接刀未收复',     addr: '0x40a2e8f5ceb8ee6aec025512596b9ffaaa954444', expect: 'crash（臂 B 正例：-27.1% 距 1s+chg5 -20.8 接刀进行时）' },
  // RE：真保护（BP72 不得误伤——entry_gate 不拦；综合拒非 entry 责任不算失败）
  // a813 已按 BP72 近窗延展收回臂 A 正例（近 30s 买 0.04×3/卖 0.55×10 买方整体缺席——用户原话「买入前一段时间（或者说一批交易）」正是问题一形状）挪入 A 组 expect crash
  { g: 'RE', exp: V95, key: 'RE-米-对倒',        addr: '0x338a510c6c7abd4c714d74225086542270427777', expect: 'entry_gate 不拦' },
  { g: 'RE', exp: V95, key: 'RE-施工鸭-对倒',    addr: '0x459f1d098437fad48931372f9b16b6ad25297777', expect: 'entry_gate 不拦' },
  // OB：观察票（生产锚本就 crash 非放行反例；修正判据下走向两可，读数留档不计达成）
  { g: 'OB', exp: V95, key: 'OB-28ad-生产已crash', addr: '0x28ad2c7d08d83a85467bd4afcfd673dfce564444', expect: '观察（生产 crash；臂 B 反例判据 V 形收复应放——翻 normal_dip=判据生效/维持 crash=Jev 未采信收复证据攒批）' },
  { g: 'OB', exp: V95, key: 'OB-c84a-生产已crash', addr: '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', expect: '观察（生产 crash；BP66 平缓换手判据应放——同上两可读数留档）' },
];
const logger = { info() {}, warn() {}, error() {} };
// ONLY=key1,key2 过滤 + REPEAT=N 每票重复跑（方差确认用）
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map((s) => s.trim()) : null;
const REPEAT = Number(process.env.REPEAT || 1);

async function main() {
  const client = await dbManager.getClient();
  const addrs = TOKENS.map((t) => t.addr);
  const { data: creates } = await client.from('wss_events')
    .select('token_address,payload').eq('kind', 'token_create').in('token_address', addrs);
  const metaBy = new Map((creates || []).map((r) => [r.token_address, r.payload || {}]));
  const { data: etRows } = await client.from('experiment_tokens')
    .select('token_address,platform').in('experiment_id', [V100, V95, V94]).in('token_address', addrs);
  const platBy = new Map((etRows || []).map((r) => [r.token_address, r.platform]));

  const bp = new BuyPointCheckService({
    enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false,
  }, logger, {});

  let hit = 0, total = 0;
  for (const t of ONLY ? TOKENS.filter((x) => ONLY.some((k) => x.key.includes(k))) : TOKENS) {
    for (let rep = 1; rep <= REPEAT; rep++) {
    const { data: sigs, error } = await client.from('strategy_signals')
      .select('id,created_at,metadata').eq('experiment_id', t.exp).eq('signal_type', 'BUY')
      .eq('token_address', t.addr).order('created_at', { ascending: true }).limit(60);
    if (error || !sigs || !sigs.length) { console.log(`[${t.g}] ${t.key} 无信号行跳过`); continue; }
    const withBp = sigs.filter((s) => s.metadata && s.metadata.buyPoint);
    const anchor = withBp.length ? withBp[withBp.length - 1] : sigs[sigs.length - 1];
    const anchorMs = Date.parse(anchor.created_at);
    const p = metaBy.get(t.addr) || {};
    const meta = { address: t.addr, symbol: p.symbol || null, name: p.name || null, platform: platBy.get(t.addr) || p.platform || 'fourmeme' };
    const r = await bp.gateBuyPoint(t.addr, meta, { experimentId: 'bp72-parity' }, { anchorMs });
    const a = r.assessment || {}, d = r.dimensions || {}, an = r.anchors || {};
    const dim = (k) => { const o = d[k] || {}; return `${o.bucket}(${o.prob != null ? Number(o.prob).toFixed(2) : '?'})`; };
    const prodBp = anchor.metadata && anchor.metadata.buyPoint ? (anchor.metadata.buyPoint.assessment || {}).bucket : '?';
    const prodEntry = anchor.metadata && anchor.metadata.buyPoint ? ((anchor.metadata.buyPoint.dimensions || {}).entry_shape || {}).bucket : '?';
    total++;
    let okExpect;
    if (t.g === 'OB') { okExpect = null; } // 观察票不计达成
    else if (t.g === 'RE') { okExpect = a.rule !== 'entry_gate' && ((d.entry_shape || {}).bucket !== 'crash'); }
    else { okExpect = a.rule === 'entry_gate' || ((d.entry_shape || {}).bucket === 'crash'); } // A/B/B2
    if (okExpect === true) hit++;
    if (okExpect === null) total--;
    console.log(`[${t.g}]${REPEAT > 1 ? `#${rep}` : ''} ${t.key} 锚${anchor.created_at.slice(11, 19)} 生产=${prodBp}/entry=${prodEntry}` +
      ` → 新=${r.status} 综=${a.bucket}(${a.rule}) entry=${dim('entry_shape')} act=${dim('activity_level')}` +
      ` chg5=${an.chg5Pct ?? '?'} v=${r.questionVersion ?? '?'} ${okExpect === null ? '👁' : okExpect ? '✅' : '⚠️'} || 期望=${t.expect}`);
    if (a.reasons && a.reasons.length) console.log(`   reasons=${JSON.stringify(a.reasons).slice(0, 240)}`);
    }
  }
  console.log(`\n达成 ${hit}/${total}`);
  const stats = bp.getStats ? bp.getStats() : {};
  console.log('stats=' + JSON.stringify(stats).slice(0, 400));
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
