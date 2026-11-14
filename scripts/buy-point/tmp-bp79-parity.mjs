// BP79 对拍（182 跑）：bt-v104 R1 三件——①②大户在场三分 ②⑨买期/卖期分界 ③crash 趋势打断轴
//   fresh gateBuyPoint persist:false，REPEAT=3 看方差。
//   ②翻案 3（bt-v104 放行成交票——挂账沉默不算在场 → 应翻 retail_pvp pattern_gate 拒）
//   ⑨翻案 3（SAMSUNG 主案 BP77 三跑仍漏 0.31 vs 0.61——分界行直供后看是否翻；仍漏=A/B/C 待裁延续）
//   闪崩 6（v104 全 normal_dip 放行；2ef6/258e=crash 回归票保持，其余 4 张看趋势打断轴翻案）
//   反例 3（f485/a813 normal_dip 保持、c84a 厚盘 none 综 neutral 保持——不许翻坏）
// 锚：hint 票（复盘锚≠首信号的中途信号）按 hint 时刻取最近信号行；其余首信号行；c84a=第二信号。
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const { BuyPointCheckService } = require_('../../src/market-analysis/BuyPointCheckService.js');

const V94 = '85cbad14-696f-49b2-baa4-a5407df4a2d2';
const V95 = '675c71a1-0e19-49b6-924b-facffc073afd';
const V104 = '18db4a3e-b25d-44f3-9fc6-32d3c2f2857b';
const TOKENS = [
  // ②大户在场三分（挂账沉默不算在场 → 大户参与不满足直接落②）
  { exp: V104, key: '29-②翻案(挂账452/211s)', addr: '0xdc1910375c1c1c3d0c25c13ee6e5f2bec1887777', hint: '2026-11-05T12:00:09', expect: '翻 retail_pvp pattern_gate 拒' },
  { exp: V104, key: '蝴蝶-②翻案(活跃0~1)', addr: '0xac0b530995e47794dd0b722497aa33873b8c7777', hint: '2026-11-05T05:30:05', expect: '翻 retail_pvp pattern_gate 拒' },
  { exp: V104, key: '我靠-②翻案', addr: '0xcbfe6b2bceacfab7934c82513f568f4e31a04444', expect: '翻 retail_pvp pattern_gate 拒' },
  // ⑨买期/卖期分界（首卖直供行+尘门 0.05/0.01+同块捆绑分仓识别）
  { exp: V104, key: 'SAMSUNG-⑨主案(BP77仍漏)', addr: '0x54117eb6d2481dc8d89ee377e00e683f882f7777', expect: '翻 one_wave_dump pattern_gate 拒（仍漏=A/B/C 待裁延续）' },
  { exp: V104, key: 'GNusmas-⑨(尾段尘买误判源)', addr: '0x1c6be124ffe79abe2fd32adba76dd4f3d5567777', expect: '翻 one_wave_dump pattern_gate 拒' },
  { exp: V104, key: 'LABU-⑨', addr: '0x1ac4a310874e29290720d2fb55300a91a23e7777', expect: '翻 one_wave_dump pattern_gate 拒' },
  // 闪崩 6（趋势打断轴：摆点 ≤60s∧距摆高 ≤-25% + chg 同深轴；优先于臂 B 买入力豁免）
  { exp: V104, key: '屎壳郎自拉-闪崩回归(BP59锚)', addr: '0x2ef6c0e630d34b78ad36aabe04cd90f57e3c7777', expect: 'crash 拒 entry_gate 保持' },
  { exp: V104, key: '赵公主-闪崩(BP63判例)', addr: '0x258e485725b8d799b885b9f079241e2c812d7777', expect: 'crash 拒 entry_gate（chg5 -44.7≈chg10 同深——买入力在场不豁免）' },
  { exp: V104, key: '币安之心-闪崩翻案(39位真值)', addr: '0x08aa150d7d86c4a0dfa37f310c1380de9c187777', hint: '2026-11-05T12:11:23', expect: '翻 crash 拒 entry_gate' },
  { exp: V104, key: '蝴蝶人生路-闪崩翻案', addr: '0xb359716d1affde1fb9d351fec71a0f2e79257777', hint: '2026-11-05T12:43:10', expect: '翻 crash 拒 entry_gate' },
  { exp: V104, key: '苹果SI-闪崩翻案', addr: '0xc9bf4530033f6497002d228296fedb45036f7777', hint: '2026-11-05T05:11:40', expect: '翻 crash 拒 entry_gate' },
  { exp: V104, key: '持械入宋-闪崩翻案', addr: '0xea3ce510829b2b3c77dae374aad440e23be94444', hint: '2026-11-05T07:41:30', expect: '翻 crash 拒 entry_gate' },
  // 反例 3（不许翻坏）
  { exp: V104, key: 'f485-回归不翻', addr: '0xf485ec1d518185e73ca53164ddaa85dcfde77777', expect: 'normal_dip 保持（BP74 分离轴：尾段买力不在场才不救——deep 跌但缓）' },
  { exp: V104, key: 'a813-回归不翻', addr: '0xa813cd684ce664d2dcde26797246e3b4ffd37777', expect: 'normal_dip 保持' },
  { exp: V104, key: 'c84a-回归不翻(厚盘none)', addr: '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', expect: 'none 综=neutral 放行保持' },
];
const REPEAT = 3;
const logger = { info() {}, warn() {}, error() {} };

