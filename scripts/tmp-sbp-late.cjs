// 一次性（182 跑）：强庄研究·晚锚验证——「数值阈值收紧命中掉到 4/10 是否只是推迟命中」
// 口径：每票拉全量 ticks（id 探针窗分页+内存 filter，红线同 tmp-sbp-forward）→ 内存按链上真序
// (block_number,log_index) 排序 → 截点 锚/+50/+150/+400/+800/全窗 → buildSnapshotFromRows 纯函数
// （零 Jev）→ 逐截点落关键锚。只回答：累积锚随截点单调性 + 阈值命中曲线。
const { dbManager } = require('../src/services/dbManager.js');
const fs = require('fs');
const { buildSnapshotFromRows } = require('../src/market-analysis/cheat-snapshot.js');
const FIX = require('./cheat-detection/fixtures.json');

const STRONG = ['CD21','CD23','CD41','CD45','CD60','CD73','CD98','CD127','CD191','CD223'];
const TICK_COLS = 'id,block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';
const WIN = 30000;   // id 探针窗宽
const MAX_WIN = 5;   // 最多 5 窗（15 万 id 跨度）
const CAP = 3000;    // 与 pullFull 同帽

async function fetchTokenAll(c, addr) {
  const { data: probe } = await c.from('wss_price_ticks').select('id').eq('token_address', addr).order('id', { ascending: true }).limit(1);
  if (!probe || !probe.length) return null;
  const firstId = probe[0].id;
  const out = [];
  for (let w = 0; w < MAX_WIN; w++) {
    const lo = firstId + w * WIN, hi = firstId + (w + 1) * WIN;
    const { data: rows, error } = await c.from('wss_price_ticks')
      .select(TICK_COLS).gt('id', lo - 1).lt('id', hi)
      .eq('token_address', addr).order('id', { ascending: true }).limit(CAP + 1);
    if (error) throw new Error(error.message);
    if (!rows || !rows.length) break;
    out.push(...rows);
    if (out.length > CAP) break;
    if (rows.length < CAP + 1 && hi - lo >= WIN) break; // 窗耗尽
  }
  return out.slice(0, CAP + 1);
}

const PICK = [
  'top2HoldSupplyPct','top1Top2HoldSupplyPct','top1Top2FirstBuyGapSec','clusterHoldSupplyPct','t1PlusClusterSupplyPct',
  'top1HoldSupplyPct','top1HoldCircPct',
  'burstWaveBuyBnb','burstWaveWallets','burstMaxGapSec',
  'sameAmountWalletPct','washPairCount','washPairSellPct',
  'pumpStablePoints','pumpStableR2','pumpStableSlopePctPerMin','pumpRisePerBuyBnb','pumpSellTickCountPct',
  'spikeHoldPctAll','spikeBuyPctInBurst',
  'sameBlockHoldPct','equalBandHoldPct','anchorBuySellRatio','noBuySellPct',
  'walletCount','buyN','sellN','totalBuyBnb','totalSellBnb','churn60sWalletCount',
  'activityLevel','ticksPerMin','idlePct',
];

async function main() {
  const c = await dbManager.getClient();
  const targets = [];
  for (const cs of FIX.cases) {
    const v = cs.expect && cs.expect.verdict;
    if (!v) continue;
    targets.push({ id: cs.caseId, addr: cs.addr.toLowerCase(), symbol: cs.symbol, anchor: cs.anchor.tickCount, verdict: STRONG.includes(cs.caseId) ? '强庄池' : v });
  }
  console.error(`目标 ${targets.length} 票（含池 ${targets.filter(t => t.verdict === '强庄池').length}）`);
  const out = {};
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    try {
      const raw = await fetchTokenAll(c, t.addr);
      if (!raw || raw.length < 8) { console.error(`${t.id} 无tick行`); continue; }
      const capped = raw.length > CAP;
      const rows = raw.slice(0, CAP).sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
      // token meta（与 run.mjs loadTokenMeta 同口径，精简字段）
      const { data: ev } = await c.from('wss_events').select('platform,payload,block_time')
        .eq('kind', 'token_create').eq('token_address', t.addr).order('id', { ascending: true }).limit(5);
      const hit = (ev ?? []).find(r => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
      const p = hit ? hit.payload : {};
      const meta = {
        address: t.addr, symbol: p.symbol || null, name: p.name || null, platform: hit ? hit.platform : null,
        createdAt: p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : (hit ? hit.block_time : null),
        creatorAddress: p.creator || null, createTxHash: p.txHash || p.tx_hash || null,
        totalSupply: p.totalSupply ?? ((hit && (hit.platform === 'flap' || hit.platform === 'gang')) ? 1e9 : null),
        quoteToken: null,
      };
      for (let k = rows.length - 1; k >= 0; k--) if (rows[k].quote_token) { meta.quoteToken = rows[k].quote_token; break; }
      const cps = {};
      const points = [...new Set([t.anchor, t.anchor + 50, t.anchor + 150, t.anchor + 400, t.anchor + 800, rows.length])].filter(n => n >= 8 && n <= rows.length).sort((a, b) => a - b);
      for (const n of points) {
        const win = rows.slice(0, n);
        const snap = buildSnapshotFromRows(win, meta, { capped: capped && n === rows.length, anchorTickCount: n });
        const d = snap.derived;
        const rec = {};
        for (const k of PICK) rec[k] = d[k] === undefined ? null : d[k];
        cps[n] = rec;
      }
      out[t.id] = { verdict: t.verdict, symbol: t.symbol, anchor: t.anchor, rowsTotal: rows.length, capped, cps };
      console.error(`${i + 1}/${targets.length} ${t.id} 锚${t.anchor} 全量${rows.length}${capped ? '+' : ''} 截点${Object.keys(cps).join('/')}`);
    } catch (e) {
      console.error(`${t.id} ERR ${e.message.slice(0, 60)}`);
    }
  }
  fs.writeFileSync('/tmp/sbp-late.json', JSON.stringify(out));
  console.error('written /tmp/sbp-late.json');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
