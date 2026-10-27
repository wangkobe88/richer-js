/**
 * 市值地板全清卖臂 反事实回放对拍（T79；182 跑）：双阈值 / 双冻结四方案。
 *
 * 样本：近 N 天（默认 5）有成功交易的实验 → 全部持仓 episode（含未平仓）。
 * 反事实臂：condition = marketCap > 0 AND marketCap < THRESH，cards=all 全清，bypass=false
 *   走标准卖腿去抖：3500ms + 窗后新 tick ≥5 + fire 重评仍真才卖，首真起计不重置，
 *   窗内翻假 clear，120s maxWait 强制逃生（fire 重评仍真）。
 * 口径对齐 FA：marketCap = 接受价(尘 tick 不喂/outlier 不推价) × bnbUsd(price_usd/price_bnb 前向填充)
 *   × totalSupply(wss_events token_create payload / flap·gang=1e9 / metadata fdv 兜底)。
 * 一阶对拍 only：episode 在 fire 时刻强平（余量×fire 价），fire 后的实际买/卖全部丢弃（repeat-buy 不建模）；
 * open episode 双侧盯市（实际=已实现+余量×末接受价）。
 * 输出：per-episode ΔBNB + 分桶（改善/误杀好票/割针底/无变化/未触发）+ 入口市值带 × 实验 + fdv 对拍。
 */
const { dbManager } = require('../src/services/dbManager');

const args = Object.fromEntries(process.argv.slice(2).map((s, i, a) => (s.startsWith('--') ? [s.slice(2), a[i + 1]] : [])).filter(x => x.length));
const CUTOFF_DAYS = Number(args['cutoff-days'] || 5);
const THRESHES = [Number(args.thresh || 5000)];
if (!args.thresh) THRESHES.push(5500);
const DEBOUNCE_MS = 3500, MIN_TICKS = 5, MAX_WAIT_MS = 120000, DUST = 0.001;
const DEBUG_TOKENS = Number(args['max-tokens'] || 0);   // 本地冒烟：只跑前 K 个 token 且窗口夹紧
const SEED_MS = DEBUG_TOKENS ? 60000 : 120000;
const FREEZE_MS = Number(args['freeze-ms'] || 0);       // realHoldDuration > N 门：入场 N ms 内条件恒 false

const c = dbManager.getClient();

async function pullTrades() {
  const cutoff = new Date(Date.now() - CUTOFF_DAYS * 86400000).toISOString();
  const { data, error } = await c.from('trades')
    .select('id,experiment_id,token_address,token_symbol,trade_direction,success,input_amount,output_amount,created_at,executed_at,metadata')
    .gte('created_at', cutoff).order('created_at', { ascending: true }).limit(5000);
  if (error) throw new Error('trades: ' + error.message);
  return data.filter(t => t.success);
}

async function pullExperiments(ids) {
  const { data, error } = await c.from('experiments').select('id,experiment_name').in('id', ids);
  if (error) throw new Error('experiments: ' + error.message);
  return new Map(data.map(e => [e.id, e.experiment_name]));
}

async function pullSupply(addrs) {
  const supply = new Map();
  for (let i = 0; i < addrs.length; i += 50) {
    const { data, error } = await c.from('wss_events')
      .select('token_address,platform,payload')
      .eq('kind', 'token_create').in('token_address', addrs.slice(i, i + 50));
    if (error) throw new Error('wss_events: ' + error.message);
    for (const r of data) {
      if (supply.has(r.token_address)) continue;
      const ts = Number(r.payload?.totalSupply) || 0;
      if (ts > 0) supply.set(r.token_address, { supply: ts, source: 'token_create(' + r.platform + ')' });
    }
  }
  return supply;
}

async function pullTicks(token, fromMs, toMs) {
  const rows = [];
  let anchor = 0;
  for (let p = 0; p < 80; p++) {
    const { data, error } = await c.from('wss_price_ticks')
      .select('id,block_time,block_number,log_index,price_bnb,price_usd,bnb_amount,price_outlier')
      .eq('token_address', token)
      .gte('block_time', new Date(fromMs).toISOString()).lte('block_time', new Date(toMs).toISOString())
      .gt('id', anchor).limit(4000);
    if (error) throw new Error(`ticks ${token}: ${error.message}`);
    rows.push(...data);
    if (data.length < 4000) return rows.sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
    anchor = data[data.length - 1].id;
  }
  console.warn(`WARN ${token} tick 超 32 万行截断`);
  return rows.sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
}

