// 一次性对拍（182 跑）：BP64/BP65/BP66 三案——fresh gateBuyPoint persist:false，锚=BUY 信号行 created_at。
// 矩阵：
//   BP66a 翻案：c84a v100 首锚 12:31:26（开盘拉 +200% 后 40 余秒中等速率阴跌、点位平缓换手
//     俩 0.1 买接一笔 0.25 卖）→ crash(0.5) 应翻 normal_dip（crash 必要条件=买点本身急跌）
//   BP66b 翻案：c84a v100 第二锚 12:31:32（actTrades=21/10s=2.1 笔/秒+卖 11 钱包 1.2B 对买
//     8 钱包 0.6B 双边在场）→ act ultra(0.98) 应翻非 ultra（每秒 1~2 笔=常见换手至多高档）
//   BP65 翻案：59f5 v99 05:09:57（2.59 BNB 薄盘+双 famous 在场合计持有过半——改前在场持有型
//     归 none 放行 34s 割 -17.6%）→ 应翻③ pattern_gate 拒（薄盘 <5 BNB 在场持有照落③）
//   BP65 翻案：ea7d v97（1.55 BNB 薄+单 famous 0xffbd 在场）→ 应③（同族薄盘）
//   BP65 观察：d928 v96（3.19 BNB 薄+双 famous hold 69.5%，终态 curVs 45.1）→ 期望③；
//     若判 none 则统一门 27.5 拒兜住（位置原因拒≠漏拦）
//   BP65 回归：c84a v96 idx1（6.96 BNB 厚盘+本人占买 12.7% 连续操作）→ 保持 none 放行
//   BP64 稳定：44d9 v99 两锚（chg5 -22.3≈chg10 -20.3 同深差 2pp 一秒翻转）→ crash 拒保持
//   回归锚：147d/0432/米 ③ 保持；LOVE/2ef6/13d7 crash 拒；a813/f485 normal_dip；28ad none 放行
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');

const V94 = '85cbad14-696f-49b2-baa4-a5407df4a2d2';
const V95 = '675c71a1-0e19-49b6-924b-facffc073afd';
const V96 = 'e582e873-7f1a-44a5-b50f-0fca576847be';
const V97 = 'afe7faa8-bb8b-4b40-b57e-35000f3ad472';
const V99 = '87cc5a7d-d845-4c46-8edd-f19dde4ef10f';
const V100 = 'ed113d10-8d0b-495d-b1f1-9b597f564c21';
const TOKENS = [
  { exp: V100, key: 'BP66a-c84a首锚', addr: '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', expect: 'crash→normal_dip（综 neutral 放行——curVs 27.3 贴线）' },
  { exp: V100, key: 'BP66b-c84a二锚', addr: '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', anchorIndex: 1, expect: 'act ultra→非 ultra（shape normal_dip 保持）' },
  { exp: V99, key: 'BP65-59f5翻案', addr: '0x59f5ccb671f1651db2ca8aba4fd0254fcef87777', fallbackExp: V96, expect: '翻③ pattern_gate 拒（薄盘 2.59 在场持有照落③）' },
  { exp: V97, key: 'BP65-ea7d薄盘', addr: '0xea7dc0825d4e6d90c026201ecc6aa8d82c577777', expect: '③（1.55 薄+单 famous 在场同族）' },
  { exp: V96, key: 'BP65-d928观察', addr: '0xd9289dbf4fd6716d9d7f443cd07cc43a40ce7777', expect: '③（若 none 则统一门 27.5 拒兜住=位置原因）' },
  { exp: V96, key: 'BP65-c84a厚盘回归', addr: '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', anchorIndex: 1, fallbackExp: V97, expect: 'none 放行 neutral 保持（≥5 BNB 厚盘在场持有不落③）' },
  { exp: V99, key: 'BP64-44d9锚0', addr: '0x44d93abb648b7d1d1d20a49002047fb588ccffff', expect: 'crash 拒 entry_gate 保持（判例样本化后更稳）' },
  { exp: V99, key: 'BP64-44d9锚1', addr: '0x44d93abb648b7d1d1d20a49002047fb588ccffff', anchorIndex: 1, expect: 'crash 拒 entry_gate 保持' },
  { exp: V97, key: '回归-147d', addr: '0x147d75f133130713c803d35a046da9b7c19effff', expect: '③ 拒保持' },
  { exp: V97, key: '回归-0432', addr: '0x04323e04c5f48587951c2d974b7f1b007b6e7777', expect: '③ 拒保持' },
  { exp: V97, key: '回归-米338a', addr: '0x338a510c6c7abd4c714d74225086542270427777', fallbackExp: V94, expect: '③ 拒保持' },
  { exp: V94, key: '回归-LOVE', addr: '0xf0b83df726bba9a8a01fcd5da0b2303e83ca7777', expect: 'crash 拒保持' },
  { exp: V96, key: '回归-2ef6', addr: '0x2ef6c0e630d34b78ad36aabe04cd90f57e3c7777', expect: 'crash 拒保持' },
  { exp: V97, key: '回归-13d7', addr: '0x13d7a62693e2860ba4bd51d6c9c75edc53427777', expect: 'crash 拒保持' },
  { exp: V94, key: '回归-a813', addr: '0xa813cd684ce664d2dcde26797246e3b4ffd37777', expect: 'normal_dip 保持非 crash' },
  { exp: V94, key: '回归-f485', addr: '0xf485ec1d518185e73ca53164ddaa85dcfde77777', expect: 'normal_dip 保持非 crash' },
  { exp: V95, key: '回归-28ad', addr: '0x28ad2c7d08d83a85467bd4afcfd673dfce564444', expect: 'none 放行 neutral 保持' },
];
const logger = { info() {}, warn() {}, error() {} };

