// 一次性诊断（182 跑）：0x0ba52e…7777 生产首析 grade/act 档位 + 锚窗明细 + D3.59 新键 + 锚后走势
import { dbManager } from '/home/ubuntu/richer-js/src/services/dbManager.js';
import { buildSnapshotFromRows } from '/home/ubuntu/richer-js/src/market-analysis/cheat-snapshot.js';
import { anchorCountAt } from '/home/ubuntu/richer-js/scripts/cheat-detection/lib.mjs';

const TICK_COLS = 'block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';
async function pullTicksToAnchor(c, token, n) {
  const { data, error } = await c.from('wss_price_ticks')
    .select(TICK_COLS).eq('token_address', token)
    .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(n);
  if (error) throw new Error(error.message);
  return data ?? [];
}
async function loadTokenMeta(c, token) {
  const { data } = await c.from('wss_events')
    .select('payload,block_time').eq('kind', 'token_create').eq('token_address', token)
    .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(1);
  const p = data?.[0]?.payload ?? {};
  return { address: token, symbol: p.symbol ?? null, name: p.name ?? null, platform: p.platform ?? null, createdAt: data?.[0]?.block_time ?? null, creatorAddress: p.creatorAddress ?? null, totalSupply: p.totalSupply ?? null };
}
const quoteTokenOf = (rows) => rows.find((r) => r.quote_token)?.quote_token ?? null;

const ADDR = '0x0ba52e4445273668d1095dde970b79fd43ae7777';
const EXP = '936e1bd9-630a-4f91-bb52-3f4afb1a27f4';
const ms = (iso) => new Date(iso).getTime();
const isBuy = (t) => /buy/i.test(t || '');