/** episode：建仓→清零（或至今未平） */
function buildEpisodes(trades) {
  const eps = [];
  let cur = null, qty = 0;
  for (const t of trades) {
    const ts = Date.parse(t.executed_at || t.created_at);
    const buy = t.trade_direction === 'buy';
    if (!cur) { cur = { trades: [], startTs: ts, endTs: ts, open: true }; qty = 0; }
    cur.trades.push(t); cur.endTs = ts;
    qty += buy ? Number(t.output_amount) : -Number(t.input_amount);
    if (qty <= 1e-9) { cur.open = false; eps.push(cur); cur = null; }
  }
  if (cur) eps.push(cur);
  return eps;
}

/** 反事实臂状态机（单阈值）。返回 {fireTs,firePrice,mcapAtFire,forced} | null */
function simulateArm(ticks, supply, startMs, thresh) {
  let t0 = null, cnt = 0, bnbUsd = 0, price = 0;
  for (const t of ticks) {
    const ts = Date.parse(t.block_time);
    if (ts < startMs - SEED_MS) continue;
    const pb = Number(t.price_bnb), pu = Number(t.price_usd);
    if (pb > 0 && pu > 0) bnbUsd = pu / pb;
    const nonDust = Number(t.bnb_amount) >= DUST;
    if (nonDust && !t.price_outlier && pb > 0) price = pb;
    if (!nonDust || ts < startMs) continue;      // 尘=无证据；入场前只做种子
    if (ts < startMs + FREEZE_MS) continue;      // 冻结窗内条件恒 false（不进 debounce 状态机）
    const mcap = price > 0 && bnbUsd > 0 ? price * bnbUsd * supply : 0;
    if (!(mcap > 0 && mcap < thresh)) { t0 = null; cnt = 0; continue; }   // 翻假 clear
    if (t0 === null) { t0 = ts; cnt = 0; continue; }                       // 首真起计
    cnt++;
    if (ts - t0 >= MAX_WAIT_MS) return { fireTs: ts, firePrice: price, mcapAtFire: mcap, forced: cnt < MIN_TICKS };
    if (ts - t0 >= DEBOUNCE_MS && cnt >= MIN_TICKS) return { fireTs: ts, firePrice: price, mcapAtFire: mcap, forced: false };
  }
  return null;
}

/** 入口接受市值（首 tick≥startMs）与末接受价（BNB） */
function scanMarket(ticks, supply, startMs) {
  let bnbUsd = 0, price = 0, entryMcap = 0;
  for (const t of ticks) {
    const ts = Date.parse(t.block_time);
    const pb = Number(t.price_bnb), pu = Number(t.price_usd);
    if (pb > 0 && pu > 0) bnbUsd = pu / pb;
    const nonDust = Number(t.bnb_amount) >= DUST;
    if (nonDust && !t.price_outlier && pb > 0) price = pb;
    if (!entryMcap && ts >= startMs && price > 0 && bnbUsd > 0) entryMcap = price * bnbUsd * supply;
  }
  return { entryMcap, lastPrice: price };
}

