// 一次性取证（182 跑）：D3.65 波结构定向——ba5e/ad80 锚前【全量行】（分页绕过
// PostgREST 1000 帽）最密 5s 波 Top3（dt 段/Σ买/钱包数/波内首个可靠价 vs launch
// 地板）+ 生产 1000 帽窗对照。判定 startVs 语义（窗首价 vs 波起点价）与 1000 帽影响。
const { dbManager } = require('../../src/services/dbManager.js');

const FM_LAUNCH = 4496173469e-18;
const TARGETS = [
  ['ba5e', '0xba5ed45b42479e0a75316de7bf990ec90a3e4444', '2026-11-05T07:52:18'],
  ['ad80', '0xad80fb7a03686a9a12952efa17312cf10e86ffff', '2026-11-05T07:28:50'],
];
const COLS = 'block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,price_outlier';

async function pullAll(token, anchorIso) {
  const all = [];
  // 分页锚=链上真序 (block_number,log_index) 复合游标：按块号粗分页（每页 1000 行 id 探针窗形状）
  let lastBlock = -1, lastLog = -1;
  for (let i = 0; i < 10; i++) {
    let q = dbManager.getClient().from('wss_price_ticks').select(COLS).eq('token_address', token)
      .lte('block_time', anchorIso);
    if (lastBlock >= 0) q = q.or(`block_number.gt.${lastBlock},and(block_number.eq.${lastBlock},log_index.gt.${lastLog})`);
    const { data, error } = await q
      .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(1000);
    if (error) throw new Error(error.message);
    const rows = data || [];
    all.push(...rows);
    if (rows.length < 1000) break;
    const last = rows[rows.length - 1];
    lastBlock = last.block_number; lastLog = last.log_index;
  }
  return all;
}

function topWaves(rows, topN) {
  const t0 = new Date(rows[0].block_time).getTime();
  const rr = rows.map((x) => ({
    dt: (new Date(x.block_time).getTime() - t0) / 1000,
    buy: x.trade_type === 'buy', bnb: Number(x.bnb_amount || 0), p: x.price_bnb,
    rel: x.price_bnb > 0 && !/outlier/i.test(String(x.price_outlier || '')),
  }));
  // 窗起点索引枚举（每 tick 作为窗头，5s 窗内 Σ买/钱包/笔数）——与 snapshot 双指针同口径
  const waves = [];
  for (let i = 0; i < rr.length; i++) {
    let n = 0, buy = 0; const w = new Set();
    for (let j = i; j < rr.length && rr[j].dt - rr[i].dt <= 5; j++) {
      n++; if (rr[j].buy) buy += rr[j].bnb;
      w.add(j); // 占位（钱包序）——wallet 计数在下面用行序近似
    }
    // 独立钱包：行序连续段近似不可靠，改用 sender/trader——这里 rows 无 sender 列，
    // 输出笔数与 Σ买为主，钱包数由 snapshot 口径另行验证（本探针目的=波位置与起点价）
    waves.push({ from: rr[i].dt, to: rr[i].dt + 5, n, buy });
  }
  waves.sort((a, b) => b.n - a.n);
  return { rr, waves: waves.slice(0, topN) };
}

(async () => {
  for (const [tag, addr, anchorIso] of TARGETS) {
    const rows = await pullAll(addr, anchorIso);
    console.log(`\n== ${tag} 全量行=${rows.length}（${rows[0].block_time.slice(5, 19)} → ${rows[rows.length - 1].block_time.slice(5, 19)}，锚=${anchorIso.slice(5)}）`);
    const firstBuy = rows.find((x) => x.trade_type === 'buy' && x.price_bnb > 0);
    const launch = Math.min(FM_LAUNCH, (firstBuy && firstBuy.price_bnb) || FM_LAUNCH);
    const firstRel = rows.find((x) => x.price_bnb > 0 && !/outlier/i.test(String(x.price_outlier || '')));
    console.log(`launch 地板=${launch.toExponential(3)}（首买价=${firstBuy ? firstBuy.price_bnb.toExponential(3) : '-'}）| 全窗首可靠价=${firstRel.price_bnb.toExponential(3)} → 窗首 startVs=${((firstRel.price_bnb / launch - 1) * 100).toFixed(1)}%`);
    const { rr, waves } = topWaves(rows, 3);
    for (const w of waves) {
      const seg = rr.filter((r) => r.dt >= w.from - 0.01 && r.dt <= w.from + 5.01);
      const segFirst = seg.find((r) => r.rel);
      console.log(`  波 dt=[${w.from.toFixed(1)}, ${w.from + 5}]s 笔数=${w.n} Σ买=${w.buy.toFixed(4)}B 波内首可靠价=${segFirst ? segFirst.p.toExponential(3) : '-'} → 波起点 startVs=${segFirst ? ((segFirst.p / launch - 1) * 100).toFixed(1) : '-'}%`);
    }
    // 尾 1000 行（生产 1000 帽窗）对照
    if (rows.length > 1000) {
      const tail = rows.slice(-1000);
      const { rr: rrT, waves: wT } = topWaves(tail, 2);
      const tFirst = rrT.find((r) => r.rel);
      console.log(`  [生产 1000 帽窗对照] 首行 dt=${rrT[0].dt.toFixed(1)}s 窗首 startVs=${tFirst ? ((tFirst.p / launch - 1) * 100).toFixed(1) : '-'}%`);
      for (const w of wT) {
        const seg = rrT.filter((r) => r.dt >= w.from - 0.01 && r.dt <= w.from + 5.01);
        const segFirst = seg.find((r) => r.rel);
        console.log(`  [帽窗] 波 dt=[${w.from.toFixed(1)}, ${w.from + 5}]s 笔数=${w.n} Σ买=${w.buy.toFixed(4)}B 波起点=${segFirst ? ((segFirst.p / launch - 1) * 100).toFixed(1) : '-'}%`);
      }
      // 首 300 行（head 补窗形状）
      const head = rows.slice(0, 300);
      const hFirst = head.find((x) => x.price_bnb > 0 && !/outlier/i.test(String(x.price_outlier || '')));
      if (hFirst) console.log(`  [head300 对照] head 末行 block_time=${head[head.length - 1].block_time.slice(5, 19)} head 首可靠价 startVs=${((hFirst.price_bnb / launch - 1) * 100).toFixed(1)}%`);
    }
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.stack || e); process.exit(1); });
