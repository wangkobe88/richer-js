// P17 prune-aware 重放：验证「30min 静默 → FA state 删 → 复流空 state 重建」是否解释
// 0xe4fe 后续（02:01/07:50）引擎侧不触发（本地纯内存单票）
import { dbManager } from '../../src/services/dbManager.js';
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);

const EXP = '5390bbfa-0c86-48a2-b9e1-94537c54ac17';
const TOKEN = '0xe4fe922f88c09cbe127cebfa25f84d2f00917777';
const PRUNE_MS = 30 * 60 * 1000;   // faPruneMaxAgeSec 缺省 1800s
const c = await dbManager.getClient();

const { data: exp, error: ee } = await c.from('experiments').select('config').eq('id', EXP).single();
if (ee) throw new Error(ee.message);
const legs = (exp.config.strategiesConfig.buyStrategies || []).map((l, i) => ({
  id: 'P' + (i + 1), condition: l.condition, maxTriggers: l.signalGate?.maxTriggers ?? 1,
}));

const { data: ev } = await c.from('wss_events').select('payload,block_time')
  .eq('token_address', TOKEN).eq('kind', 'token_create').limit(1);
const meta = ev[0]?.payload || {};
const createdAtMs = Date.parse(ev[0]?.block_time);

const { data: rows } = await c.from('wss_price_ticks')
  .select('token_address,trade_type,trader_address,sender_address,price_bnb,bnb_amount,token_amount,block_number,block_time,tx_hash,log_index,price_outlier,platform')
  .eq('token_address', TOKEN).order('block_time', { ascending: true }).limit(2000);
console.log(`ticks=${rows.length} createdAt=${new Date(createdAtMs).toISOString()} platform=${meta.platform}`);

// 1) tick gap 分布（≥10min 的静默段）
let prev = null; const gaps = [];
for (const r of rows) {
  const ts = Date.parse(r.block_time);
  if (prev != null && ts - prev.ts >= 10 * 60 * 1000) {
    gaps.push({ from: new Date(prev.ts).toISOString(), to: r.block_time, gapMin: ((ts - prev.ts) / 60000).toFixed(1) });
  }
  prev = { ts };
}
console.log('== ≥10min 静默段 ==');
for (const g of gaps) console.log(`  ${g.from} → ${g.to}（${g.gapMin} min）${Number(g.gapMin) >= 30 ? '  ← 超 prune 窗' : ''}`);

// 2) prune-aware 重放
const FourMemeFactorAggregator = require_('../../src/services/FourMemeFactorAggregator.js');
const { ConditionEvaluator } = require_('../../src/strategies/ConditionEvaluator.js');
const fa = new FourMemeFactorAggregator({ fourmemeWs: { factorParams: exp.config.fourmemeWs?.factorParams || {} } }, null);
const evl = new ConditionEvaluator();
const parsed = legs.map(l => ({ ...l, ast: evl.parseCondition(l.condition) }));
const regMeta = {
  createdAtMs, totalSupply: meta.totalSupply || 1e9, symbol: meta.symbol || '',
  creatorAddress: meta.creatorAddress || null, platform: meta.platform || null, graduationThresholdBnb: null,
};

const fired = new Map();       // 引擎侧已耗尽记账（P1=2 其余 1，来自 DB 四信号）
fired.set('P1', 2); fired.set('P2', 1); fired.set('P3', 1);
const LAST_SIG = Date.parse('2026-11-02T19:53:42+00:00');
const KEY = ['2026-11-03T02:01:35', '2026-11-03T07:50:03', '2026-11-03T07:50:05'];
let registered = false, lastAlive = null, prunedCount = 0;
const postFired = [];
for (const row of rows) {
  const ts = Date.parse(row.block_time);
  // prune 判据（保守近似：只用本票时钟；其它票 tick 会推得更早，方向一致）
  if (registered && lastAlive != null && ts - lastAlive > PRUNE_MS && fa.getTokenState(TOKEN)) {
    fa._states.delete(TOKEN);
    registered = false; prunedCount++;
  }
  if (!fa.getTokenState(TOKEN)) {
    fa.registerToken(TOKEN, regMeta);
    if (!registered) registered = true;
  }
  fa.processTick({
    token_address: row.token_address, trade_type: row.trade_type, trader_address: row.trader_address,
    sender_address: row.sender_address || null, price_bnb: Number(row.price_bnb), bnb_amount: Number(row.bnb_amount || 0),
    token_amount: Number(row.token_amount || 0), block_number: row.block_number, timestamp: ts,
    tx_hash: row.tx_hash, log_index: row.log_index, price_outlier: row.price_outlier || false, platform: row.platform || null,
  }, { emitFactors: false });
  lastAlive = ts;
  const factors = fa.buildFactorMap(TOKEN, ts);
  if (!factors) continue;
  if (KEY.some(k => row.block_time.startsWith(k))) {
    console.log(`\n== ${row.block_time} 引子（prune-aware）==`);
    for (const k of ['tradeCount','buyVolumeBnb','holdersExDust','currentVsLaunchPct','actTotalBnb','currentPriceBnb'])
      console.log(' ', k, '=', factors[k]);
  }
  for (const p of parsed) {
    if ((fired.get(p.id) || 0) >= p.maxTriggers) continue;
    let pass = false;
    try { pass = evl.evaluate(p.ast, factors) === true; } catch (e) {}
    if (pass) {
      fired.set(p.id, (fired.get(p.id) || 0) + 1);
      if (ts > LAST_SIG) postFired.push({ leg: p.id, time: row.block_time, curVs: factors.currentVsLaunchPct, tc: factors.tradeCount, bv: factors.buyVolumeBnb, act: factors.actTotalBnb, hd: factors.holdersExDust });
    }
  }
}
console.log(`\n== prune 次数 ${prunedCount}；19:53:42 后会触发的腿 == ${postFired.length}`);
for (const f of postFired) console.log(JSON.stringify(f));
process.exit(0);