(async () => {
  const trades = await pullTrades();
  const expNames = await pullExperiments([...new Set(trades.map(t => t.experiment_id))]);
  console.log(`trades(成功)=${trades.length} experiments=${expNames.size} 阈值=${THRESHES} 窗口=${CUTOFF_DAYS}d`);

  const groups = new Map();
  for (const t of trades) {
    const k = t.experiment_id + ':' + t.token_address;
    (groups.get(k) || groups.set(k, []).get(k)).push(t);
  }
  const episodes = [];
  for (const [k, ts] of groups) {
    ts.sort((a, b) => Date.parse(a.executed_at || a.created_at) - Date.parse(b.executed_at || b.created_at));
    for (const ep of buildEpisodes(ts)) {
      const [expId, token] = k.split(':');
      episodes.push({ expId, expName: expNames.get(expId), token, symbol: ts[0].token_symbol, ...ep });
    }
  }
  console.log(`episodes=${episodes.length}（open=${episodes.filter(e => e.open).length}）`);

  const addrs = [...new Set(episodes.map(e => e.token))];
  const supplyMap = await pullSupply(DEBUG_TOKENS ? addrs.slice(0, DEBUG_TOKENS) : addrs);
  for (const e of episodes) {
    const s = supplyMap.get(e.token);
    if (s) { e.supply = s.supply; e.supplySource = s.source; continue; }
    const plat = e.trades[0]?.metadata?.factors?.trendFactors?.platform || e.trades[0]?.metadata?.factors?.platform;
    if (plat === 'flap' || plat === 'gang') { e.supply = 1e9; e.supplySource = 'fixed(' + plat + ')'; continue; }
    const tf = e.trades[0]?.metadata?.factors?.trendFactors || {};
    if (Number(tf.fdv) > 0 && Number(tf.currentPrice) > 0) { e.supply = tf.fdv / tf.currentPrice; e.supplySource = 'meta(fdv/price)'; continue; }
    e.supply = 0; e.supplySource = 'MISSING';
  }
  const miss = episodes.filter(e => !e.supply);
  if (miss.length) console.warn('supply 缺失(跳过):', miss.map(e => e.token).join(','));

  // per-token ticks（同 token 跨实验去重；窗口=最早入场−种子 到 现在）
  let tokenList = [...new Set(episodes.map(e => e.token))];
  if (DEBUG_TOKENS) tokenList = tokenList.slice(0, DEBUG_TOKENS);
  const tickCache = new Map();
  const now = Date.now();
  for (const token of tokenList) {
    const eps = episodes.filter(e => e.token === token);
    const from = Math.min(...eps.map(e => e.startTs)) - SEED_MS;
    let to = now;
    if (DEBUG_TOKENS) to = Math.min(now, Math.max(...eps.map(e => e.endTs)) + 60000);
    else if (!eps.some(e => e.open)) to = Math.min(now, Math.max(...eps.map(e => e.endTs)) + 600000);
    tickCache.set(token, await pullTicks(token, from, to));
  }

  // 对拍（双阈值）
  const results = [];
  for (const e of episodes) {
    const ticks = tickCache.get(e.token);
    if (!ticks || !e.supply) continue;
    const { entryMcap, lastPrice } = scanMarket(ticks, e.supply, e.startTs);

    // 实际侧（open 用末接受价盯市）
    let qty = 0, cost = 0, proceeds = 0;
    for (const t of e.trades) {
      if (t.trade_direction === 'buy') { qty += Number(t.output_amount); cost += Number(t.input_amount); }
      else { qty -= Number(t.input_amount); proceeds += Number(t.output_amount); }
    }
    const actualPnl = proceeds - cost + (e.open ? qty * lastPrice : 0);

    const r = { exp: e.expName, expId: e.expId.slice(0, 8), token: e.token, symbol: e.symbol, open: e.open,
                entryMcap: Math.round(entryMcap), supplySource: e.supplySource, actualPnl: +actualPnl.toFixed(6), arms: {} };
    const fdv = Number(e.trades[0]?.metadata?.factors?.trendFactors?.fdv) || 0;
    if (fdv > 0 && entryMcap > 0) r.fdvCheck = +(entryMcap / fdv).toFixed(2);

    for (const th of THRESHES) {
      const fire = simulateArm(ticks, e.supply, e.startTs, th);
      let cfQty = 0, cfCost = 0, cfProceeds = 0, dropped = 0;
      if (fire) {
        for (const t of e.trades) {
          const ts = Date.parse(t.executed_at || t.created_at);
          if (ts >= fire.fireTs) { if (t.trade_direction === 'buy') dropped++; continue; }
          if (t.trade_direction === 'buy') { cfQty += Number(t.output_amount); cfCost += Number(t.input_amount); }
          else { cfQty -= Number(t.input_amount); cfProceeds += Number(t.output_amount); }
        }
        cfProceeds += cfQty * fire.firePrice;   // fire 时刻全清
      }
      const cfPnl = fire ? cfProceeds - cfCost : actualPnl;   // 未触发=与实际全同
      const delta = +(cfPnl - actualPnl).toFixed(6);
      let bucket;
      if (!fire) bucket = '未触发';
      else if (!e.open && fire.fireTs >= e.endTs) bucket = '无变化(晚于出场)';
      else if (delta > 0) bucket = '改善';
      else if (delta < 0) bucket = actualPnl > 0 ? '误杀好票' : '割针底(亏更多)';
      else bucket = '无变化';
      r.arms[th] = { fire: fire ? { ts: new Date(fire.fireTs).toISOString().slice(5, 19), price: fire.firePrice, mcap: Math.round(fire.mcapAtFire), forced: fire.forced } : null,
                     cfPnl: +cfPnl.toFixed(6), delta, droppedBuys: dropped, bucket };
    }
    results.push(r);
  }

  const by = arr => JSON.stringify(arr.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {}));
  const band = r => r.entryMcap <= 0 ? '未知' : r.entryMcap < 5000 ? 'a)<5K' : r.entryMcap < 7500 ? 'b)5-7.5K' : r.entryMcap < 11000 ? 'c)7.5-11K' : r.entryMcap < 20000 ? 'd)11-20K' : 'e)>20K';
  const bandNames = ['a)<5K', 'b)5-7.5K', 'c)7.5-11K', 'd)11-20K', 'e)>20K', '未知'];

  for (const th of THRESHES) {
    console.log(`\n═════════ 阈值 ${th} ═════════`);
    console.log('分桶:', by(results.map(r => r.arms[th].bucket)));
    console.log(`Δ合计=${results.reduce((s, r) => s + r.arms[th].delta, 0).toFixed(4)} BNB | 实际=${results.reduce((s, r) => s + r.actualPnl, 0).toFixed(4)} 反事实=${results.reduce((s, r) => s + r.arms[th].cfPnl, 0).toFixed(4)}`);
    console.log('入口市值带 × 分桶:');
    for (const b of bandNames) {
      const rs = results.filter(r => band(r) === b);
      if (!rs.length) continue;
      console.log(`  ${b}: n=${rs.length} Δ=${rs.reduce((s, r) => s + r.arms[th].delta, 0).toFixed(4)} 分桶=${by(rs.map(r => r.arms[th].bucket))}`);
    }
    console.log('实验 × Δ:');
    const per = new Map();
    for (const r of results) { const o = per.get(r.exp) || { n: 0, d: 0 }; o.n++; o.d += r.arms[th].delta; per.set(r.exp, o); }
    for (const [e, o] of per) if (Math.abs(o.d) > 1e-6) console.log(`  ${e}: n=${o.n} Δ=${o.d.toFixed(4)}`);

    const fired = results.filter(r => r.arms[th].bucket === '改善' || r.arms[th].bucket === '误杀好票' || r.arms[th].bucket === '割针底(亏更多)');
    console.log(`触发出场明细 (${fired.length}):`);
    for (const r of fired.sort((a, b) => b.arms[th].delta - a.arms[th].delta))
      console.log(`  ${r.expId} ${r.symbol || r.token.slice(0, 10)} 入口=${r.entryMcap} fire=${r.arms[th].fire.ts}@${r.arms[th].fire.mcap}${r.arms[th].fire.forced ? '!强制' : ''} 实际=${r.actualPnl} cf=${r.arms[th].cfPnl} Δ=${r.arms[th].delta} 弃买=${r.arms[th].droppedBuys} fdv对拍=${r.fdvCheck || '-'} ${r.open ? 'OPEN' : ''}`);
  }

  console.log('\nopen episodes 现状:');
  for (const r of results.filter(r => r.open))
    console.log(`  ${r.expId} ${r.symbol || r.token.slice(0, 10)} 入口=${r.entryMcap} 实际(盯市)=${r.actualPnl}` +
      THRESHES.map(th => ` | <${th}:${r.arms[th].bucket} Δ=${r.arms[th].delta}`).join(''));

  require('fs').writeFileSync(__dirname + '/tmp-mcap5k-result.json', JSON.stringify(results, null, 1));
  console.log('\n明细已写 ' + __dirname + '/tmp-mcap5k-result.json');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
