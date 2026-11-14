// 一次性（182 跑）：①LOVE V94 行定位 ②a813 09:28:14 锚前 15s 可靠价（快照矛盾核实）
// ③40a2 07:42:39 尾 10s 买力（BP74 第二步数据面）④c84a 三锚尾 10s 复核
const { dbManager } = require('../../src/services/dbManager.js');
const V94 = '85cbad14-696f-49b2-baa4-a5407df4a2d2';
const V101 = 'bbd6e464-f8db-46c3-93b4-6638e53d72dc';
const LOVE = '0xf0b83df726bba9a8a01fcd5da0b2303e83ca7777';
const A813 = '0xa813cd684ce664d2dcde26797246e3b4ffd37777';
const C84A = '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777';
const T40A2 = '0x40a2e8f5ceb8ee6aec025512596b9ffaaa954444';
const logger = { info() {}, warn() {}, error() {} };
const f2 = (n) => (n == null ? '?' : (+n).toFixed(2));
async function main() {
  const client = await dbManager.getClient();
  // ① LOVE V94
  const { data: love } = await client.from('strategy_signals')
    .select('id,created_at,metadata').eq('experiment_id', V94).eq('signal_type', 'BUY')
    .eq('token_address', LOVE).order('created_at', { ascending: true }).limit(30);
  console.log(`== LOVE@V94 ${(love || []).length} 行 ==`);
  for (const s of love || []) {
    const bp = s.metadata && s.metadata.buyPoint;
    const e = bp && bp.dimensions && bp.dimensions.entry_shape || {};
    const a = bp && bp.assessment || {};
    console.log(`${s.created_at.slice(11, 19)} 综=${a.bucket || '无bp'} entry=${e.bucket || '?'}(${e.prob != null ? Number(e.prob).toFixed(2) : '?'})`);
  }
  // ②③④ 锚窗快照
  const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');
  const { buildBuyPointSnapshot } = require('../../src/market-analysis/buy-point-snapshot.js');
  const svc = new BuyPointCheckService({ enabled: true, gate: { awaitMs: 1000 }, settleDelayMs: 0, persist: false }, logger, {});
  const probes = [
    ['a813@09:28:14', A813, '2026-11-05T09:28:14Z'],
    ['40a2@07:42:39', T40A2, '2026-11-04T07:42:39Z'],
    ['c84a@12:31:26', C84A, '2026-11-05T12:31:26Z'],
    ['c84a@12:31:32', C84A, '2026-11-05T12:31:32Z'],
    ['c84a@12:31:38', C84A, '2026-11-05T12:31:38Z'],
  ];
  for (const [name, addr, at] of probes) {
    const pull = await svc._pullTicksDb(addr, Date.parse(at));
    const rows = pull.rows || [];
    const meta = { address: addr, platform: 'fourmeme' };
    const d = buildBuyPointSnapshot(rows, meta).buyDerived;
    const act = d.activity || {};
    console.log(`\n== ${name} rows=${rows.length} chg5=${f2(d.chg5Pct)} chg10=${f2(d.chg10Pct)} 未收复=${f2(d.recentDip5UnrecoveredPct)} 段=${f2(d.recentDip5Pct)}@${d.recentDip5SecAgo}s` +
      `\n   尾10 买=${(act.nearTail10BuyBnb ?? '?')}×${act.nearTail10BuyN ?? '?'}笔 卖=${(act.nearTail10SellBnb ?? '?')}×${act.nearTail10SellWallets ?? '?'}w`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