async function main() {
  const client = await dbManager.getClient();
  const addrs = TOKENS.map((t) => t.addr);
  const { data: creates } = await client.from('wss_events')
    .select('token_address,payload').eq('kind', 'token_create').in('token_address', addrs);
  const metaBy = new Map((creates || []).map((r) => [r.token_address, r.payload || {}]));
  const { data: etRows } = await client.from('experiment_tokens')
    .select('token_address,platform').in('experiment_id', [V94, V95, V96, V97, V99, V100]).in('token_address', addrs);
  const platBy = new Map((etRows || []).map((r) => [r.token_address, r.platform]));

  const bp = new BuyPointCheckService({
    enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false,
  }, logger, {});

  for (const t of TOKENS) {
    let sigs = null;
    const idx = t.anchorIndex || 0;
    for (const expId of [t.exp, t.fallbackExp].filter(Boolean)) {
      const { data, error } = await client.from('strategy_signals')
        .select('id,created_at').eq('experiment_id', expId).eq('signal_type', 'BUY')
        .eq('token_address', t.addr).order('created_at', { ascending: true }).limit(idx + 1);
      if (!error && data && data.length > idx) { sigs = data; break; }
    }
    if (!sigs) { console.log(`${t.key} 无信号行跳过`); continue; }
    const anchorMs = Date.parse(sigs[idx].created_at);
    const p = metaBy.get(t.addr) || {};
    const meta = { address: t.addr, symbol: p.symbol || null, name: p.name || null, platform: platBy.get(t.addr) || p.platform || 'fourmeme' };
    const r = await bp.gateBuyPoint(t.addr, meta, { experimentId: 'bp64-66-parity' }, { anchorMs });
    const a = r.assessment || {}, d = r.dimensions || {}, an = r.anchors || {};
    const dim = (k) => { const o = d[k] || {}; return `${o.bucket}(${o.prob != null ? Number(o.prob).toFixed(2) : '?'})`; };
    console.log(`${t.key} ${sigs[idx].created_at.slice(11, 19)} → ${r.status} 综=${a.bucket}(${a.rule})` +
      ` pattern=${dim('market_pattern')} entry=${dim('entry_shape')} act=${dim('activity_level')}` +
      ` curVs=${an.currentVsLaunchPct ?? '?'} minVs=${an.minVsLaunchPct ?? '?'} chg5=${an.chg5Pct ?? '?'} chg10=${an.chg10Pct ?? '?'}` +
      ` v=${r.questionVersion ?? '?'}` +
      ` || 期望=${t.expect}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
