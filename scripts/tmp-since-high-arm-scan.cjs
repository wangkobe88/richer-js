/**
 * 高点停滞减仓卖臂 反事实回放扫描（候选；182 跑）。
 *
 * 假设臂：peakProfitPct >= ARM_PEAK（武装，曾冲高）AND secSinceHigh > N 秒（距持仓期峰值
 * 超过 N 秒未创新高）→ 卖 1 卡，冷却 60s，最多卖 卡数-1 张（保 1 卡给现行栈兜底）。
 * bypass=false 双门：3500ms + 窗后新 tick ≥5（fire 重评仍真才卖，首真起计不重置）。
 *
 * 口径对齐 FA 接受价链：尘 tick(<0.001 BNB) 不喂价 / price_outlier 不推价；峰值与锚同轨
 * （任意接受价）。锚=入场后首接受价（FA 真实=fire 价起算，回放一阶近似，T64/T79 同款）。
 * 卡数=per-episode 买入 BNB ÷ perCardBNB（10-27 14:55 UTC 前 0.001 / 后 0.002）。
 * Δ = Σ_fires [qtyPerCard×firePrice − 实际每卡所得]（open 票实际侧末接受价盯市）。
 */
const { dbManager } = require('../src/services/dbManager');

const args = Object.fromEntries(process.argv.slice(2).map((s, i, a) => (s.startsWith('--') ? [s.slice(2), a[i + 1]] : [])).filter(x => x.length));
const CUTOFF_DAYS = Number(args['cutoff-days'] || 5);
const ARM_PEAKS = (args.peaks || '10,20,30').split(',').map(Number);
const NS = (args.ns || '60,90,120,180,240,300').split(',').map(Number);
const CD_MS = Number(args['cd-ms'] || 60000);
const DEBOUNCE_MS = 3500, MIN_TICKS = 5, DUST = 0.001;
const PER_CARD_SWITCH_TS = Date.parse('2026-10-27T14:55:00Z');   // v43 perCardBNB 0.001→0.002
const DEBUG_TOKENS = Number(args['max-tokens'] || 0);
const SEED_MS = DEBUG_TOKENS ? 60000 : 120000;

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

/**
 * 假设臂状态机。返回 fires[]（每次 fire 的 ts/price/profitPct/secSinceHigh）。
 * 峰值链：accepted 价创新高 → peak/peakAt 推进（secSinceHigh 归零语义）。
 * endMs=episode 出场时刻（平仓票最后一笔卖 / open=∞）：票清仓后臂不再存在，超出即停。
 */
function simulateSinceHigh(ticks, startMs, endMs, armPeakPct, nSec, maxFires) {
  const fires = [];
  let price = 0, anchor = 0, peak = 0, peakAt = startMs;
  let t0 = null, cnt = 0, cdUntil = 0;
  for (const t of ticks) {
    const ts = Date.parse(t.block_time);
    if (ts < startMs - SEED_MS) continue;
    if (ts > endMs) break;
    const pb = Number(t.price_bnb);
    const nonDust = Number(t.bnb_amount) >= DUST;
    if (!(nonDust && !t.price_outlier && pb > 0)) continue;   // 尘/outlier：不喂价不进状态机
    price = pb;
    if (!anchor) { anchor = pb; peak = pb; peakAt = ts; }
    if (pb > peak) { peak = pb; peakAt = ts; }
    if (ts < startMs || fires.length >= maxFires) continue;
    const armed = anchor > 0 && (peak / anchor - 1) * 100 >= armPeakPct;
    const cond = armed && (ts - peakAt) >= nSec * 1000;
    if (!cond || ts < cdUntil) { t0 = null; cnt = 0; continue; }
    if (t0 === null) { t0 = ts; cnt = 0; continue; }
    cnt++;
    if (ts - t0 >= DEBOUNCE_MS && cnt >= MIN_TICKS) {
      fires.push({ ts, price, profitPct: (price / anchor - 1) * 100, secSinceHigh: Math.round((ts - peakAt) / 1000) });
      t0 = null; cnt = 0; cdUntil = ts + CD_MS;
    }
  }
  return fires;
}