async function main() {
  const client = await dbManager.getClient();
  const addrs = TOKENS.map((t) => t.addr);
  const { data: creates } = await client.from('wss_events')
    .select('token_address,payload').eq('kind', 'token_create').in('token_address', addrs);
  const metaBy = new Map((creates || []).map((r) => [r.token_address, r.payload || {}]));
  const { data: etRows } = await client.from('experiment_tokens')
    .select('token_address,platform').in('experiment_id', [V94, V95, V104]).in('token_address', addrs);
  const platBy = new Map((etRows || []).map((r) => [r.token_address, r.platform]));

  const bp = new BuyPointCheckService({
    enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false,
  }, logger, {});

  const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
  for (const t of (ONLY.length ? TOKENS.filter((x) => ONLY.some((o) => x.key.startsWith(o))) : TOKENS)) {
    let anchorMs = null, anchorAt = null;
    for (const expId of [t.exp, t.fallbackExp].filter(Boolean)) {
      const { data, error } = await client.from('strategy_signals')
        .select('id,created_at').eq('experiment_id', expId).eq('signal_type', 'BUY')
        .eq('token_address', t.addr).order('created_at', { ascending: true }).limit(50);
      if (error || !data || !data.length) continue;
      if (t.hint) {
        const ht = Date.parse(t.hint + 'Z');
        let best = data[0], bestD = Infinity;
        for (const r of data) { const d = Math.abs(Date.parse(r.created_at) - ht); if (d < bestD) { bestD = d; best = r; } }
        anchorAt = best.created_at;
      } else {
        const idx = t.anchorIndex || 0;
        if (data.length <= idx) continue;
        anchorAt = data[idx].created_at;
      }
      anchorMs = Date.parse(anchorAt);
      break;
    }
    if (anchorMs == null) { console.log(`${t.key} 无信号行跳过`); continue; }
    const p = metaBy.get(t.addr) || {};
    const meta = { address: t.addr, symbol: p.symbol || null, name: p.name || null, platform: platBy.get(t.addr) || p.platform || 'fourmeme' };
    const rounds = [];
    for (let i = 0; i < REPEAT; i++) {
      const r = await bp.gateBuyPoint(t.addr, meta, { experimentId: 'bp79-parity' }, { anchorMs });
      const a = r.assessment || {}, d = r.dimensions || {}, an = r.anchors || {};
      const dim = (k) => { const o = d[k] || {}; return `${o.bucket}(${o.prob != null ? Number(o.prob).toFixed(2) : '?'})`; };
      const ps = (an.phaseSplitSecSinceFirstSell != null) ? `ps[t-${an.phaseSplitSecSinceFirstSell}s/pre${an.phaseSplitPreBuySharePct}%/pbb${an.phaseSplitPostBundledBnb}]` : 'ps[nil]';
      const sw = (an.secSinceSwingHigh != null) ? `sw[${an.secSinceSwingHigh}s/${an.currentVsSwingHighPct}%/rise${an.swingRisePct}%×${an.swingRiseSec}s]` : 'sw[nil]';
      rounds.push(`#${i + 1} ${r.status} 综=${a.bucket}(${a.rule}) mp=${dim('market_pattern')} es=${dim('entry_shape')} act=${dim('activity_level')} curVs=${an.currentVsLaunchPct ?? '?'} chg5=${an.chg5Pct ?? '?'} chg10=${an.chg10Pct ?? '?'} ${ps} ${sw}`);
    }
    console.log(`\n### ${t.key} ${t.addr.slice(0, 8)} 锚=${anchorAt.slice(11, 19)} v=${bp._version}`);
    for (const line of rounds) console.log('  ' + line);
    console.log(`  || 期望=${t.expect}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
