// 一次性对拍（182 跑）：BP53/案号 BP61 ③桶 famous 快进快出收割完残局臂——
// fresh gateBuyPoint persist:false，锚=首 BUY 信号行 created_at。
// 矩阵：
//   翻案：147d（bt-v97 两 famous 0x877af245/0xbf00 t-17s/t+0s 各买 0.27/0.32、3~11s 全清
//     离场净 −0.149、占买 15.7%/卖 23.6%、minVs −7.7 再起来域=测退出臂前提修正
//     ——生产判 none(0.9) 放行买入 79s 流动性止损 → 应翻③拒 pattern_gate）
//   翻案：0432（bt-v97 0x3472ccf6 t+0s 买 0.35→t+4s 全清净 +0.003、占买 9.8%/卖
//     12.5%、minVs 22.4 未再起来域——生产判 none(0.95) 放行 60s 流动性止损 → 应翻③拒）
//   观察：59f5（用户裁定=famous 在场型③采信案——BP57 集团买入判序句+新臂下是否翻）
//   翻案（二修后新增立法票）：米 338a（bt-v97 0xa83b73f5 t+0s 买 0.3503→t+10/13s 卖
//     0.2242+0.2088 全清、净 −0.083、dom=100/groupBuy=100——最干净收割完正例
//     → 应翻③拒 pattern_gate；锚改用 V97 信号行）
//   不翻（回归锚——BP60 对拍 13/13 子集防漂移）：28ad 放行；LOVE/2ef6/13d7 crash 拒；
//     a813/f485 normal_dip
//   BP62 翻案（四修）：c84a 厚盘适用域——93 笔/6.96 BNB+athVs +149%→curVs +21% 轮回走完+
//     集团买 92.8%（跟单顶上）但 famous 本人占买 12.7% 卖/买 123% 带底仓 → 应翻 none
//     （锚=第二信号 curVs 20.7≤27.5 综=neutral 放行；首信号 38.2 统一门拒=位置原因）
//   147d/0432/米 保持③（BP62 收割臂回指——薄盘秒闪不受适用域影响）
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');

const V94 = '85cbad14-696f-49b2-baa4-a5407df4a2d2';
const V95 = '675c71a1-0e19-49b6-924b-facffc073afd';
const V96 = 'e582e873-7f1a-44a5-b50f-0fca576847be';
const V97 = 'afe7faa8-bb8b-4b40-b57e-35000f3ad472';
const TOKENS = [
  { exp: V97, key: '147d-立法翻案(再起来域)', addr: '0x147d75f133130713c803d35a046da9b7c19effff', expect: '保持③拒（BP62 薄盘秒闪不受适用域影响）' },
  { exp: V97, key: '0432-立法翻案(未再起来)', addr: '0x04323e04c5f48587951c2d974b7f1b007b6e7777', expect: '保持③拒（BP62 薄盘秒闪不受适用域影响）' },
  { exp: V96, key: '59f5-观察(在场型裁定)', addr: '0x59f5ccb671f1651db2ca8aba4fd0254fcef87777', expect: '观察（用户裁定 famous 在场型——59f5 判据内不翻 none 保持）' },
  { exp: V95, key: '28ad-回归不翻', addr: '0x28ad2c7d08d83a85467bd4afcfd673dfce564444', expect: 'none 放行 neutral 保持' },
  { exp: V97, key: '米-立法翻案(最干净收割完)', addr: '0x338a510c6c7abd4c714d74225086542270427777', fallbackExp: V94, expect: '保持③拒（BP62 薄盘秒闪不受适用域影响）' },
  { exp: V95, key: 'c84a-BP62翻案(厚盘适用域)', addr: '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', anchorIndex: 1, fallbackExp: V97, expect: '翻 none 综=neutral 放行（BP62 厚吞吐 6.96+轮回走完+本人占买 12.7%→不落③；第二信号 curVs 20.7≤27.5）' },
  { exp: V94, key: 'LOVE-回归照拒', addr: '0xf0b83df726bba9a8a01fcd5da0b2303e83ca7777', expect: 'crash 拒 entry_gate 保持' },
  { exp: V97, key: '13d7-补充case(暴跌后小回弹)', addr: '0x13d7a62693e2860ba4bd51d6c9c75edc53427777', expect: 'crash 拒 entry_gate（用户 mid-turn 补充——快速暴跌后的小回弹同 LOVE/2ef6 族）' },
  { exp: V96, key: '2ef6-回归照拒', addr: '0x2ef6c0e630d34b78ad36aabe04cd90f57e3c7777', expect: 'crash 拒 entry_gate 保持（BP59）' },
  { exp: V94, key: 'a813-回归不翻', addr: '0xa813cd684ce664d2dcde26797246e3b4ffd37777', expect: 'normal_dip 保持非 crash' },
  { exp: V94, key: 'f485-回归不翻', addr: '0xf485ec1d518185e73ca53164ddaa85dcfde77777', expect: 'normal_dip 保持非 crash' },
];
const logger = { info() {}, warn() {}, error() {} };

async function main() {
  const client = await dbManager.getClient();
  const addrs = TOKENS.map((t) => t.addr);
  const { data: creates } = await client.from('wss_events')
    .select('token_address,payload').eq('kind', 'token_create').in('token_address', addrs);
  const metaBy = new Map((creates || []).map((r) => [r.token_address, r.payload || {}]));
  const { data: etRows } = await client.from('experiment_tokens')
    .select('token_address,platform').in('experiment_id', [V94, V95, V96, V97]).in('token_address', addrs);
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
    const r = await bp.gateBuyPoint(t.addr, meta, { experimentId: 'bp53-parity' }, { anchorMs });
    const a = r.assessment || {}, d = r.dimensions || {}, an = r.anchors || {};
    const dim = (k) => { const o = d[k] || {}; return `${o.bucket}(${o.prob != null ? Number(o.prob).toFixed(2) : '?'})`; };
    console.log(`${t.key} ${sigs[idx].created_at.slice(11, 19)} → ${r.status} 综=${a.bucket}(${a.rule})` +
      ` pattern=${dim('market_pattern')} entry=${dim('entry_shape')} act=${dim('activity_level')}` +
      ` curVs=${an.currentVsLaunchPct ?? '?'} minVs=${an.minVsLaunchPct ?? '?'} athVs=${an.athVsLaunchPct ?? '?'}` +
      ` chg5=${an.chg5Pct ?? '?'} v=${r.questionVersion ?? '?'}` +
      ` || 期望=${t.expect}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
