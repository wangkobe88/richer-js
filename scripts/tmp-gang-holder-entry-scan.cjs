'use strict';
/* 用户思路扫描：gang 创建即买 → 改「前 2s 不参与+持有者开始涨再入场」？
 * 链上 getLogs 重放（V2 WNB-only，与 snipe-sim 同源框架）：
 *   1) 狙击形状：前 2s 买入钱包的进出场时间线（验证「狙击进→我们进→狙击出→吃瘪」）
 *   2) 持有者曲线：per wallet 净持仓>0 计数；前 skipSec 事件「数据扣除」（曲线不计入）
 *   3) 信号：holder 从窗内低点回升 ≥N / 绝对阈值 ≥T；触发点入场 trailing -5%@30min
 *   4) 对照：E2（首笔成交后进）同退出；差分看「晚入场」代价/收益
 * 用法（182）：node scripts/tmp-gang-holder-entry-scan.cjs --hours=72 --amount=0.002
 */
const fs = require('fs');
const { TOPIC0_MAP } = require('../src/collectors/gang-ankr-ws-collector.js');
const { AbiCoder } = require('ethers');

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const HOURS = Number(arg('hours', 72));
const AMOUNT_BNB = Number(arg('amount', 0.002));
const SKIP_SEC = Number(arg('skipSec', 2));
const CASES = ['0xad9841c0c821046dc21e3e94cb74e4155a5ea8cf', '0x6a0b183ab4a638c22e0fac8740b4c0d291d98e9c']; // JOCKEY / 慈善英雄
const BAW = '0xfc84d51c15acbddcc5381fdd389cb9c99dce4abd';

