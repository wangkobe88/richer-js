// ab-sell-trailing-compare.cjs — 卖臂止盈「固定阈值」vs「trailing（峰值开门+回撤触发）」反事实对拍
// 用法（182 跑，本地 VPN 勿跑）：node scripts/ab-sell-trailing-compare.cjs <experiment_id>
// 方法论（T64 定稿）：
//   1. 样本=该实验全部 success 买入票；价格路径=wss_price_ticks 链上真序 (block_number,log_index)，price_outlier 行剔除
//   2. 锚=成交(executed_at)后首个 tick 市价（首 3 tick 中位数）——勿用 trades.unit_price：v36 记账量纲事故后该列域不可信
//      （自检列 uR=[tick.price_bnb/unit_price, tick.price_usd/unit_price]：≈1 的那维指示 unit_price 实际落库域）
//   3. 旧臂=profit>50 即卖；新臂=峰值>50 且回撤>10 OR 峰值>100 且回撤>7.5（回撤=价格域 (1-P现/P峰)×100；峰值=运行 max 只增不减）
//   4. 双口径：instant=触发 tick 即成交；+5t=触发后第 5 tick（对齐卖腿 3.5s+5tick 双门确认窗，两臂同尺才公平）
// 已知局限：全仓单点退出模型（不建模卡牌分腿）；n 小仅方向参考，勿据单样本调参
const { readFileSync } = require('fs');
const EXP = process.argv[2];
if (!EXP) { console.error('usage: node ab-sell-trailing-compare.cjs <experiment_id>'); process.exit(2); }
const env = readFileSync(require('path').join(__dirname, '..', 'config', '.env'), 'utf8');
const SUPA = (k) => { const m = env.match(new RegExp('^' + k + '=(.+)$', 'm')); if (!m) throw new Error('env miss ' + k); return m[1].trim(); };
const URL = SUPA('SUPABASE_URL'), KEY = SUPA('SUPABASE_SERVICE_KEY');
const WINDOW_H = 4, OLD_T1 = 50, ARM1 = 50, ARM2 = 100, DD1 = 10, DD2 = 7.5;
async function rest(path) {
  const r = await fetch(URL + '/rest/v1/' + path, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY }, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error('REST ' + r.status + ' ' + path.slice(0, 120) + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}
(async () => {
  const trades = await rest('trades?experiment_id=eq.' + EXP + '&select=token_symbol,token_address,trade_direction,trade_status,input_currency,unit_price,created_at,executed_at&order=created_at.asc');
  const buys = trades.filter(t => t.trade_direction === 'buy' && t.trade_status === 'success');
  console.log('BUYSET ' + buys.length + ' buys, anchor=tick@exec');
  const iso = d => new Date(d).toISOString();
  const out = [];
  for (const b of buys) {
    const t0 = Date.parse(b.executed_at || b.created_at);
    const line = { sym: b.token_symbol, addr: b.token_address.slice(0, 8) + '..' + b.token_address.slice(-4) };
    if (b.input_currency !== 'BNB') { line.SKIP = 'input_currency=' + b.input_currency; out.push(line); continue; }
    let rows = [], lb = -1, li = -1, trunc = false;
    try {
      for (let pg = 0; pg < 40; pg++) {
        const f = ['token_address=eq.' + b.token_address, 'block_time=gte.' + iso(t0 - 2000), 'block_time=lt.' + iso(t0 + WINDOW_H * 3600e3)];
        if (lb >= 0) f.push('or=(block_number.gt.' + lb + ',and(block_number.eq.' + lb + ',log_index.gt.' + li + '))');
        const c = await rest('wss_price_ticks?' + f.join('&') + '&select=price_bnb,price_usd,block_number,log_index,block_time,price_outlier,platform&order=block_number.asc,log_index.asc&limit=1000');
        rows.push(...c);
        if (c.length < 1000) break;
        lb = c[c.length - 1].block_number; li = c[c.length - 1].log_index;
        if (pg === 39) trunc = true;
      }
    } catch (e) { line.SKIP = 'fetch:' + e.message; out.push(line); continue; }
    const all = rows.filter(t => t.price_bnb > 0 && !t.price_outlier).sort((a, c) => a.block_number - c.block_number || a.log_index - c.log_index);
    const ticks = all.filter(t => Date.parse(t.block_time) >= t0);
    if (ticks.length === 0) { line.SKIP = 'noTicks'; out.push(line); continue; }
    const med = a => a.sort((x, y) => x - y)[a.length >> 1];
    const anchor = med(ticks.slice(0, 3).map(t => t.price_bnb));
    const prof = i => (ticks[i].price_bnb / anchor - 1) * 100;
    if (b.unit_price > 0) line.uR = [+(all[0].price_bnb / b.unit_price).toFixed(3), +(all[0].price_usd / b.unit_price).toFixed(3)];
    let peak = -1e9, peakP = 0, oldE = null, oldE5 = null, newE = null, delay = null, lastP = null;
    for (let i = 0; i < ticks.length; i++) {
      const p = ticks[i].price_bnb, pr = prof(i); lastP = pr;
      if (pr > peak) { peak = pr; peakP = p; }
      const dd = (1 - p / peakP) * 100;
      if (!oldE && pr > OLD_T1) oldE = { p: pr, d5: ticks[i + 5] !== undefined ? prof(i + 5) : null };
      if (!newE) {
        const a2 = peak > ARM2, a1 = peak > ARM1;
        if ((a2 && dd > DD2) || (a1 && dd > DD1)) {
          newE = { p: pr, arm: (a2 && dd > DD2) ? 2 : 1, dd: +dd.toFixed(1) };
          delay = ticks[i + 5] !== undefined ? prof(i + 5) : null;
        }
      }
      if (oldE && newE) break;
    }
    Object.assign(line, {
      peakPct: +peak.toFixed(1),
      oldE: oldE ? +oldE.p.toFixed(1) : null, oldE5t: oldE && oldE.d5 != null ? +oldE.d5.toFixed(1) : null,
      newE: newE ? +newE.p.toFixed(1) : null, arm: newE ? newE.arm : null, ddAtTrig: newE ? newE.dd : null,
      delayed5t: delay != null ? +delay.toFixed(1) : null, openAtEnd: lastP != null ? +lastP.toFixed(1) : null,
      nTicks: rows.length
    });
    if (trunc) line.trunc = true;
    out.push(line);
  }
  for (const r of out) console.log(JSON.stringify(r));
  const aff = out.filter(r => r.peakPct > OLD_T1);
  let sb = 0, sw = 0, sumO = 0, sumO5 = 0, sumN = 0, sumN5 = 0, cnt = 0;
  for (const r of aff) {
    if (r.newE == null || r.oldE == null) continue;
    cnt++; sumO += r.oldE; sumN += r.newE;
    if (r.oldE5t != null) sumO5 += r.oldE5t;
    if (r.delayed5t != null) sumN5 += r.delayed5t;
    if (r.newE > r.oldE) sb++; else if (r.newE < r.oldE) sw++;
  }
  console.log('SUMMARY ' + JSON.stringify({ affected: aff.length, cnt, better: sb, worse: sw,
    sumOld: +sumO.toFixed(1), sumOld5t: +sumO5.toFixed(1), sumNew: +sumN.toFixed(1), sumNew5t: +sumN5.toFixed(1),
    deltaInstant: +(sumN - sumO).toFixed(1), deltaBothDelayed: +(sumN5 - sumO5).toFixed(1) }));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
