// 差异票真 FA 重放抽查（2026-11-15，182 跑）：v121/v122 首两波臂新增挡票的真键值验证
// 目的：门控挡面(33 票) vs 调研模拟面(16 票) 差异巨大，抽查 B 窗大误伤票（来财/新语新言/FTT）
//       + A 窗唯一大误伤（噜噜）在触发时刻的真 f0/wave/簇/age，排除门串误挡（FA bug）可能。
// 方法：拉票在对应窗内全部 ticks（链序）+ 基线实验首 BUY 信号时刻=触发锚，
//       真重放 FourMemeFactorAggregator 到锚前，buildFactorMap 取活值。
const { dbManager } = require('../src/services/dbManager.js');
const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator.js');

const CASES = [
  // B 窗（基线 v119 883e2513 / 簇臂 v120 415b4ea0 / 扩展门 v122 631bd2c2）
  { tag: 'B-来财', addr: '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', base: '883e2513', win: ['2026-11-05T00:00:00Z', '2026-11-05T13:45:10Z'] },
  { tag: 'B-新语新言', addr: '0xd92913a0956ec41bea37752365cc9d9b92587777', base: '883e2513', win: ['2026-11-05T00:00:00Z', '2026-11-05T13:45:10Z'] },
  { tag: 'B-FTT', addr: '0xc70a1cbe0b7e2320260ab406bd15af3a199e7777', base: '883e2513', win: ['2026-11-05T00:00:00Z', '2026-11-05T13:45:10Z'] },
  // A 窗（基线 v115 34e78e97）
  { tag: 'A-噜噜', addr: '0x0d21b86a6384931dbcf8cc7731f745126e1a7777', base: '34e78e97', win: ['2026-11-02T12:00:00Z', '2026-11-03T14:58:49Z'] },
];

async function main() {
  const c = await dbManager.getClient();
  // 解析实验 id
  const ids = {};
  {
    const { data } = await c.from('experiments').select('id,experiment_name').limit(500);
    for (const pre of ['34e78e97', '883e2513', '415b4ea0', '631bd2c2']) {
      const hit = data.find((e) => e.id.startsWith(pre));
      if (!hit) throw new Error(pre + ' 未找到');
      ids[pre] = hit.id;
    }
  }

  for (const cs of CASES) {
    // ① token_create 时间
    const { data: ev } = await c.from('wss_events').select('block_time,payload')
      .eq('token_address', cs.addr).eq('kind', 'token_create').limit(1);
    const createdStr = ev && ev[0] && ev[0].block_time;
    const createdMs = createdStr ? Date.parse(createdStr) : null;

    // ② 窗内 ticks（链序）
    let ticks = [], from = 0;
    while (true) {
      const { data, error } = await c.from('wss_price_ticks')
        .select('token_address,trade_type,trader_address,sender_address,price_bnb,bnb_amount,token_amount,block_number,block_time,tx_hash,log_index,platform')
        .eq('token_address', cs.addr)
        .gte('block_time', cs.win[0]).lte('block_time', cs.win[1])
        .order('block_number', { ascending: true }).order('log_index', { ascending: true })
        .range(from, from + 999);
      if (error) throw new Error(cs.tag + ' ticks: ' + error.message);
      ticks = ticks.concat(data);
      if (data.length < 1000) break;
      from += 1000;
    }

    // ③ 基线首 BUY 信号（触发锚）
    const { data: sig, error: se } = await c.from('strategy_signals').select('created_at,executed')
      .eq('experiment_id', ids[cs.base]).eq('token_address', cs.addr).eq('signal_type', 'BUY')
      .order('created_at', { ascending: true }).limit(1);
    if (se) throw new Error(cs.tag + ' 信号查询: ' + se.message);
    if (!sig || !sig[0]) { console.log(`\n== ${cs.tag} == 无基线 BUY 信号，跳过`); continue; }
    const fireMs = Date.parse(sig[0].created_at);

    // ④ 扩展门侧信号对照（被挡=无信号或晚入）
    const { data: sigExt } = await c.from('strategy_signals').select('created_at,executed')
      .eq('experiment_id', ids.v122).eq('token_address', cs.addr).eq('signal_type', 'BUY')
      .order('created_at', { ascending: true }).limit(3);

    // ⑤ 真 FA 重放到锚前（block_time <= fire）
    const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
    fa.registerToken(cs.addr, { createdAtMs: createdMs, totalSupply: 1e9, symbol: cs.tag, creatorAddress: null });
    let fed = 0;
    for (const t of ticks) {
      const ts = Date.parse(t.block_time);
      if (ts > fireMs) break;
      fa.processTick({
        token_address: t.token_address, trade_type: t.trade_type,
        trader_address: t.trader_address, sender_address: t.sender_address,
        price_bnb: t.price_bnb, bnb_amount: t.bnb_amount, token_amount: t.token_amount,
        block_number: t.block_number, timestamp: ts, tx_hash: t.tx_hash, log_index: t.log_index,
      }, {});
      fed++;
    }
    const f = fa.buildFactorMap(cs.addr, fireMs);
    const gate = {
      f0: f.launchFirstBlockWallets, wave: f.launchFirstWaveWallets,
      cluster: f.launchBundleClusterSize, ageSec: f.tokenAgeSec,
      blocked: (f.launchBundleClusterSize >= 3 || (f.launchFirstBlockWallets >= 2 && f.launchFirstWaveWallets >= 3)) && f.tokenAgeSec <= 60,
    };
    console.log(`\n== ${cs.tag} ${cs.addr} ==`);
    console.log(`  创建=${createdStr}  窗内ticks=${ticks.length}  喂入=${fed}  首信号=${sig[0].created_at} (executed=${sig[0].executed})`);
    console.log(`  真FA@fire: f0=${gate.f0} wave=${gate.wave} cluster=${gate.cluster} age=${gate.ageSec}s → 扩展门挡=${gate.blocked}`);
    console.log(`  v122 侧 BUY 信号=${sigExt && sigExt.length ? sigExt.map((s) => s.created_at + ' ' + s.status).join(' | ') : '无'}`);
  }
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