const env = fs.readFileSync(require('path').join(__dirname, '..', 'config', '.env'), 'utf8');
const mEnv = env.match(/ANKR_WS_URL\s*=\s*["']?([^"'\s]+)/);
const httpUrl = mEnv[1].replace(/^wss:/, 'https:').replace(/\/ws\//, '/');
const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const ZERO40 = '0x' + '0'.repeat(40);
const CREATE_TYPES = ['string', 'string', 'string', 'bool', 'address', 'uint256'];
const TRADE_TYPES = ['uint256', 'uint256', 'uint256', 'uint256', 'uint256'];
const coder = AbiCoder.defaultAbiCoder();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const topicAddr = (t) => '0x' + t.slice(26).toLowerCase();
const LAUNCHPAD_ADDR = '0x1b8f3f69dfa0a7f63d308c7eb0fd38d8b099966e';

let rpcId = 0;
async function rpc(method, params) {
    for (let a = 0; ; a++) {
        try {
            const res = await fetch(httpUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
            const j = await res.json();
            if (j.error) throw new Error(method + ' ' + JSON.stringify(j.error));
            return j.result;
        } catch (e) { if (a >= 5) throw e; await sleep(1200 * (a + 1)); }
    }
}
async function buildAnchors(from, head) {
    const anchors = [];
    for (let bn = from; bn <= head; bn += 3000) {
        const b = await rpc('eth_getBlockByNumber', ['0x' + bn.toString(16), false]);
        if (b) anchors.push([bn, parseInt(b.timestamp, 16)]);
    }
    const b = await rpc('eth_getBlockByNumber', ['0x' + head.toString(16), false]);
    if (b && anchors[anchors.length - 1][0] !== head) anchors.push([head, parseInt(b.timestamp, 16)]);
    return anchors;
}
function makeInterp(anchors) {
    return (bn) => {
        let lo = 0, hi = anchors.length - 1;
        while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (anchors[mid][0] <= bn) lo = mid; else hi = mid; }
        const [b0, t0] = anchors[lo], [b1, t1] = anchors[hi] || anchors[lo];
        if (bn <= b0) return t0;
        return t0 + Math.round((bn - b0) * (t1 - t0) / (b1 - b0));
    };
}
async function fetchTopicLogs(topic0, from, head, label) {
    const out = [];
    for (let c = from; c <= head; c += 40000) {
        const to = Math.min(c + 39999, head);
        const logs = await rpc('eth_getLogs', [{ address: LAUNCHPAD_ADDR, topics: [topic0], fromBlock: '0x' + c.toString(16), toBlock: '0x' + to.toString(16) }]);
        out.push(...logs);
        await sleep(250);
    }
    return out;
}

(async () => {
    const t0names = {};
    for (const [t0, name] of TOPIC0_MAP.entries()) t0names[name] = t0;
    const head = parseInt(await rpc('eth_blockNumber', []), 16);
    const probe = 20000;
    const [hB, pB] = await Promise.all([
        rpc('eth_getBlockByNumber', ['0x' + head.toString(16), false]),
        rpc('eth_getBlockByNumber', ['0x' + (head - probe).toString(16), false]),
    ]);
    const secPerBlock = (parseInt(hB.timestamp, 16) - parseInt(pB.timestamp, 16)) / probe;
    const from = head - Math.floor(HOURS * 3600 / secPerBlock);
    const anchors = await buildAnchors(from, head);
    const interp = makeInterp(anchors);
    const spanH = ((anchors[anchors.length - 1][1] - anchors[0][1]) / 3600).toFixed(1);
    console.error(`窗 ${spanH}h 块 ${from}..${head} 出块 ${secPerBlock.toFixed(3)}s`);

    const createdLogs = await fetchTopicLogs(t0names.Created, from, head);
    const buyLogs = await fetchTopicLogs(t0names.Buy, from, head);
    const sellLogs = await fetchTopicLogs(t0names.Sell, from, head);

    const tokens = new Map();
    const seen = new Set();
    const dedupe = (L) => { const k = L.transactionHash + ':' + L.logIndex; if (seen.has(k)) return false; seen.add(k); return true; };
    let quoteDisc = 0;
    for (const L of createdLogs) {
        if (!dedupe(L)) continue;
        const addr = topicAddr(L.topics[1]);
        const quote = topicAddr(L.topics[3]);
        if (quote !== WBNB && quote !== ZERO40) { quoteDisc++; continue; }
        tokens.set(addr, { gradAmt: coder.decode(CREATE_TYPES, L.data)[5], ts: interp(L.blockNumber), trades: [] });
    }
    const feed = (logs, side) => {
        for (const L of logs) {
            if (!dedupe(L)) continue;
            const t = tokens.get(topicAddr(L.topics[1]));
            if (!t) continue;
            const d = coder.decode(TRADE_TYPES, L.data);
            t.trades.push({ ts: interp(L.blockNumber), li: Number(L.logIndex), side, trader: topicAddr(L.topics[2]), dw0: d[0], dw3: d[3], d4: d[4] });
        }
    };
    feed(buyLogs, 'buy'); feed(sellLogs, 'sell');
    for (const t of tokens.values()) t.trades.sort((a, b) => a.ts - b.ts || a.li - b.li);
    console.error(`WNB 队列 ${tokens.size}（quote 盘剔除 ${quoteDisc}）`);

    // ── 曲线模型（snipe-sim 校准参数同源）──
    const R0 = 1066560000n * 10n ** 18n;
    const GROSS = BigInt(Math.round(AMOUNT_BNB * 1e6)) * 10n ** 12n;
    const NET_IN = GROSS * 99n / 100n;
    const CAP = 10n * 10n ** 6n * 10n ** 18n;
    const priceMult = (Q0, D) => Number((Q0 + D) * (Q0 + D) * 1000000n / (Q0 * Q0)) / 1000000;

    // ── per token：持有者曲线 + 信号 + 收益 ──
    const SIGNAL_NS = [2, 3, 5];       // 回升幅度（净增持有者数）
    const SIGNAL_ABS = [10, 20];       // 绝对阈值
    const DELAYS = [0, 5, 10, 22, 30, 60]; // CLI 成交延迟臂（实测 JOCKEY fire→成交 22s；SHIFT >8min 无终态）
    const res = { n: tokens.size, fired: Object.fromEntries([...SIGNAL_NS.map(n => 'rise' + n), ...SIGNAL_ABS.map(t => 'abs' + t)].map(k => [k, 0])) };
    const rows = [];                    // 收益行
    const sigStats = [];                // 信号时点质量
    let sniperAll = { wallets: 0, tokens: 0, exitMed: [], res30: [], resEow: [], volArr: [] };
    const caseDetail = [];

    for (const [addr, t] of tokens) {
        const Q0 = t.gradAmt / 3n, K = Q0 * R0;
        const buyT = (D) => { const Q = Q0 + D, R = K / Q; return R - K / (Q + NET_IN); };
        const proceeds = (D, tk) => { const Q = Q0 + D, R = K / Q; return (Q - K / (R + tk)) * 99n / 100n; };
        const entry = (D) => { let tk = buyT(D), paid = GROSS; if (tk > CAP) { const Q = Q0 + D, R = K / Q; paid = (K / (R - CAP) - Q) * 100n / 99n; tk = CAP; } return { tk, paid }; };
        const trailExit = (startD, startTs, theta, timeoutSec) => {
            const k = BigInt(100 - theta);
            let peak2 = (Q0 + startD) * (Q0 + startD);
            for (const tr of t.trades) {
                if (tr.ts < startTs) continue;
                if (tr.ts > startTs + timeoutSec) break;
                const p2 = (Q0 + tr.d4) * (Q0 + tr.d4);
                if (p2 > peak2) peak2 = p2;
                else if (p2 * 100n <= peak2 * k) return { d4: tr.d4, ts: tr.ts };
            }
            let lo = 0, hi = t.trades.length - 1, ans = -1;
            while (lo <= hi) { const mid = (lo + hi) >> 1; if (t.trades[mid].ts <= startTs + timeoutSec) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
            return { d4: ans < 0 ? startD : t.trades[ans].d4, ts: startTs + timeoutSec };
        };
        const lastIdx = (tsLimit) => { let lo = 0, hi = t.trades.length - 1, ans = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (t.trades[mid].ts <= tsLimit) { ans = mid; lo = mid + 1; } else hi = mid - 1; } return ans; };
        const evalEntry = (D, ts, tag, delaySec = 0) => {
            if (delaySec > 0) { const i = lastIdx(ts + delaySec); if (i >= 0) D = t.trades[i].d4; ts += delaySec; }
            const e = entry(D);
            for (const [pol, th, tmo] of [['trail5@30m', 5, 1800], ['5min', null, 300], ['30min', null, 1800], ['EOW', null, 1e9]]) {
                let d4;
                if (th) d4 = trailExit(D, ts, th, tmo).d4;
                else {
                    let lo = 0, hi = t.trades.length - 1, ans = -1;
                    while (lo <= hi) { const mid = (lo + hi) >> 1; if (t.trades[mid].ts <= ts + tmo) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
                    d4 = ans < 0 ? D : t.trades[ans].d4;
                }
                const net = proceeds(d4, e.tk);
                rows.push({ addr, entry: tag, policy: pol, pct: Number(net - e.paid) * 100 / Number(e.paid), pnl: Number(net - e.paid) / 1e18, paid: Number(e.paid) / 1e18 });
            }
        };

        // 市场峰值（信号质量基准）
        let peakD = 0n, peakTs = t.ts;
        for (const tr of t.trades) if (tr.d4 > peakD) { peakD = tr.d4; peakTs = tr.ts; }

        // ── 狙击形状：前 SKIP_SEC 买入者 ──
        const skipCut = t.ts + SKIP_SEC;
        const snipers = new Map(); // wallet → { buyBnb, exitTs|null }
        let bnb0 = 0, bnb0sniper = 0;
        for (const tr of t.trades) {
            if (tr.ts > skipCut) break;
            if (tr.side === 'buy') {
                const w = snipers.get(tr.trader) || { buyBnb: 0, outSec: null, qty: 0n };
                w.buyBnb += Number(tr.dw0) / 1e18; w.qty += tr.dw3;
                snipers.set(tr.trader, w);
                bnb0 += Number(tr.dw0) / 1e18; bnb0sniper += Number(tr.dw0) / 1e18;
            }
        }
        if (snipers.size) {
            sniperAll.tokens++; sniperAll.wallets += snipers.size;
            sniperAll.volArr.push(bnb0);
            let bought0 = 0n; for (const w of snipers.values()) bought0 += w.qty;
            const netQ = new Map(); let snap30 = null;
            for (const tr of t.trades) { // 全窗追踪净持仓（含狙击者迟后补买）
                const nv = (netQ.get(tr.trader) || 0n) + (tr.side === 'buy' ? tr.dw3 : -tr.dw0);
                netQ.set(tr.trader, nv < 0n ? 0n : nv);
                if (snap30 === null && tr.ts > skipCut + 30) { let s = 0n; for (const w of snipers.keys()) s += netQ.get(w) || 0n; snap30 = s; }
                if (tr.side === 'sell' && snipers.has(tr.trader)) { const w = snipers.get(tr.trader); if (w.outSec === null && (netQ.get(tr.trader) || 0n) === 0n) w.outSec = tr.ts - t.ts; }
            }
            let sEnd = 0n; for (const w of snipers.keys()) sEnd += netQ.get(w) || 0n;
            for (const w of snipers.values()) if (w.outSec !== null) sniperAll.exitMed.push(w.outSec);
            if (bought0 > 0n) { if (snap30 !== null) sniperAll.res30.push(Number(snap30 * 10000n / bought0) / 100); sniperAll.resEow.push(Number(sEnd * 10000n / bought0) / 100); }
        }

        // ── 持有者曲线（SKIP_SEC 前事件数据扣除：不计入曲线）──
        const hold = new Map(); let count = 0, low = Infinity;
        const sigFire = {}; for (const k of Object.keys(res.fired)) sigFire[k] = null;
        for (const tr of t.trades) {
            if (tr.ts < skipCut) continue;
            const delta = tr.side === 'buy' ? tr.dw3 : -tr.dw0;
            const prev = hold.get(tr.trader) || 0n;
            const next = prev + delta;
            hold.set(tr.trader, next < 0n ? 0n : next);
            if (prev <= 0n && next > 0n) count++;
            else if (prev > 0n && next <= 0n) count--;
            if (count < low) low = count;
            // 信号判定（每事件后；只首次触发）
            for (const n of SIGNAL_NS) if (!sigFire['rise' + n] && count >= low + n && count >= 2) sigFire['rise' + n] = tr;
            for (const a of SIGNAL_ABS) if (!sigFire['abs' + a] && count >= a) sigFire['abs' + a] = tr;
        }
        for (const k of Object.keys(sigFire)) if (sigFire[k]) {
            res.fired[k]++;
            const tr = sigFire[k];
            evalEntry(tr.d4, tr.ts, 'H-' + k);
            if (k === 'rise3') evalEntry(tr.d4, tr.ts, 'H-rise3+d22', 22);
            sigStats.push({ addr, key: k, dt: tr.ts - t.ts, vsPeak: peakD > 0n ? priceMult(Q0, tr.d4) / priceMult(Q0, peakD) : null, entryMult: priceMult(Q0, tr.d4) });
        }

        // ── E2 基线（首笔成交后）+ CLI 成交延迟臂（fire→成交延迟 Ns，按当时状态价成交=实盘形状）──
        if (t.trades.length) {
            const tr0 = t.trades[0];
            for (const dl of DELAYS) evalEntry(tr0.d4, tr0.ts, 'E2' + (dl ? '+d' + dl : ''), dl);
            // E2 子集对照：与信号臂同票集合
            for (const k of Object.keys(sigFire)) if (sigFire[k]) evalEntry(tr0.d4, tr0.ts, 'E2sub-' + k);
        }

        if (CASES.includes(addr)) {
            const d = { addr, rows: [] };
            const netHold = new Map(); let hc = 0;
            for (const tr of t.trades.slice(0, 100)) {
                const prev = netHold.get(tr.trader) || 0n;
                const nv = prev + (tr.side === 'buy' ? tr.dw3 : -tr.dw0);
                netHold.set(tr.trader, nv < 0n ? 0n : nv);
                if (prev <= 0n && nv > 0n) hc++; else if (prev > 0n && nv <= 0n) hc--;
                d.rows.push({ dt: tr.ts - t.ts, side: tr.side, bnb: Number(tr.dw0) / 1e18, mult: priceMult(Q0, tr.d4).toFixed(2), hc, us: tr.trader === BAW, sn: snipers.has(tr.trader) });
            }
            caseDetail.push(d);
        }
    }

    // ── 报告 ──
    const fmt = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
    const q = (arr, p) => { const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * a.length)))]; };
    const grp = (tag, pol) => { const g = rows.filter(r => r.entry === tag && r.policy === pol); if (!g.length) return null; const pnl = g.reduce((s, r) => s + r.pnl, 0), spend = g.reduce((s, r) => s + r.paid, 0); const ps = g.map(r => r.pct); return { n: g.length, win: g.filter(r => r.pnl > 0).length * 100 / g.length, pnl, roi: pnl * 100 / spend, mean: ps.reduce((a, b) => a + b) / ps.length, med: q(ps, .5), p10: q(ps, .1), p90: q(ps, .9) }; };
    const show = (label, s) => s && console.log(`${label.padEnd(28)}│${String(s.n).padStart(4)}│${(s.win.toFixed(0) + '%').padStart(5)}│${s.pnl.toFixed(4).padStart(9)}│${fmt(s.roi).padStart(7)}%│${fmt(s.mean).padStart(8)}│${fmt(s.med).padStart(8)}│${fmt(s.p10).padStart(8)}│${fmt(s.p90).padStart(8)}`);

    console.log(`═══ gang 持有者信号入场扫描（${spanH}h，V2 WNB ${res.n} 票，skip=${SKIP_SEC}s，单笔 ${AMOUNT_BNB} BNB）═══`);
    console.log(`\n── 狙击形状（前 ${SKIP_SEC}s 买入钱包；其净持仓全窗追踪）──`);
    const exS = sniperAll.exitMed.slice().sort((a, b) => a - b);
    console.log(`有狙击买入票 ${sniperAll.tokens}/${res.n}｜狙击钱包均 ${(sniperAll.wallets / Math.max(1, sniperAll.tokens)).toFixed(1)}/票｜前${SKIP_SEC}s买入量/票中位 ${q(sniperAll.volArr, .5).toFixed(3)} BNB｜狙击钱包离场（清仓）比例 ${(exS.length * 100 / Math.max(1, sniperAll.wallets)).toFixed(0)}%｜离场时间中位 ${(q(exS, .5) / 60).toFixed(1)}min p90 ${(q(exS, .9) / 60).toFixed(1)}min｜+30s 残留 ${q(sniperAll.res30, .5).toFixed(0)}%（占其买入量，p50）｜EOW 残留 ${q(sniperAll.resEow, .5).toFixed(0)}%`);
    console.log(`\n── 信号触发与质量 ──`);
    for (const k of Object.keys(res.fired)) {
        const ss = sigStats.filter(s => s.key === k);
        if (!ss.length) { console.log(`${k}: 零触发`); continue; }
        console.log(`${k.padEnd(6)}: 触发 ${res.fired[k]}/${res.n}（${(res.fired[k] * 100 / res.n).toFixed(0)}%）｜触发时点 t0+ 中位 ${(q(ss.map(s => s.dt), .5) / 60).toFixed(1)}min p90 ${(q(ss.map(s => s.dt), .9) / 60).toFixed(1)}min｜入场价/峰值 p50 ${q(ss.map(s => s.vsPeak), .5).toFixed(2)} p25 ${q(ss.map(s => s.vsPeak), .25).toFixed(2)}`);
    }
    console.log(`\n── 收益对比（同 0.002 BNB/票）──`);
    console.log('入场臂              │  n│胜率 │ΣPnL(BNB) │ROI    │均值%   │中位%   │p10%    │p90%');
    for (const pol of ['trail5@30m', '5min', '30min', 'EOW']) {
        for (const tag of DELAYS.map(dl => 'E2' + (dl ? '+d' + dl : ''))) show(tag + '·' + pol, grp(tag, pol));
        show('H-rise3·' + pol, grp('H-rise3', pol));
        show('H-rise3+d22·' + pol, grp('H-rise3+d22', pol));
        show('  对照E2同票·' + pol, grp('E2sub-rise3', pol));
    }
    console.log(`\n── 案票逐事件（前 60 事件；mult=价/出生价，hc=全量持有者数，US=我们的 BAW）──`);
    for (const d of caseDetail) {
        console.log(`\n■ ${d.addr}`);
        for (const r of d.rows.slice(0, 80)) console.log(`  t+${String(r.dt).padStart(5)}s ${r.sn ? '▲' : ' '} ${r.side === 'buy' ? '买' : '卖'} ${r.bnb.toFixed(4)} BNB mult=${r.mult} hc=${r.hc}${r.us ? ' ◀US' : ''}`);
    }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