(async () => {
  const c = await dbManager.getClient();

  // 1) cheat_detection 全行
  const { data: cd, error: cdErr } = await c.from('cheat_detection')
    .select('id,anchor_tick_count,analyzed_at,question_version,verdict,source_experiment_id,snapshot_digest')
    .eq('token_address', ADDR).order('id', { ascending: true }).limit(5);
  if (cdErr) console.log('!! cheat_detection 查询 ERR:', cdErr.message);
  if (!cd?.length) { console.log('!! cheat_detection 零行（门未触发/未过前置门）'); }
  for (const r of cd ?? []) {
    const d = typeof r.snapshot_digest === 'string' ? JSON.parse(r.snapshot_digest) : r.snapshot_digest;
    console.log(`\n== cd#${r.id} qv=${r.question_version} anchor=${r.anchor_tick_count} grade=${d.grade} at=${r.analyzed_at} exp=${r.source_experiment_id}`);
    console.log('   reasons:', JSON.stringify(d.gradeReasons));
    console.log('   levels:', JSON.stringify(d.levels));
    console.log('   activity:', JSON.stringify(d.activity));
    console.log('   nearSeg:', JSON.stringify({ n: d.activity?.nearSegTickN, tpm: d.activity?.nearSegTicksPerMin, med: d.activity?.nearSegBuyMedianBnb, perMin: d.activity?.nearSegBnbPerMin, gap: d.activity?.nearSegMaxGapSec, buy: d.activity?.nearSegBuyN, sell: d.activity?.nearSegSellN }));
  }
  // 1b) cheat_detection 全表健康度（最近 3 行）
  const { data: cdTail, error: cdTailErr } = await c.from('cheat_detection')
    .select('id,token_address,anchor_tick_count,analyzed_at,question_version,verdict')
    .order('id', { ascending: false }).limit(3);
  console.log(`\ncheat_detection 表尾 3 行: ${cdTailErr ? 'ERR ' + cdTailErr.message : JSON.stringify(cdTail)}`);

  // 2) 全量行（链上真序）+ 首笔 BUY 成交/信号 → cd 零行时用信号/成交时刻定锚（settle 4s 语义）
  const allRows = await pullTicksToAnchor(c, ADDR, 3000);
  const { data: sigPre } = await c.from('strategy_signals')
    .select('id,signal_type,created_at').eq('experiment_id', EXP).eq('token_address', ADDR)
    .order('created_at', { ascending: true }).limit(10);
  const firstBuySig = (sigPre ?? []).find((s) => s.signal_type === 'BUY');
  let anchorN = cd?.[0]?.anchor_tick_count ?? 0;
  let anchorSrc = 'cd';
  if (!anchorN && firstBuySig?.created_at) {
    const tAnchor = new Date(Date.parse(firstBuySig.created_at) + 4000).toISOString();
    anchorN = anchorCountAt(allRows, tAnchor);
    anchorSrc = `signal@${firstBuySig.created_at}+4s`;
  }
  if (!anchorN) { anchorN = 40; anchorSrc = 'fallback'; }
  console.log(`\n锚 = ${anchorN} 笔（来源 ${anchorSrc}，全量 ${allRows.length} 行）`);

  // 3) 锚窗明细
  const rows = allRows.slice(0, anchorN);
  const t0 = ms(rows[0].block_time);
  let buyN = 0, sellN = 0, buyBnb = 0, sellBnb = 0;
  console.log(`\n== 锚窗 ${rows.length} 笔明细 ==`);
  for (const r2 of rows) {
    if (isBuy(r2.trade_type)) { buyN++; buyBnb += r2.bnb_amount || 0; } else { sellN++; sellBnb += r2.bnb_amount || 0; }
    const p = (typeof r2.price_bnb === 'number' && !r2.price_outlier) ? r2.price_bnb.toPrecision(3) : (r2.price_outlier ? 'OUTLIER' : 'null');
    console.log(`  t+${String(Math.round((ms(r2.block_time) - t0) / 1000)).padStart(4)}s blk=${r2.block_number} ${isBuy(r2.trade_type) ? 'BUY ' : 'SELL'} ${String(r2.bnb_amount).padStart(9)} p=${p}`);
  }
  console.log(`  买卖笔比 ${buyN}:${sellN}  额比 ${buyBnb.toFixed(3)}:${sellBnb.toFixed(3)}`);

  // 3) D3.59 新键（182 仓库已是 D3.59 代码）
  const meta = { ...(await loadTokenMeta(c, ADDR)), quoteToken: quoteTokenOf(rows) };
  const d59 = buildSnapshotFromRows(rows, meta, { anchorTickCount: anchorN }).derived;
  console.log('\n== D3.59 新键（同锚重算）==');
  console.log(`  全窗: span=${d59.spanSec}s ticks=${d59.tickCount} tpm=${d59.ticksPerMin} 笔均=${d59.avgTradeBnb} maxGap=${d59.maxGapSec}s idlePct=${d59.idlePct}% buyMed=${d59.buyMedianBnb} thr=${d59.throughputBnbPerMin} maxDD=${d59.maxDrawdownPct}%`);
  console.log(`  临近段: n=${d59.nearSegTickN} tpm=${d59.nearSegTicksPerMin} med=${d59.nearSegBuyMedianBnb} perMin=${d59.nearSegBnbPerMin} maxGap=${d59.nearSegMaxGapSec}s buy/sell=${d59.nearSegBuyN}/${d59.nearSegSellN}`);
  console.log(`  act(代码)=${d59.activityLevel}${d59.activityUneven ? '~起伏' : ''} cv=${d59.activityCv}`);
  console.log(`  pump: stable{pts=${d59.pumpStablePoints} span=${d59.pumpStableSpanSec}s r2=${d59.pumpStableR2} slope=${d59.pumpStableSlopePctPerMin}%} risePerBuy=${d59.pumpRisePerBuyBnb} sellTickPct=${d59.pumpSellTickCountPct}`);
  console.log(`  burst: maxGap=${d59.burstMaxGapSec}s wave{bnb=${d59.burstWaveBuyBnb} wallets=${d59.burstWaveWallets}} noBuySellPct=${d59.noBuySellPct} t2hs=${d59.top2HoldSupplyPct} top1t2=${d59.top1Top2HoldSupplyPct}`);

  // 4) 锚后走势（锚末价 vs 其后 30min 可靠价低点/末价）
  const anchorEnd = ms(rows[rows.length - 1].block_time);
  const rel = allRows.slice(anchorN, anchorN + 401).filter((r3) => typeof r3.price_bnb === 'number' && !r3.price_outlier);
  if (rel.length) {
    const lastAnchor = rows.filter((r4) => typeof r4.price_bnb === 'number' && !r4.price_outlier).at(-1)?.price_bnb;
    let lo = rel[0].price_bnb, hi = rel[0].price_bnb;
    for (const p of rel) { lo = Math.min(lo, p.price_bnb); hi = Math.max(hi, p.price_bnb); }
    const dtMin = Math.round((ms(rel[rel.length - 1].block_time) - anchorEnd) / 60000);
    console.log(`\n== 锚后 ${rel.length} 可靠价（约 ${dtMin} 分钟）：锚末 ${lastAnchor?.toPrecision(3)} → 低 ${(lo).toPrecision(3)}（${((lo / lastAnchor - 1) * 100).toFixed(1)}%）→ 末 ${(rel[rel.length - 1].price_bnb).toPrecision(3)}（${((rel[rel.length - 1].price_bnb / lastAnchor - 1) * 100).toFixed(1)}%）`);
  }

  // 5) 信号与成交
  const { data: sigs } = await c.from('strategy_signals')
    .select('id,signal_type,action,reason,created_at,metadata')
    .eq('experiment_id', EXP)
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true }).limit(10);
  for (const s of sigs ?? []) {
    const md = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : (s.metadata ?? {});
    const cc = md.cheatCheck;
    console.log(`\n== signal ${s.signal_type} ${s.created_at} reason=${String(s.reason).slice(0, 60)}`);
    if (cc) console.log('   cheatCheck:', JSON.stringify(cc).slice(0, 800));
  }
  const { data: trades, error: trErr2 } = await c.from('trades')
    .select('trade_direction,trade_status,success,input_currency,input_amount,output_currency,output_amount,unit_price,created_at,metadata')
    .eq('experiment_id', EXP)
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true }).limit(10);
  if (trErr2) console.log('   trades 查询 ERR:', trErr2.message);
  for (const t of trades ?? []) {
    const md = typeof t.metadata === 'string' ? JSON.parse(t.metadata) : (t.metadata ?? {});
    console.log(`   trade ${t.trade_direction} ${t.input_currency}→${t.output_currency} in=${t.input_amount} out=${t.output_amount} unit=${t.unit_price} ok=${t.success} profit=${md?.profitPercent ?? md?.profit_percent ?? ''} at ${t.created_at}`);
  }

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
