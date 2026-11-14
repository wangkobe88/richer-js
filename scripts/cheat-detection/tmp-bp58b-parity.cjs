// 一次性对拍（182 跑）：BP58 二修（判型恢复+crash 形态判读）——fresh gateBuyPoint persist:false，锚=首 BUY 信号行 created_at。
// 矩阵：
//   crash 拦（形态复核后仍直线砸落）：LOVE（拉顶后连续两桶 -16.9/-16.1 零反弹）/STOCKLESS（顶上 3s 单段 -22.3 直砸）
//   用户五票「能接受的盘形」（crash 数值命中但形态=阶梯/震荡/阴跌应救回 normal_dip；终态不作预设只验非 crash 拒）：
//     f485/a813/40a2（bt-v94）+ c84a/28ad（bt-v95）
//   判型验证：a8e70 应判②retail_pvp（在场加硬——两 0.2 级钱包买点前 8~9s 已清仓离场）→ pattern_gate 拒
//   放行：米/施工鸭（对倒低价 normal_dip → neutral）；拒：YiYi（spike 贴顶+统一门）
//   观察（不作预设）：币安之心/苍蝇（首版判 crash 拒/衰减拦——二修形态判读下不预设，只留判读）
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');

const V94 = '85cbad14-696f-49b2-baa4-a5407df4a2d2'; // bt-v94
const V95 = '675c71a1-0e19-49b6-924b-facffc073afd'; // bt-v95
const TOKENS = [
  { exp: V94, key: 'LOVE-砸盘',      addr: '0xf0b83df726bba9a8a01fcd5da0b2303e83ca7777', expect: '拒 entry_gate(crash 形态)' },
  { exp: V94, key: 'STOCKLESS-砸盘', addr: '0xb6f4e229d446747c41dc1c7eb631816f95f17777', expect: '拒 entry_gate(crash 形态)' },
  { exp: V94, key: 'f485-用户放',    addr: '0xf485ec1d518185e73ca53164ddaa85dcfde77777', expect: '非 crash 拒（震荡下行 -62% 穿插反弹段）' },
  { exp: V94, key: 'a813-用户放',    addr: '0xa813cd684ce664d2dcde26797246e3b4ffd37777', expect: '非 crash 拒（阶梯阴跌 -52% 段间企稳）' },
  { exp: V94, key: '40a2-用户放',    addr: '0x40a2e8f5ceb8ee6aec025512596b9ffaaa954444', expect: '非 crash 拒（用户裁定可接受）' },
  { exp: V95, key: 'c84a-用户放',    addr: '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', expect: '非 crash 拒（慢速下跌非急跌）' },
  { exp: V95, key: '28ad-用户放',    addr: '0x28ad2c7d08d83a85467bd4afcfd673dfce564444', expect: '非 crash 拒（V 形收复）' },
  { exp: V95, key: 'a8e70-pvp?',     addr: '0xa8e70ca07b68a07683c963513a26f2fa91647777', expect: '判②retail_pvp → pattern_gate 拒' },
  { exp: V94, key: '米-对倒低价',    addr: '0x338a510c6c7abd4c714d74225086542270427777', expect: '放行 neutral' },
  { exp: V94, key: '施工鸭-对倒低价', addr: '0x459f1d098437fad48931372f9b16b6ad25297777', expect: '放行 neutral' },
  { exp: V94, key: 'YiYi-尖刺',      addr: '0xbfc8f025427ef4049b6d679c0506cdf2b4164444', expect: '拒(spike|统一门 38.8>27.5)' },
  { exp: V94, key: '币安之心-观察',  addr: '0x08aa150d7d86c4a0dfa37f310c1380de9c187777', expect: '观察（不预设）' },
  { exp: V94, key: '苍蝇-观察',      addr: '0x04323e04c5f48587951c2d974b7f1b007b6e7777', expect: '观察（不预设）' },
];
const logger = { info() {}, warn() {}, error() {} };

async function main() {
  const client = await dbManager.getClient();
  const addrs = TOKENS.map((t) => t.addr);
  const { data: creates } = await client.from('wss_events')
    .select('token_address,payload').eq('kind', 'token_create').in('token_address', addrs);
  const metaBy = new Map((creates || []).map((r) => [r.token_address, r.payload || {}]));
  const { data: etRows } = await client.from('experiment_tokens')
    .select('token_address,platform').in('experiment_id', [V94, V95]).in('token_address', addrs);
  const platBy = new Map((etRows || []).map((r) => [r.token_address, r.platform]));

  const bp = new BuyPointCheckService({
    enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false,
  }, logger, {});

  for (const t of TOKENS) {
    const { data: sigs, error } = await client.from('strategy_signals')
      .select('id,created_at').eq('experiment_id', t.exp).eq('signal_type', 'BUY')
      .eq('token_address', t.addr).order('created_at', { ascending: true }).limit(1);
    if (error || !sigs || !sigs.length) { console.log(`${t.key} 无信号行跳过`); continue; }
    const anchorMs = Date.parse(sigs[0].created_at);
    const p = metaBy.get(t.addr) || {};
    const meta = { address: t.addr, symbol: p.symbol || null, name: p.name || null, platform: platBy.get(t.addr) || p.platform || 'fourmeme' };
    const r = await bp.gateBuyPoint(t.addr, meta, { experimentId: 'bp58b-parity' }, { anchorMs });
    const a = r.assessment || {}, d = r.dimensions || {}, an = r.anchors || {};
    const dim = (k) => { const o = d[k] || {}; return `${o.bucket}(${o.prob != null ? Number(o.prob).toFixed(2) : '?'})`; };
    console.log(`${t.key} ${sigs[0].created_at.slice(11, 19)} → ${r.status} 综=${a.bucket}(${a.rule})` +
      ` pattern=${dim('market_pattern')} entry=${dim('entry_shape')} act=${dim('activity_level')}` +
      ` curVs=${an.currentVsLaunchPct ?? '?'} curVsAth=${an.currentVsAthPct ?? '?'} chg30=${an.chg30Pct ?? '?'}` +
      ` nUp5=${an.nearMaxUp5Pct ?? '?'} nDn5=${an.nearMaxDn5Pct ?? '?'} minGap=${an.curVsMinGapPct ?? '?'} v=${r.questionVersion ?? '?'}` +
      ` || 期望=${t.expect}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
