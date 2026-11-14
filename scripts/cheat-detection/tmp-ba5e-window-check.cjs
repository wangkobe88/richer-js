// 一次性（182 跑）：ba5e 创建时间 vs v100 回测窗口 + ticks 存在性（id 探针窗防大表吞）。
const { dbManager } = require('../../src/services/dbManager.js');
const V100 = 'ed113d10-8d0b-495d-b1f1-9b597f564c21';
const T = '0xba5ed45b42479e0a75316de7bf990ec90a3e4444';
async function main() {
  const sb = await dbManager.getClient();
  // 1) token_create 时间（wss_events 小表可直接查）
  const { data: ev } = await sb.from('wss_events').select('block_time,payload')
    .eq('kind','token_create').eq('token_address', T).limit(1);
  const created = ev && ev[0] && ev.block_time || ev[0].block_time;
  console.log(`token_create: ${created} platform=${(ev&&ev[0]&&ev[0].payload||{}).platform||'?'}`);
  // 2) v100 实验窗口
  const { data: exp } = await sb.from('experiments').select('name,status,config').eq('id', V100).limit(1);
  const e = exp && exp[0];
  if (e) {
    const bt = (e.config || {}).backtest || {};
    console.log(`v100: name=${e.name} status=${e.status} 窗口=${JSON.stringify({start: bt.startTime || bt.start, end: bt.endTime || bt.end, source: bt.sourceExperimentId || bt.sourceExperiment})}`);
  }
  // 3) ticks 存在性：id 探针窗（ba5e 创建在 11-08 附近，探大 id 段）
  // 先取全表 id 头尾参考：用 token_create 时间附近估 id——直接扫两个窗：全窗 like 不行，用 id 步进探针
  // 简法：取该票 token_create block_time 前后 10min 的全表 id 探针——不知道 id 就先取当前 max id 附近参考
  const { data: anyRow } = await sb.from('wss_price_ticks').select('id,block_time')
    .order('id', { ascending: false }).limit(1);
  const maxId = anyRow && anyRow[0] && anyRow[0].id;
  console.log(`ticks maxId=${maxId} (head=${anyRow[0].block_time})`);
  // 二分不搞了——直接用 block_time 窗口不行（无索引），用 id 折半探针找 11-08 07:30-08:00 的 id 带
  // ba5e 创建时间若在 11-08，估算 id 带；先打 token_create 时间再定
  const tMs = Date.parse(created);
  if (!isNaN(tMs)) {
    let lo = 1, hi = maxId;
    // 找第一个 block_time >= tMs 的 id（对数级探针，~20 次查询）
    for (let i = 0; i < 24 && lo < hi; i++) {
      const mid = Math.floor((lo + hi) / 2);
      const { data: r } = await sb.from('wss_price_ticks').select('id,block_time').eq('id', mid).limit(1);
      if (!r || !r[0]) { hi = mid; continue; }
      if (Date.parse(r[0].block_time) < tMs) lo = mid + 1; else hi = mid;
    }
    console.log(`起点探针 id≈${lo}（票创建时刻附近）`);
    // 拉该 id 起 3000 行窗，内存过滤 ba5e
    const { data: win } = await sb.from('wss_price_ticks')
      .select('id,block_time,trade_type,bnb_amount,price_bnb')
      .gt('id', lo - 1000).lt('id', lo + 200000).limit(3000).order('id', { ascending: true });
    const mine = (win || []).filter((r) => true); // 窗内全部行先看时间范围
    if (mine.length) console.log(`探针窗行 ${mine.length}：${mine[0].block_time.slice(5,19)} → ${mine[mine.length-1].block_time.slice(5,19)}`);
    // 这个窗可能不含 ba5e——需要宽扫。改：按 id 段 5 万步进全扫 token_address
    let total = 0, firstN = [];
    for (let base = lo - 5000; base < lo + 500000; base += 45000) {
      const { data: seg } = await sb.from('wss_price_ticks')
        .select('id,block_time,trade_type,bnb_amount,price_bnb,token_address')
        .gt('id', base).lt('id', base + 46000).limit(1000).order('id', { ascending: true });
      if (!seg || !seg.length) continue;
      const hits = seg.filter((r) => r.token_address === T);
      total += hits.length;
      if (hits.length) firstN = firstN.concat(hits.slice(0, 3));
      if (seg.length < 1000 && Date.parse(seg[seg.length-1].block_time) > tMs + 3600e3) break;
    }
    console.log(`宽扫 ba5e ticks 命中 ${total} 行（±10min 起步 50 万 id 带）`);
    firstN.slice(0,3).forEach((r)=>console.log(`  ${r.block_time.slice(5,19)} ${r.trade_type} ${Number(r.bnb_amount||0).toFixed(4)}B`));
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
