// BP63 state 探针（182 跑）：KOL 低价抢进速倒臂原料可见性——打印 6+2 票锚时刻
//   famousTraces per-wallet 三键+汇总计数（lowEntryN/fastFlipN/holdingN）+痕迹行原文。
//   拉数复刻生产 _pullTicksDb（tail 3000 链上真序+满帽补 head 300），锚=as-of 截窗。
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const { BuyPointCheckService } = require_('../../src/market-analysis/BuyPointCheckService.js');
const { buildBuyPointSnapshot } = require_('../../src/market-analysis/buy-point-snapshot.js');
const { buildBuyPointState } = require_('../../src/market-analysis/buy-point-state-builder.js');

const V100 = '11fc182a-b051-4665-857c-5c14e6713334';
const V104 = '18db4a3e-b25d-44f3-9fc6-32d3c2f2857b';
const V105 = '79aedc57-3493-40be-9ed0-9c067f2c2cec';
const TOKENS = [
  // asof-严 5 张（KOL 研究 I 判据拦截面——臂应触发原料在场）
  { exp: V105, key: '股股嘎嘎', addr: '0xb9dea15c7a92df7cae8657bcec876c2dc8ae4444', hint: '2026-11-05T08:14:08' },
  { exp: V105, key: 'meme.jpg', addr: '0xa52a9366ac14efd7fd5ad0c711801765d6ceffff', hint: '2026-11-05T08:25:13' },
  { exp: V105, key: '100', addr: '0x68e45d60058077ee12e70ab094f1ad999ccf4444', hint: '2026-11-05T09:20:59' },
  { exp: V105, key: 'FOUR米米', addr: '0x9c08bd8e1f1e6e8564e378bab47ce76d98724444', hint: '2026-11-05T09:26:29' },
  { exp: V105, key: 'SI', addr: '0xea7dc0825d4e6d90c026201ecc6aa8d82c577777', hint: '2026-11-05T12:28:05' },
  // 小四（asof-宽误拦票——臂会触发，须靠反锚①破发承接救回）
  { exp: V105, key: '小四(反锚①承接)', addr: '0xf0576fc1267506123b0bb843b2a325e9010b4444', hint: '2026-11-05T07:47:56' },
  // 反例 2（臂不得触发/不得翻坏）
  { exp: V100, key: '28ad(BP70尘埃残仓-holdingN守卫)', addr: '0x28ad2c7d08d83a85467bd4afcfd673dfce564444', anchorIndex: 0 },
  { exp: V104, key: 'c84a(厚盘none保持)', addr: '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777' },
];
const logger = { info() {}, warn() {}, error() {} };

async function main() {
  const client = await dbManager.getClient();
  const addrs = TOKENS.map((t) => t.addr);
  const { data: creates } = await client.from('wss_events')
    .select('token_address,payload').eq('kind', 'token_create').in('token_address', addrs);
  const metaBy = new Map((creates || []).map((r) => [r.token_address, r.payload || {}]));
  const { data: etRows } = await client.from('experiment_tokens')
    .select('token_address,platform').in('experiment_id', [V100, V104, V105]).in('token_address', addrs);
  const platBy = new Map((etRows || []).map((r) => [r.token_address, r.platform]));

  const bp = new BuyPointCheckService({
    enabled: true, gate: { awaitMs: 1000 }, settleDelayMs: 0, persist: false,
  }, logger, {});

  const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
  for (const t of (ONLY.length ? TOKENS.filter((x) => ONLY.some((o) => x.key.startsWith(o))) : TOKENS)) {
    let anchorMs = null, anchorAt = null;
    for (const expId of [t.exp]) {
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
    if (anchorMs == null) { console.log(`### ${t.key} 无信号行跳过`); continue; }

    const pull = await bp._pullTicksDb(t.addr, anchorMs);
    const p = metaBy.get(t.addr) || {};
    const meta = { address: t.addr, symbol: p.symbol || null, name: p.name || null, platform: platBy.get(t.addr) || p.platform || 'fourmeme' };
    const snap = buildBuyPointSnapshot(pull.rows, meta, { anchorMs, capped: pull.capped, anchorTickCount: pull.anchorTickCount });
    const { state } = buildBuyPointState(snap);
    const ft = (snap.buyDerived && snap.buyDerived.famousTraces) || null;
    console.log(`\n### ${t.key} ${t.addr.slice(0, 10)} 锚=${anchorAt.slice(11, 19)} ticks=${pull.anchorTickCount}${pull.capped ? '+' : ''}`);
    if (!ft || !ft.wallets || !ft.wallets.length) { console.log('  famousTraces 空'); continue; }
    for (const w of ft.wallets) {
      console.log(`  ${String(w.w).slice(0, 10)} 买${w.buyBnb} 卖${w.sellBnb} 净${w.netBnb} 入场vs首价=${w.entryVsLaunchPct ?? 'null'}% 持${w.holdSec ?? 'null'}s fastFlip=${w.fastFlip ? 1 : 0}`);
    }
    console.log(`  计数：lowEntryN=${ft.lowEntryN}/${ft.wallets.length} fastFlipN=${ft.fastFlipN}/${ft.wallets.length} holdingN=${ft.holdingN}/${ft.wallets.length} presenceNetBnb=${ft.presenceNetBnb ?? 'null'}`);
    // 打印 state 中 famous 痕迹行+低价抢进速倒句
    for (const line of String(state).split('\n')) {
      if (line.includes('famous') || line.includes('低价抢进') || line.includes('速倒')) console.log('  | ' + line.trim().slice(0, 300));
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
