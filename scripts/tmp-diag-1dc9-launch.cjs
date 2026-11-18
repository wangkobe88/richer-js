// 一次性诊断：bt-v140 票 0x1dc9…7777 首买 3 钱包捆绑未被 launchFirstBlockWallets 等键捕捉归因
const { dbManager } = require('../src/services/dbManager.js');

const ADDR = process.argv[2] || '0x1dc9122695e298ad3cfd2445e127ca8358e47777';
const EXP = '6e75ed6d-807a-4164-9551-d3b95d1fc37b'; // bt-v140

const ms = (iso) => new Date(iso).getTime();
const fmtT = (iso) => (iso ? new Date(iso).toISOString().slice(12, 19) : '-');
const sh = (a) => (a ? a.slice(0, 8) : 'NULL');

// 递归找 metadata 里所有 launch* / gate 相关键值
function findKeys(obj, pred, path = '', out = []) {
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const p = path ? `${path}.${k}` : k;
      if (pred(k)) out.push([p, v]);
      if (v && typeof v === 'object') findKeys(v, pred, p, out);
    }
  }
  return out;
}

(async () => {
  const c = await dbManager.getClient();

  // 1) 实验行确认
  const { data: exp } = await c.from('experiments')
    .select('id,experiment_name,trading_mode,status').eq('id', EXP).limit(1);
  console.log(`实验: ${exp[0].experiment_name} mode=${exp[0].trading_mode} status=${exp[0].status}`);

  // 2) token_create（kind 不过滤先看全部）
  const { data: ev } = await c.from('wss_events')
    .select('block_time,block_number,kind').eq('token_address', ADDR).limit(5);
  const tc = (ev || []).find((e) => e.kind === 'token_create');
  const tCreate = tc ? ms(tc.block_time) : null;
  console.log(`wss_events kinds: ${(ev || []).map((e) => e.kind).join(',')} ${tc ? tc.block_time + ' blk=' + tc.block_number : ''}`);

  // 3) 该实验该 token 信号行
  const { data: sigs, error: se } = await c.from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP).eq('token_address', ADDR)
    .order('id', { ascending: true }).limit(30);
  if (se) throw new Error('signals: ' + se.message);
  console.log(`\n== bt-v140 信号行 ${sigs.length} 条 ==`);
  let fireAt = null;
  for (const s of sigs) {
    const m = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : (s.metadata || {});
    const launch = findKeys(m, (k) => /^launch|^tokenAgeSec$|^sinceFirstTradeSec$|^tradeCount$|^currentVsLaunchPct$/.test(k));
    console.log(`sig#${s.id} ${s.signal_type} ${s.action} @${s.created_at} reason=${(s.reason || '').slice(0, 80)}`);
    for (const [p, v] of launch) console.log(`    ${p} = ${v}`);
    if (m.signalGate) console.log(`    signalGate=${J(m.signalGate)}`);
    if (m.factorCheck) console.log(`    factorCheck.code=${m.factorCheck.code || m.factorCheck.reason}`);
    if (m.cheatCheck) console.log(`    cheat=${m.cheatCheck.grade} ${J(m.cheatCheck.reasons || []).slice(0, 100)}`);
    if (m.buyPoint) console.log(`    bp=${m.buyPoint.bucket || m.buyPoint.status}`);
    if (s.signal_type === 'BUY' && !fireAt) fireAt = ms(s.created_at);
  }
  function J(x) { return JSON.stringify(x); }

  // 4) 成交
  const { data: tr } = await c.from('trades')
    .select('trade_direction,input_amount,output_amount,executed_at,success')
    .eq('experiment_id', EXP).eq('token_address', ADDR).eq('success', true)
    .order('executed_at', { ascending: true }).limit(20);
  console.log(`\n成交 ${tr.length} 笔:`);
  for (const t of tr) console.log(`  ${t.executed_at} ${t.trade_direction} in=${t.input_amount} out=${t.output_amount}`);

  // 5) 早期 ticks（链上真序）
  const { data: ticks, error: te } = await c.from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,sender_address,trader_address')
    .eq('token_address', ADDR)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(120);
  if (te) throw new Error('ticks: ' + te.message);
  const t0 = ms(ticks[0].block_time);
  console.log(`\n== 早期 ticks ${ticks.length} 行（首行=${ticks[0].block_time} blk=${ticks[0].block_number}；tCreate−t0=${tCreate ? ((t0 - tCreate) / 1000).toFixed(1) + 's' : '?'}) ==`);
  const fireEnd = fireAt || (t0 + 120000);
  console.log('blk:li  t+(s)  B/S  bnb      sender        trader       outlier');
  for (const t of ticks) {
    if (ms(t.block_time) > fireEnd + 30000) break;
    console.log(`${t.block_number}:${t.log_index}  t+${((ms(t.block_time) - t0) / 1000).toFixed(1).padStart(6)}  ${t.trade_type === 'buy' ? 'B' : 'S'}  ${Number(t.bnb_amount).toFixed(4).padStart(8)}  ${sh(t.sender_address)}  ${sh(t.trader_address)}  ${t.price_outlier ? 'OUT' : ''}`);
  }

  // 6) 复算：首块/首两波/簇（FA 口径——wallet=sender||trader；首买=钱包首笔 buy）
  const firstBlock = Number(ticks[0].block_number);
  const walletFirstBuy = new Map(); // w -> {blk, ts, bnb}
  const blkFirstTs = new Map();
  const netBnb = new Map(); // fire 时刻净买入 BNB（价值域近似 T150 站立判据）
  const buyBnbPerBlk = new Map();
  let n = 0;
  for (const t of ticks) {
    const ts = ms(t.block_time);
    if (ts > fireEnd) break;
    n++;
    const blk = Number(t.block_number);
    if (!blkFirstTs.has(blk)) blkFirstTs.set(blk, ts);
    const w = t.sender_address || t.trader_address;
    const isBuy = t.trade_type === 'buy';
    const bnb = Number(t.bnb_amount);
    if (w) {
      if (!netBnb.has(w)) netBnb.set(w, 0);
      netBnb.set(w, netBnb.get(w) + (isBuy ? bnb : -bnb));
      if (isBuy && !walletFirstBuy.has(w)) walletFirstBuy.set(w, { blk, ts, bnb });
      if (isBuy) buyBnbPerBlk.set(blk, (buyBnbPerBlk.get(blk) || 0) + bnb);
    }
  }
  console.log(`\n== FA 口径复算（截至 fire+30s，行数=${n}）==`);
  console.log(`firstBlockNumber(首 tick 块) = ${firstBlock}（首行 trade_type=${ticks[0].trade_type}）`);
  const fbTs = blkFirstTs.get(firstBlock);
  let f0raw = 0, f0stand = 0, waveRaw = 0, waveStand = 0;
  const byBlk = new Map();
  for (const [w, e] of walletFirstBuy) {
    const arr = byBlk.get(e.blk) || [];
    arr.push(w);
    byBlk.set(e.blk, arr);
    const standing = (netBnb.get(w) || 0) > 0.015; // 价值域近似尘线（T98=0.015 BNB）
    if (e.blk === firstBlock) { f0raw++; if (standing) f0stand++; }
    if (e.blk > firstBlock && blkFirstTs.get(e.blk) - fbTs <= 2000) { waveRaw++; if (standing) waveStand++; }
  }
  let bestClu = 0, bestCluBlk = null;
  for (const [blk, ws] of byBlk) {
    const stand = ws.filter((w) => (netBnb.get(w) || 0) > 0.015);
    if (stand.length > bestClu) { bestClu = stand.length; bestCluBlk = blk; }
    console.log(`  块 ${blk} 首买钱包 ${ws.length} 个（站立 ${stand.length}）: ${ws.map((w) => `${sh(w)}(net${(netBnb.get(w) || 0).toFixed(3)})`).join(' ')}`);
  }
  console.log(`\n复算结果: f0 raw=${f0raw} standing=${f0stand} | wave raw=${waveRaw} standing=${waveStand} (f0+wave站=${f0stand + waveStand}) | clu(站立最大同块)=${bestClu}@blk${bestCluBlk}`);
  console.log(`首块后各块首行 ts 差: ${[...blkFirstTs.entries()].filter(([b]) => b > firstBlock).slice(0, 6).map(([b, ts]) => `blk${b} +${((ts - fbTs) / 1000).toFixed(2)}s`).join(' ')}`);
  process.exit(0);
})();
