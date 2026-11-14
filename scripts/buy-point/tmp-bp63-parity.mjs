// BP63 低价抢进速倒臂对拍（182 跑）：famousEntryLaunchBnb 锚反转后 Jev 判型验证。
//   翻案 2（asof-严目标票三要件全真——Jev 应翻③ famous_monopoly pattern_gate 拒）：
//     股股嘎嘎 lowEntryN=1/1 fastFlipN=1/1 holdingN=0/1（剑锋 t+36s@+11.5% 持 31s 清仓）
//     FOUR米米 lowEntryN=1/1 fastFlipN=1/1 holdingN=0/1（t+4s@+11% 持 22s 清仓）
//   不触发 2（研究拦截面内但链上口径不满足——臂不成立走原判读，不因新臂翻坏）：
//     meme.jpg（+32.1% 超线）/100（+19.1/+24.8% 超线）——开盘 3~7s 冲击大于研究口径
//   反例 2（不许翻坏）：
//     小四（+29.8/+55.7% 超线+holdingN=1 蚂蚁仓在场 → 臂天然不触发，ATH+331% 好票保持）
//     c84a（厚盘三 KOL 全 t+1s 但 +27.7~83.3% → 不触发，none 综 neutral 保持）
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const { BuyPointCheckService } = require_('../../src/market-analysis/BuyPointCheckService.js');

const V104 = '18db4a3e-b25d-44f3-9fc6-32d3c2f2857b';
const V105 = '79aedc57-3493-40be-9ed0-9c067f2c2cec';
const TOKENS = [
  { exp: V105, key: '股股嘎嘎-③翻案', addr: '0xb9dea15c7a92df7cae8657bcec876c2dc8ae4444', hint: '2026-11-05T08:14:08', expect: '翻 famous_monopoly pattern_gate 拒' },
  { exp: V105, key: 'FOUR米米-③翻案', addr: '0x9c08bd8e1f1e6e8564e378bab47ce76d98724444', hint: '2026-11-05T09:26:29', expect: '翻 famous_monopoly pattern_gate 拒' },
  { exp: V105, key: 'meme.jpg-臂不触发', addr: '0xa52a9366ac14efd7fd5ad0c711801765d6ceffff', hint: '2026-11-05T08:25:13', expect: '新臂不成立（入场+32.1% 超线）——判型走原判读，非③' },
  { exp: V105, key: '100-臂不触发', addr: '0x68e45d60058077ee12e70ab094f1ad999ccf4444', hint: '2026-11-05T09:20:59', expect: '新臂不成立（+19.1/+24.8% 超线）——判型走原判读' },
  { exp: V105, key: '小四-反例不翻坏', addr: '0xf0576fc1267506123b0bb843b2a325e9010b4444', hint: '2026-11-05T07:47:56', expect: '臂天然不触发（超线+holdingN=1）——不得因新臂翻③' },
  { exp: V104, key: 'c84a-反例不翻坏', addr: '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', expect: '臂不触发（+27.7~83.3%）——none 综 neutral 保持' },
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
    .select('token_address,platform').in('experiment_id', [V104, V105]).in('token_address', addrs);
  const platBy = new Map((etRows || []).map((r) => [r.token_address, r.platform]));

  const bp = new BuyPointCheckService({
    enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false,
  }, logger, {});

  const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
  for (const t of (ONLY.length ? TOKENS.filter((x) => ONLY.some((o) => x.key.startsWith(o))) : TOKENS)) {
    const { data, error } = await client.from('strategy_signals')
      .select('id,created_at').eq('experiment_id', t.exp).eq('signal_type', 'BUY')
      .eq('token_address', t.addr).order('created_at', { ascending: true }).limit(50);
    if (error || !data || !data.length) { console.log(`${t.key} 无信号行跳过`); continue; }
    const ht = t.hint ? Date.parse(t.hint + 'Z') : null;
    let best = data[0], bestD = Infinity;
    for (const r of data) { const d = ht ? Math.abs(Date.parse(r.created_at) - ht) : 0; if (d < bestD) { bestD = d; best = r; } }
    const anchorMs = Date.parse(best.created_at);
    const p = metaBy.get(t.addr) || {};
    const meta = { address: t.addr, symbol: p.symbol || null, name: p.name || null, platform: platBy.get(t.addr) || p.platform || 'fourmeme' };
    const rounds = [];
    for (let i = 0; i < REPEAT; i++) {
      const r = await bp.gateBuyPoint(t.addr, meta, { experimentId: 'bp63-parity' }, { anchorMs });
      const a = r.assessment || {}, d = r.dimensions || {}, an = r.anchors || {};
      const dim = (k) => { const o = d[k] || {}; return `${o.bucket}(${o.prob != null ? Number(o.prob).toFixed(2) : '?'})`; };
      rounds.push(`#${i + 1} ${r.status} 综=${a.bucket}(${a.rule}) mp=${dim('market_pattern')} es=${dim('entry_shape')} act=${dim('activity_level')} curVs=${an.currentVsLaunchPct ?? '?'} minVs=${an.minVsLaunchPct ?? '?'}`);
    }
    console.log(`\n### ${t.key} ${t.addr.slice(0, 8)} 锚=${best.created_at.slice(11, 19)} v=${bp._version}`);
    for (const line of rounds) console.log('  ' + line);
    console.log(`  || 期望=${t.expect}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
