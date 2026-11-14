// FA 真重放诊断：e4fe…7777 为何 19:53:42 后无触发（本地纯内存，单票 750 ticks）
import { dbManager } from '../../src/services/dbManager.js';
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);

const EXP = '5390bbfa-0c86-48a2-b9e1-94537c54ac17';
const TOKEN = '0xe4fe922f88c09cbe127cebfa25f84d2f00917777';
const c = await dbManager.getClient();

// legs 从实验 config
const { data: exp, error: ee } = await c.from('experiments').select('config').eq('id', EXP).single();
if (ee) throw new Error(ee.message);
const legs = (exp.config.strategiesConfig.buyStrategies || []).map((l, i) => ({
  id: 'P' + (i + 1), priority: l.priority, condition: l.condition,
  maxTriggers: l.signalGate?.maxTriggers ?? 1,
}));

// token_create meta
const { data: ev, error: eve } = await c.from('wss_events')
  .select('payload,block_time').eq('token_address', TOKEN).eq('kind', 'token_create').limit(1);
if (eve) throw new Error(eve.message);
const meta = ev[0]?.payload || {};
const createdAtMs = Date.parse(ev[0]?.block_time || '');

// ticks 全量
const { data: rows, error: te } = await c.from('wss_price_ticks')
  .select('token_address,trade_type,trader_address,sender_address,price_bnb,bnb_amount,token_amount,block_number,block_time,tx_hash,log_index,price_outlier,platform')
  .eq('token_address', TOKEN).order('block_time', { ascending: true }).limit(2000);
if (te) throw new Error(te.message);
console.log('meta: platform=', meta.platform, 'createdAt=', new Date(createdAtMs).toISOString(), 'ticks=', rows.length);

const FourMemeFactorAggregator = require_('../../src/services/FourMemeFactorAggregator.js');
const { ConditionEvaluator } = require_('../../src/strategies/ConditionEvaluator.js');
const fa = new FourMemeFactorAggregator({ fourmemeWs: { factorParams: exp.config.fourmemeWs?.factorParams || {} } }, null);
fa.registerToken(TOKEN, {
  createdAtMs, totalSupply: meta.totalSupply || 1e9, symbol: meta.symbol || '',
  creatorAddress: meta.creatorAddress || null, platform: meta.platform || null, graduationThresholdBnb: null,
});
const evl = new ConditionEvaluator();
const parsed = legs.map(l => ({ ...l, ast: evl.parseCondition(l.condition) }));

// 耗尽语义：P1=2 其余=1；先按生产时序记账
const fired = new Map(); // legId -> count
const LAST_SIG = Date.parse('2026-11-02T19:53:42+00:00');
const KEY_TICKS = ['2026-11-03T02:01:35','2026-11-03T07:50:03','2026-11-03T07:50:05'];
let postFired = [];
for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  const ts = Date.parse(row.block_time);
  fa.processTick({
    token_address: row.token_address, trade_type: row.trade_type, trader_address: row.trader_address,
    sender_address: row.sender_address || null, price_bnb: Number(row.price_bnb), bnb_amount: Number(row.bnb_amount || 0),
    token_amount: Number(row.token_amount || 0), block_number: row.block_number, timestamp: ts,
    tx_hash: row.tx_hash, log_index: row.log_index, price_outlier: row.price_outlier || false, platform: row.platform || null,
  }, { emitFactors: false });
  const factors = fa.buildFactorMap(TOKEN, ts);
  if (!factors) continue;
  if (KEY_TICKS.some(k => row.block_time.startsWith(k))) {
    console.log(`\n== ${row.block_time} 因子 ==`);
    for (const k of ['tradeCount','buyVolumeBnb','holdersExDust','currentVsLaunchPct','actTotalBnb','currentPriceBnb'])
      console.log(' ', k, '=', factors[k]);
  }
  for (const p of parsed) {
    const used = fired.get(p.id) || 0;
    if (used >= p.maxTriggers) continue;
    let pass = false;
    try { pass = evl.evaluate(p.ast, factors) === true; } catch (e) {}
    if (pass) {
      fired.set(p.id, used + 1);
      if (ts > LAST_SIG) postFired.push({ leg: p.id, time: row.block_time, curVs: factors.currentVsLaunchPct, tc: factors.tradeCount, bv: factors.buyVolumeBnb, act: factors.actTotalBnb, hd: factors.holdersExDust });
    }
  }
}
console.log('\n== 19:53:42 之后按重放会触发的腿 ==', postFired.length);
for (const f of postFired) console.log(JSON.stringify(f));
// 各腿首触发时刻（无耗尽限制视角）
console.log('（注：上面已按耗尽语义记账；P1=2 次、其余 1 次）');
process.exit(0);
