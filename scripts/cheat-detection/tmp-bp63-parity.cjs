// 一次性对拍（182 跑）：BP63 258e 暴跌接刀判例样本化（commit a45ba6c0，题面判例不入代码）——
// fresh gateBuyPoint persist:false，锚=BUY 信号行 created_at。
// 矩阵：
//   翻案：258e（flap 赵公主 0x258e…7777）11:24:45 第二信号——v97/v98 两锚数值几乎同深全负
//     （chg5 -44.7/-43.1、chg10 -41.8/-40.0 同深差 3pp 无铺垫、nearMaxDn5 -52.1、curVsAth≈-93%、
//     curVs 仅 +6~+10=almost_launch 区），首信号 11:24:42 判 crash(0.77) 拒 ✓、第二信号被 Jev 判
//     normal_dip(0.51) 放行成交即套（100s 卖）→ 判例样本化后期望两锚都稳定 crash 拒 entry_gate
//   照拒：LOVE（crash 形态）/2ef6（BP59 立法锚——同族急跌进行时）/13d7（BP61 补充 case）
//   照放：a813/f485（normal_dip 正例——已走完一段的深跌不误伤）
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');

const V94 = '85cbad14-696f-49b2-baa4-a5407df4a2d2'; // bt-v94
const V96 = 'e582e873-7f1a-44a5-b50f-0fca576847be'; // bt-v96
const V97 = 'afe7faa8-bb8b-4b40-b57e-35000f3ad472'; // bt-v97
const S258E = '0x258e485725b8d799b885b9f079241e2c812d7777';
const TOKENS = [
  { exp: V97, key: 'LOVE-照拒',   addr: '0xf0b83df726bba9a8a01fcd5da0b2303e83ca7777', expect: 'crash 拒 entry_gate' },
  { exp: V96, key: '2ef6-照拒',   addr: '0x2ef6c0e630d34b78ad36aabe04cd90f57e3c7777', expect: 'crash 拒 entry_gate（BP59 立法锚不回退）' },
  { exp: V97, key: '13d7-照拒',   addr: '0x13d7a62693e2860ba4bd51d6c9c75edc53427777', expect: 'crash 拒 entry_gate' },
  { exp: V94, key: 'a813-照放',   addr: '0xa813cd684ce664d2dcde26797246e3b4ffd37777', expect: 'normal_dip 保持非 crash 拒（已走完一段不误伤）' },
  { exp: V94, key: 'f485-照放',   addr: '0xf485ec1d518185e73ca53164ddaa85dcfde77777', expect: 'normal_dip 保持非 crash 拒（震荡下行不误伤）' },
];
const logger = { info() {}, warn() {}, error() {} };

async function main() {
  const client = await dbManager.getClient();
  const addrs = TOKENS.map((t) => t.addr).concat([S258E]);
  const { data: creates } = await client.from('wss_events')
    .select('token_address,payload').eq('kind', 'token_create').in('token_address', addrs);
  const metaBy = new Map((creates || []).map((r) => [r.token_address, r.payload || {}]));
  const { data: etRows } = await client.from('experiment_tokens')
    .select('token_address,platform').in('experiment_id', [V94, V96, V97]).in('token_address', addrs);
  const platBy = new Map((etRows || []).map((r) => [r.token_address, r.platform]));

  const bp = new BuyPointCheckService({
    enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false,
  }, logger, {});

  // ① 258e 全信号逐锚（首锚回归+第二锚翻案）
  {
    const { data: sigs, error } = await client.from('strategy_signals')
      .select('id,created_at').eq('experiment_id', V97).eq('signal_type', 'BUY')
      .eq('token_address', S258E).order('created_at', { ascending: true }).limit(5);
    if (error || !sigs || !sigs.length) console.log('258e v97 无信号行');
    else {
      const p = metaBy.get(S258E) || {};
      const meta = { address: S258E, symbol: p.symbol || null, name: p.name || null, platform: platBy.get(S258E) || p.platform || 'flap' };
      for (const s of sigs) {
        const r = await bp.gateBuyPoint(S258E, meta, { experimentId: 'bp63-parity' }, { anchorMs: Date.parse(s.created_at) });
        const a = r.assessment || {}, d = r.dimensions || {}, an = r.anchors || {};
        const o = d.entry_shape || {};
        console.log(`258e#${sigs.indexOf(s) + 1} ${s.created_at.slice(11, 19)} → ${r.status} 综=${a.bucket}(${a.rule})` +
          ` entry=${o.bucket}(${o.prob != null ? Number(o.prob).toFixed(2) : '?'})` +
          ` curVs=${an.currentVsLaunchPct ?? '?'} curVsAth=${an.currentVsAthPct ?? '?'} chg5=${an.chg5Pct ?? '?'} chg10=${an.chg10Pct ?? '?'} nDn5=${an.nearMaxDn5Pct ?? '?'} v=${r.questionVersion ?? '?'}` +
          ` || 期望=${sigs.indexOf(s) === 0 ? '首锚照 crash 拒' : '翻 crash 拒 entry_gate（BP63 判例样本化——位置低≠跌势已止）'}`);
      }
    }
  }
  // ② 回归锚（首信号）
  for (const t of TOKENS) {
    const { data: sigs, error } = await client.from('strategy_signals')
      .select('id,created_at').eq('experiment_id', t.exp).eq('signal_type', 'BUY')
      .eq('token_address', t.addr).order('created_at', { ascending: true }).limit(1);
    if (error || !sigs || !sigs.length) { console.log(`${t.key} 无信号行跳过`); continue; }
    const anchorMs = Date.parse(sigs[0].created_at);
    const p = metaBy.get(t.addr) || {};
    const meta = { address: t.addr, symbol: p.symbol || null, name: p.name || null, platform: platBy.get(t.addr) || p.platform || 'fourmeme' };
    const r = await bp.gateBuyPoint(t.addr, meta, { experimentId: 'bp63-parity' }, { anchorMs });
    const a = r.assessment || {}, d = r.dimensions || {}, an = r.anchors || {};
    const o = d.entry_shape || {};
    console.log(`${t.key} ${sigs[0].created_at.slice(11, 19)} → ${r.status} 综=${a.bucket}(${a.rule})` +
      ` entry=${o.bucket}(${o.prob != null ? Number(o.prob).toFixed(2) : '?'})` +
      ` chg5=${an.chg5Pct ?? '?'} chg10=${an.chg10Pct ?? '?'} v=${r.questionVersion ?? '?'} || 期望=${t.expect}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