(async () => {
  const trades = await pullTrades();
  const expNames = await pullExperiments([...new Set(trades.map(t => t.experiment_id))]);
  console.log(`trades(成功)=${trades.length} experiments=${expNames.size} 窗口=${CUTOFF_DAYS}d peaks=${ARM_PEAKS} ns=${NS}`);

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

  // per-token ticks
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

  // per-episode 基础量
  const base = [];
  for (const e of episodes) {
    const ticks = tickCache.get(e.token);
    if (!ticks || !ticks.length) continue;
    let qty = 0, cost = 0, proceeds = 0, buyBnb = 0, buyQty = 0, lastPrice = 0, lastTs = e.startTs;
    for (const t of e.trades) {
      if (t.trade_direction === 'buy') { qty += Number(t.output_amount); cost += Number(t.input_amount); buyBnb += Number(t.input_amount); buyQty += Number(t.output_amount); }
      else { qty -= Number(t.input_amount); proceeds += Number(t.output_amount); }
    }
    for (const t of ticks) {
      const pb = Number(t.price_bnb);
      if (Number(t.bnb_amount) >= DUST && !t.price_outlier && pb > 0) { lastPrice = pb; lastTs = Date.parse(t.block_time); }
    }
    if (!(buyQty > 1e-9) || buyBnb <= 0 || lastPrice <= 0) continue;
    const perCard = e.startTs < PER_CARD_SWITCH_TS ? 0.001 : 0.002;
    const nCards = Math.max(1, Math.round(buyBnb / perCard));
    const qtyPerCard = buyQty / nCards;
    const actualPerCard = (proceeds + (e.open ? qty * lastPrice : 0)) / nCards;
    // 实际路径峰值利润（回放口径，用于盈转亏子集分层）
    let anchor = 0, peak = 0;
    for (const t of ticks) {
      const ts = Date.parse(t.block_time);
      const pb = Number(t.price_bnb);
      if (!(Number(t.bnb_amount) >= DUST && !t.price_outlier && pb > 0)) continue;
      if (ts < e.startTs) continue;
      if (!anchor) anchor = pb;
      if (pb > peak) peak = pb;
      if (ts >= e.endTs && !e.open) break;
    }
    const actualPeakPct = anchor > 0 ? (peak / anchor - 1) * 100 : 0;
    const finalPct = anchor > 0 ? (lastPrice / anchor - 1) * 100 : 0;
    base.push({ ...e, ticks, qty, buyBnb, nCards, qtyPerCard, actualPerCard, lastPrice, lastTs, actualPeakPct, finalPct,
                actualPnl: proceeds - cost + (e.open ? qty * lastPrice : 0) });
  }
  console.log(`有效 episodes=${base.length}（open=${base.filter(e => e.open).length}）`);

  // 扫描矩阵
  const results = base.map(e => ({ exp: e.expName, expId: e.expId.slice(0, 8), token: e.token, symbol: e.symbol, open: e.open,
    nCards: e.nCards, actualPnl: +e.actualPnl.toFixed(6), actualPeakPct: +e.actualPeakPct.toFixed(1), finalPct: +e.finalPct.toFixed(1),
    actualPerCard: +e.actualPerCard.toFixed(6), arms: {} }));
  for (const [i, e] of base.entries()) {
    const r = results[i];
    for (const ap of ARM_PEAKS) for (const n of NS) {
      const fires = simulateSinceHigh(e.ticks, e.startTs, e.open ? now : e.endTs, ap, n, e.nCards - 1);
      const delta = fires.reduce((s, f) => s + e.qtyPerCard * f.price, 0) - fires.length * e.actualPerCard;
      r.arms[ap + '/' + n] = { fires: fires.length, delta: +delta.toFixed(6),
        detail: fires.map(f => ({ ts: new Date(f.ts).toISOString().slice(5, 19), price: f.price, profitPct: +f.profitPct.toFixed(1), sec: f.secSinceHigh })) };
    }
  }

  const key = (ap, n) => ap + '/' + n;
  console.log(`\n═══ Δ 合计矩阵 (BNB)，行=武装门槛 peakProfitPct≥ 行头，列=停滞秒数 N ═══`);
  console.log('peak\\N  ' + NS.map(n => String(n).padStart(9)).join(''));
  for (const ap of ARM_PEAKS) {
    console.log(String(ap).padEnd(7) + NS.map(n => results.reduce((s, r) => s + r.arms[key(ap, n)].delta, 0).toFixed(4).padStart(9)).join(''));
  }
  console.log(`\n═══ fire 次数矩阵 ═══`);
  console.log('peak\\N  ' + NS.map(n => String(n).padStart(9)).join(''));
  for (const ap of ARM_PEAKS) {
    console.log(String(ap).padEnd(7) + NS.map(n => results.reduce((s, r) => s + r.arms[key(ap, n)].fires, 0).toString().padStart(9)).join(''));
  }
  console.log(`\n═══ 触发 episode 数 ═══`);
  console.log('peak\\N  ' + NS.map(n => String(n).padStart(9)).join(''));
  for (const ap of ARM_PEAKS) {
    console.log(String(ap).padEnd(7) + NS.map(n => results.filter(r => r.arms[key(ap, n)].fires > 0).length.toString().padStart(9)).join(''));
  }

  // 盈转亏子集（曾浮盈≥20% 终局≤0）——用户痛点主通道
  const faded = results.filter(r => r.actualPeakPct >= 20 && r.finalPct <= 0);
  console.log(`\n═══ 盈转亏子集（峰值≥+20% 且终局≤0；n=${faded.length}）Δ ═══`);
  if (faded.length) {
    console.log('peak\\N  ' + NS.map(n => String(n).padStart(9)).join(''));
    for (const ap of ARM_PEAKS)
      console.log(String(ap).padEnd(7) + NS.map(n => faded.reduce((s, r) => s + r.arms[key(ap, n)].delta, 0).toFixed(4).padStart(9)).join(''));
  }

  // 基准臂：全部 fires 的触发时刻 profitPct vs 终局（中位）
  for (const ap of [ARM_PEAKS.includes(20) ? 20 : ARM_PEAKS[0]]) {
    for (const n of [NS.includes(120) ? 120 : NS[Math.floor(NS.length / 2)]]) {
      const allFires = results.flatMap(r => r.arms[key(ap, n)].detail.map(f => ({ ...f, sym: r.symbol || r.token.slice(0, 8), finalPct: r.finalPct })));
      if (allFires.length) {
        const sorted = [...allFires].sort((a, b) => a.profitPct - b.profitPct);
        const med = arr => arr[Math.floor(arr.length / 2)];
        console.log(`\n═══ 基准组合 peak≥${ap}/N=${n}：fires=${allFires.length} 触发时刻 profitPct 中位=${med(sorted.map(f => f.profitPct)).toFixed(1)}% 对应票终局中位=${med([...allFires].sort((a, b) => a.finalPct - b.finalPct).map(f => f.finalPct)).toFixed(1)}% ═══`);
      }
    }
  }

  // 明细
  for (const ap of ARM_PEAKS.slice(0, 1)) {
    for (const n of NS.slice(0, 1)) {
      const withFire = results.filter(r => r.arms[key(ap, n)].fires > 0).sort((a, b) => b.arms[key(ap, n)].delta - a.arms[key(ap, n)].delta);
      console.log(`\n═══ 明细 peak≥${ap}/N=${n}（触发 ${withFire.length} 票）按 Δ 降序 ═══`);
      for (const r of withFire.slice(0, 12))
        console.log(`  ${r.expId} ${r.symbol || r.token.slice(0, 10)} 卡=${r.nCards} fires=${r.arms[key(ap, n)].fires} Δ=${r.arms[key(ap, n)].delta} 峰=${r.actualPeakPct}% 终=${r.finalPct}% ${r.open ? 'OPEN' : ''} first=${JSON.stringify(r.arms[key(ap, n)].detail[0])}`);
      if (withFire.length > 12) {
        console.log(`  …尾部（Δ 最差）:`);
        for (const r of withFire.slice(-6))
          console.log(`  ${r.expId} ${r.symbol || r.token.slice(0, 10)} 卡=${r.nCards} fires=${r.arms[key(ap, n)].fires} Δ=${r.arms[key(ap, n)].delta} 峰=${r.actualPeakPct}% 终=${r.finalPct}% ${r.open ? 'OPEN' : ''}`);
      }
    }
  }

  require('fs').writeFileSync(__dirname + '/tmp-since-high-result.json', JSON.stringify(results, null, 1));
  console.log('\n明细已写 ' + __dirname + '/tmp-since-high-result.json');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
