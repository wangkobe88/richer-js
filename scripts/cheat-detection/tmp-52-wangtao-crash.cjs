// 一次性（182 跑）：idx 52 王涛（0x1cf8…ffff）v100 用户裁定「也属于 crash」取证——
//   cheat 硬拒票（A强:pump+D_famous+J_hold+R_abn+N_no_retail_entry）无 BP 分析行/无 anchors，
//   按 v100 首信号锚 2026-11-05T07:30:36Z 重算 crash 锚族（纯数值零 Jev）：
//   chg5/chg10/chg30、curVsAth、secSinceAth、nearMaxDn5、curVsMinGap、minVs/curVs launch。
const { dbManager } = require('../../src/services/dbManager.js');

const V100 = '11fc182a-b051-4665-857c-5c14e6713334';
const T = '0x1cf8569749438a7bea491438383698040207ffff';
const ANCHOR = Date.parse('2026-11-05T07:30:36Z');
const FM = 4496173469e-18;
const FL = 5.546e-9;

async function main() {
  const sb = await dbManager.getClient();
  // platform：v100 experiment_tokens 优先，回退 token_create 事件
  let platform = null;
  const { data: et } = await sb.from('experiment_tokens').select('platform').eq('experiment_id', V100).eq('token_address', T).limit(1);
  if (et && et.length) platform = et[0].platform;
  if (!platform) {
    const { data: ev } = await sb.from('wss_events').select('platform').eq('kind', 'token_create').eq('token_address', T).limit(1);
    platform = (ev && ev[0] && ev[0].platform) || 'fourmeme';
  }
  console.log('platform =', platform);

  const rows = [];
  let fromId = 0;
  for (;;) {
    const { data, error } = await sb.from('wss_price_ticks')
      .select('id,block_time,trade_type,bnb_amount,price_bnb,price_outlier')
      .eq('token_address', T).gt('id', fromId).order('id', { ascending: true }).limit(1000);
    if (error) throw error;
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
    fromId = data[data.length - 1].id;
  }
  console.log('全史 ticks:', rows.length, rows.length ? `${rows[0].block_time.slice(5, 19)} → ${rows[rows.length - 1].block_time.slice(5, 19)}` : '');

  const rel = rows.filter((r) => r.price_bnb > 0 && !r.price_outlier); // 可靠价序列
  let firstBuy = null;
  for (const r of rows) if (r.trade_type === 'buy' && r.price_bnb > 0) { firstBuy = r.price_bnb; break; }
  const launchConst = platform === 'flap' ? FL : FM;
  const launch = Math.min(launchConst, firstBuy || launchConst);
  console.log(`首买价=${firstBuy} launchConst=${launchConst.toExponential(4)} launch(min 口径)=${launch.toExponential(4)}`);

  // 锚 = block_time <= 锚时刻（宁多勿少对齐 anchorCountAt）
  const t = (r) => Date.parse(r.block_time);
  const win = rel.filter((r) => t(r) <= ANCHOR);
  const cur = win.length ? win[win.length - 1] : null;
  if (!cur) { console.log('锚前无可靠价，中止'); process.exit(1); }
  const anchorT = t(cur);
  const priceAt = (msAgo) => {
    const cutoff = anchorT - msAgo * 1000;
    let best = null;
    for (const r of win) if (t(r) <= cutoff) best = r; // cutoff 前最近一笔
    return best;
  };
  const pct = (a, b) => ((a / b) - 1) * 100;
  const p = cur.price_bnb;

  // ATH / MIN（全窗）
  let ath = null, min_ = null;
  for (const r of win) {
    if (!ath || r.price_bnb > ath.price_bnb) ath = r;
    if (!min_ || r.price_bnb < min_.price_bnb) min_ = r;
  }
  // 临近段 120s：5s 段最深跌幅（段收盘环比近似口径）
  const near = win.filter((r) => t(r) >= anchorT - 120000);
  const buckets = new Map();
  for (const r of near) {
    const k = Math.floor((t(r) - (anchorT - 120000)) / 5000);
    if (!buckets.has(k)) buckets.set(k, r);
    buckets.set(k, r); // 段内最后一笔=段收盘
  }
  const seq = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  let maxDn5 = null;
  for (let i = 1; i < seq.length; i++) {
    const dn = pct(seq[i].price_bnb, seq[i - 1].price_bnb);
    if (maxDn5 === null || dn < maxDn5) maxDn5 = dn;
  }

  const r5 = priceAt(5), r10 = priceAt(10), r30 = priceAt(30);
  console.log('\n===== crash 锚族（锚=' + new Date(ANCHOR).toISOString().slice(11, 19) + 'Z 窗内末笔 ' + cur.block_time.slice(11, 19) + '） =====');
  console.log(`chg5Pct   = ${r5 ? pct(p, r5.price_bnb).toFixed(2) : 'null(短窗无更早价→自全窗首价 ' + pct(p, win[0].price_bnb).toFixed(2) + ')'}`);
  console.log(`chg10Pct  = ${r10 ? pct(p, r10.price_bnb).toFixed(2) : 'null'}`);
  console.log(`chg30Pct  = ${r30 ? pct(p, r30.price_bnb).toFixed(2) : 'null'}`);
  console.log(`curVsAthPct = ${pct(p, ath.price_bnb).toFixed(2)}（ATH ${ath.price_bnb.toExponential(4)} @ ${ath.block_time.slice(11, 19)}，secSinceAth=${((anchorT - t(ath)) / 1000).toFixed(0)}s）`);
  console.log(`nearMaxDn5Pct（120s 段收盘环最深）= ${maxDn5 !== null ? maxDn5.toFixed(2) : 'null'}`);
  console.log(`curVsMinGapPct = ${pct(p, min_.price_bnb).toFixed(2)}（MIN ${min_.price_bnb.toExponential(4)} @ ${min_.block_time.slice(11, 19)}）`);
  console.log(`minVsLaunchPct = ${pct(min_.price_bnb, launch).toFixed(2)} | curVsLaunchPct = ${pct(p, launch).toFixed(2)}`);
  console.log(`窗可靠价笔数=${win.length} 全窗 span=${((anchorT - t(win[0])) / 1000).toFixed(0)}s`);

  console.log('\n===== 锚前最后 12 笔（全部行含 outlier 标记） =====');
  const tailAll = rows.filter((r) => t(r) <= ANCHOR).slice(-12);
  for (const r of tailAll) {
    console.log(`  ${r.block_time.slice(11, 19)} ${r.trade_type.padEnd(4)} bnb=${(r.bnb_amount || 0).toFixed(4)} px=${r.price_bnb > 0 ? r.price_bnb.toExponential(4) : '-'}${r.price_outlier ? ' [outlier]' : ''} curVsLaunch=${r.price_bnb > 0 && !r.price_outlier ? pct(r.price_bnb, launch).toFixed(1) + '%' : '-'}`);
  }

  // BP59 急跌三特征对照
  const chg5 = r5 ? pct(p, r5.price_bnb) : null;
  const chg10 = r10 ? pct(p, r10.price_bnb) : null;
  console.log('\n===== BP59 急跌进行时三特征 =====');
  console.log(`① chg5 深负（≤-10 参考线）: ${chg5 !== null ? chg5.toFixed(2) : 'null'}`);
  console.log(`② chg5≈chg10 同深无铺垫（|chg5-chg10|<3pp）: ${chg5 !== null && chg10 !== null ? Math.abs(chg5 - chg10).toFixed(2) + 'pp' : 'n/a'}`);
  console.log(`③ secSinceAth 极小（刚见顶）: ${((anchorT - t(ath)) / 1000).toFixed(0)}s`);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
