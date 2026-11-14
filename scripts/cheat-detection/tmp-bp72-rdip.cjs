// 一次性（182 跑）：BP72 臂判据数值锚复算（零 Jev）——三张贴线票+达成票抽样读 recentDip5/尾窗键
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');
const { buildBuyPointSnapshot } = require('../../src/market-analysis/buy-point-snapshot');

const V100 = '11fc182a-b051-4665-857c-5c14e6713334';
const V94 = '85cbad14-696f-49b2-baa4-a5407df4a2d2';
const logger = { info() {}, warn() {}, error() {} };
const RUNS = [
  { key: 'a813-误伤票', exp: V94, addr: '0xa813cd684ce664d2dcde26797246e3b4ffd37777', hhmmss: '09:28:07' },
  { key: '蝴蝶-方差票', exp: V100, addr: '0xb359716d1affde1fb9d351fec71a0f2e79257777', hhmmss: '12:43:13' },
  { key: 'LABU-未翻票', exp: V100, addr: '0x1ac4a310874e29290720d2fb55300a91a23e7777', hhmmss: '05:54:09' },
  { key: '赵公主-达成票', exp: V100, addr: '0x258e485725b8d799b885b9f079241e2c812d7777', hhmmss: '11:24:49' },
  { key: '屎壳郎-达成票', exp: V100, addr: '0x2ef6c0e630d34b78ad36aabe04cd90f57e3c7777', hhmmss: '13:36:09' },
  { key: '王涛-达成票', exp: V100, addr: '0x1cf8569749438a7bea491438383698040207ffff', hhmmss: '07:31:18' },
];

async function sigsAll(exp, addr) {
  const out = []; let cur = '';
  for (let p = 0; p < 10; p++) {
    let b = dbManager.getClient().from('strategy_signals')
      .select('id,created_at,metadata').eq('experiment_id', exp).eq('signal_type', 'BUY').eq('token_address', addr)
      .order('created_at', { ascending: true }).limit(60); if (cur) b = b.gt('created_at', cur);
    const { data, error } = await b;
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    out.push(...data); cur = data[data.length - 1].created_at; if (data.length < 60) break;
  }
  return out;
}

(async () => {
  const client = await dbManager.getClient();
  const { data: creates } = await client.from('wss_events')
    .select('token_address,payload,block_time').eq('kind', 'token_create').in('token_address', RUNS.map((r) => r.addr));
  const metaBy = new Map((creates || []).map((r) => [r.token_address, r]));
  const { data: etRows } = await client.from('experiment_tokens')
    .select('token_address,platform').in('experiment_id', [V100, V94]).in('token_address', RUNS.map((r) => r.addr));
  const platBy = new Map((etRows || []).map((r) => [r.token_address, r.platform]));
  const svc = new BuyPointCheckService({ enabled: true, settleDelayMs: 0, persist: false }, logger, {});
  for (const r of RUNS) {
    const sigs = await sigsAll(r.exp, r.addr);
    const withBp = sigs.filter((s) => s.metadata && s.metadata.buyPoint);
    const anchor = withBp.length ? withBp[withBp.length - 1] : sigs[sigs.length - 1];
    const anchorMs = Date.parse(anchor.created_at);
    const c = metaBy.get(r.addr); const p = (c && c.payload) || {};
    const meta = { address: r.addr, symbol: p.symbol || null, name: p.name || null, platform: platBy.get(r.addr) || p.platform || 'fourmeme', createdAtMs: c ? Date.parse(c.block_time) : null };
    const pull = await svc._pullTicksDb(r.addr, anchorMs);
    const snap = buildBuyPointSnapshot(pull.rows, meta, { capped: pull.capped, anchorTickCount: pull.anchorTickCount });
    const b = snap.buyDerived || {};
    const a10 = b.activity || {};
    const fmt = (v) => (v === null || v === undefined ? '—' : v);
    console.log(`[${r.key}] 锚${anchor.created_at.slice(11, 19)} ticks=${pull.anchorTickCount}` +
      ` chg5=${fmt(b.chg5Pct)} chg10=${fmt(b.chg10Pct)} chg30=${fmt(b.chg30Pct)}` +
      ` nearMaxDn5=${fmt(b.nearMaxDn5Pct)} maxDn5=${fmt(b.maxDn5Pct)} curVsMinGap=${fmt(b.curVsMinGapPct)}` +
      ` || recentDip5: 深=${fmt(b.recentDip5Pct)} 距=${fmt(b.recentDip5SecAgo)}s 未收复=${fmt(b.recentDip5UnrecoveredPct)}` +
      ` || 尾窗: t10买N=${fmt(a10.nearTail10BuyN)} t10买Bnb=${fmt(a10.nearTail10BuyBnb)} t10卖Bnb=${fmt(a10.nearTail10SellBnb)} t10卖钱包=${fmt(a10.nearTail10SellWallets)} t5买N=${fmt(a10.nearTail5BuyN)}`);
  }
  try { if (typeof dbManager.close === 'function') await dbManager.close(); } catch {}
  process.exit(0);
})();
