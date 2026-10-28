'use strict';
/* gang「创建即买」策略模拟（链上 getLogs，WNB-only，零 DB）
 *
 * E1 = Created 事件后 D=0 出生价立即买（乐观上限：抢在创建者首买前成交）
 * E2 = 首笔链上成交后跟买（现实 WSS 延迟形状，创建者首买几乎与 Created 同 tx/块）
 * 退出：5m/30m/2h/6h/12h/EOW 网格 + 利润目标 +20/+50/+100/+200%（6h 超时，仅 E1）
 *
 * 曲线模型（2026-10-28 链上校准：24h 窗 319 票买侧最小二乘，RMSE 0.001%）：
 *   Q0 = gradAmt/3（精确：319 票 Q0/G p10=p50=p90=0.3333）
 *   R0 = 1.06656e9（拟合值；非毕业注入 2e8 的 8e8 假设）
 *   K = Q0×R0；任意时刻 Q = Q0+dw4、R = K/Q；边际价 ∝ Q²
 *   买：净入金 = 毛×0.99（M0 实证 dw4 首笔==dw0）；卖：净收款 = 毛×0.99（实证 0.9898±拟合偏差）
 *   模型逐笔对拍：预测 dw3 vs 实测 dw3（0.05% 容差，拟合精度内）
 *
 * 用法（182 上从 repo 根跑，本地勿跑——重 getLogs）：
 *   node scripts/gang-snipe-sim.cjs --hours=72 --amount=0.05
 */
const fs = require('fs');
const { TOPIC0_MAP } = require('../src/collectors/gang-ankr-ws-collector.js');
const { AbiCoder } = require('ethers');

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const HOURS = Number(arg('hours', 72));
const AMOUNT_BNB = Number(arg('amount', 0.05));

const env = fs.readFileSync(require('path').join(__dirname, '..', 'config', '.env'), 'utf8');
const mEnv = env.match(/ANKR_WS_URL\s*=\s*["']?([^"'\s]+)/);
if (!mEnv) throw new Error('ANKR_WS_URL 未找到');
const httpUrl = mEnv[1].replace(/^wss:/, 'https:').replace(/\/ws\//, '/');

const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'; // BSC WBNB（collector 同源 0xbb4C…095c）
const ZERO40 = '0x' + '0'.repeat(40);
const CREATE_TYPES = ['string', 'string', 'string', 'bool', 'address', 'uint256'];
const TRADE_TYPES = ['uint256', 'uint256', 'uint256', 'uint256', 'uint256'];
const coder = AbiCoder.defaultAbiCoder();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const topicAddr = (t) => '0x' + t.slice(26).toLowerCase();

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

// ── 块时间锚点（3000 块间隔线性插值，BSC 出块稳）──
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
        console.error(`  ${label} [${c}..${to}] +${logs.length} (累计 ${out.length})`);
        await sleep(250);
    }
    return out;
}

const LAUNCHPAD_ADDR = '0x1b8f3f69dfa0a7f63d308c7eb0fd38d8b099966e';

(async () => {
    const t0names = {};
    for (const [t0, name] of TOPIC0_MAP.entries()) t0names[name] = t0;

    const head = parseInt(await rpc('eth_blockNumber', []), 16);
    // 实测出块间隔（BSC Maxwell 后 ~0.45s，勿硬编码）
    const probe = 20000;
    const [hB, pB] = await Promise.all([
        rpc('eth_getBlockByNumber', ['0x' + head.toString(16), false]),
        rpc('eth_getBlockByNumber', ['0x' + (head - probe).toString(16), false]),
    ]);
    const secPerBlock = (parseInt(hB.timestamp, 16) - parseInt(pB.timestamp, 16)) / probe;
    const from = head - Math.floor(HOURS * 3600 / secPerBlock);
    console.error(`出块 ${secPerBlock.toFixed(3)}s/块，窗：块 ${from}..${head}（目标 ${HOURS}h）`);
    const anchors = await buildAnchors(from, head);
    const interp = makeInterp(anchors);
    const spanH = ((anchors[anchors.length - 1][1] - anchors[0][1]) / 3600).toFixed(1);
    console.error(`锚点 ${anchors.length} 个，实际覆盖 ${spanH}h`);

    console.error('拉 Created…');
    const createdLogs = await fetchTopicLogs(t0names.Created, from, head, 'Created');
    console.error('拉 Buy…');
    const buyLogs = await fetchTopicLogs(t0names.Buy, from, head, 'Buy');
    console.error('拉 Sell…');
    const sellLogs = await fetchTopicLogs(t0names.Sell, from, head, 'Sell');
    console.error('拉 Graduated…');
    const gradLogs = await fetchTopicLogs(t0names.Graduated, from, head, 'Graduated');

    // ── 解码 ──
    const tokens = new Map(); // addr → { gradAmt, ts, trades: [], grad: null }
    const seen = new Set();
    const dedupe = (L) => { const k = L.transactionHash + ':' + L.logIndex; if (seen.has(k)) return false; seen.add(k); return true; };

    let quoteDisc = 0, gradAmtDist = new Map();
    for (const L of createdLogs) {
        if (!dedupe(L)) continue;
        const addr = topicAddr(L.topics[1]);
        const quote = topicAddr(L.topics[3]);
        const d = coder.decode(CREATE_TYPES, L.data);
        const gradAmt = d[5];
        gradAmtDist.set(gradAmt.toString(), (gradAmtDist.get(gradAmt.toString()) || 0) + 1);
        if (quote !== WBNB && quote !== ZERO40) { quoteDisc++; continue; } // 非 WNB 盘剔除
        tokens.set(addr, { gradAmt, ts: interp(L.blockNumber), bn: L.blockNumber, trades: [], grad: null });
    }
    const feed = (logs, side) => {
        let miss = 0;
        for (const L of logs) {
            if (!dedupe(L)) continue;
            const addr = topicAddr(L.topics[1]);
            const t = tokens.get(addr);
            if (!t) { miss++; continue; } // 窗外存量票
            const d = coder.decode(TRADE_TYPES, L.data);
            t.trades.push({ bn: L.blockNumber, li: Number(L.logIndex), ts: interp(L.blockNumber), side, dw0: d[0], dw3: d[3], d4: d[4] });
        }
        return miss;
    };
    const buyMiss = feed(buyLogs, 'buy');
    const sellMiss = feed(sellLogs, 'sell');
    for (const L of gradLogs) {
        if (!dedupe(L)) continue;
        const t = tokens.get(topicAddr(L.topics[1]));
        if (t) t.grad = interp(L.blockNumber);
    }
    for (const t of tokens.values()) t.trades.sort((a, b) => a.bn - b.bn || a.li - b.li);
    if (tokens.size === 0) { console.error(`FATAL WNB 队列为空（Created ${createdLogs.length} / quote 盘 ${quoteDisc}）——WBNB 常量或 topics 映射有误`); process.exit(2); }

    // ── 模型对拍（买/卖 dw3 预测，0.05% 容差=拟合精度内）──
    const R0 = 1066560000n * 10n ** 18n; // 链上拟合（319 票买侧 RMSE 0.001%）
    let buyChecked = 0, buyBad = 0, sellChecked = 0, sellBad = 0, maxPpm = 0;
    for (const t of tokens.values()) {
        const K = t.gradAmt / 3n * R0;
        let prevD = 0n;
        for (const tr of t.trades) {
            const Q = t.gradAmt / 3n + prevD, R = K / Q;
            if (tr.side === 'buy') {
                const pred = R - K / (Q + tr.dw0);
                const ppm = tr.dw3 > 0n ? Math.abs(Number((pred - tr.dw3) * 1000000n / tr.dw3)) : 0;
                buyChecked++; if (ppm > 500) buyBad++; if (ppm > maxPpm) maxPpm = ppm;
            } else {
                const gross = Q - K / (R + tr.dw0);
                const pred = gross * 99n / 100n;
                const ppm = tr.dw3 > 0n ? Math.abs(Number((pred - tr.dw3) * 1000000n / tr.dw3)) : 0;
                sellChecked++; if (ppm > 500) sellBad++; if (ppm > maxPpm) maxPpm = ppm;
            }
            prevD = tr.d4;
        }
    }

    // ── 模拟 ──
    const GROSS = BigInt(Math.round(AMOUNT_BNB * 1e6)) * 10n ** 12n;
    const NET_IN = GROSS * 99n / 100n;
    const CAP = 10n * 10n ** 6n * 10n ** 18n; // 1% 钱包上限 10M 枚

    const HORIZONS = [['5min', 300], ['30min', 1800], ['2h', 7200], ['6h', 21600], ['12h', 43200]];
    const targets = [120, 150, 200, 300]; // %（相对买入价 1.2/1.5/2/3 倍）

    const rows = []; // {addr, entry, policy, pct, pnlBnb, exitTs}
    const peakMults = [], timeToPeak = [];
    let deadBirth = 0, capHit = 0, graduated = 0;

    for (const [addr, t] of tokens) {
        const Q0 = t.gradAmt / 3n, K = Q0 * R0;
        const buyT = (D) => { const Q = Q0 + D, R = K / Q; return R - K / (Q + NET_IN); };
        const proceeds = (D, tk) => { const Q = Q0 + D, R = K / Q; return (Q - K / (R + tk)) * 99n / 100n; };
        const lastTradeBy = (tsLimit) => { // ts ≤ tsLimit 的最后一笔（二分）
            let lo = 0, hi = t.trades.length - 1, ans = -1;
            while (lo <= hi) { const mid = (lo + hi) >> 1; if (t.trades[mid].ts <= tsLimit) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
            return ans;
        };

        // 峰值（市场形状统计）
        let peakD = 0n, peakTs = t.ts;
        for (const tr of t.trades) if (tr.d4 > peakD) { peakD = tr.d4; peakTs = tr.ts; }
        const mult = Number((Q0 + peakD) * (Q0 + peakD) * 1000000n / (Q0 * Q0)) / 1000000;
        peakMults.push(mult);
        timeToPeak.push(peakTs - t.ts);
        if (t.trades.length === 0) deadBirth++;
        if (t.grad) graduated++;

        // ── 入场（触 1% 上限时按退款语义：只为到手 10M 枚付费，反解实付 quote）──
        const entry = (D) => {
            let tk = buyT(D), paid = GROSS;
            if (tk > CAP) { const Q = Q0 + D, R = K / Q; paid = (K / (R - CAP) - Q) * 100n / 99n; tk = CAP; capHit++; }
            return { tk, paid };
        };

        // ── E1：出生价 ──
        const e1 = entry(0n);
        const tk = e1.tk, paid1 = e1.paid;
        for (const [pname, sec] of HORIZONS) {
            const i = lastTradeBy(t.ts + sec);
            const net = proceeds(i < 0 ? 0n : t.trades[i].d4, tk);
            rows.push({ addr, entry: 'E1', policy: pname, pct: Number(net - paid1) * 100 / Number(paid1), pnl: Number(net - paid1) / 1e18, paid: Number(paid1) / 1e18 });
        }
        const iEow = t.trades.length - 1;
        const netEow = proceeds(iEow < 0 ? 0n : t.trades[iEow].d4, tk);
        rows.push({ addr, entry: 'E1', policy: 'EOW', pct: Number(netEow - paid1) * 100 / Number(paid1), pnl: Number(netEow - paid1) / 1e18, paid: Number(paid1) / 1e18 });

        // ── E1 利润目标（6h 超时）──
        for (const tgt of targets) {
            const Qe = Q0; // 入场即出生价
            let exitD = null, exitTs = t.ts + 21600, hit = false;
            for (const tr of t.trades) {
                if (tr.ts > t.ts + 21600) break;
                const LHS = (Q0 + tr.d4) * (Q0 + tr.d4) * 100n;
                const RHS = Qe * Qe * BigInt(tgt);
                if (LHS >= RHS) { exitD = tr.d4; exitTs = tr.ts; hit = true; break; }
            }
            if (!hit) { const i = lastTradeBy(t.ts + 21600); exitD = i < 0 ? 0n : t.trades[i].d4; }
            const net = proceeds(exitD, tk);
            rows.push({ addr, entry: 'E1', policy: `tgt+${tgt - 100}%`, pct: Number(net - paid1) * 100 / Number(paid1), pnl: Number(net - paid1) / 1e18, paid: Number(paid1) / 1e18, hit });
        }

        // ── E2：首笔成交后 ──
        if (t.trades.length > 0) {
            const tr0 = t.trades[0];
            const e2 = entry(tr0.d4);
            const tk2 = e2.tk, paid2 = e2.paid;
            for (const [pname, sec] of HORIZONS) {
                const i = lastTradeBy(tr0.ts + sec);
                const net = proceeds(i < 0 ? tr0.d4 : t.trades[i].d4, tk2);
                rows.push({ addr, entry: 'E2', policy: pname, pct: Number(net - paid2) * 100 / Number(paid2), pnl: Number(net - paid2) / 1e18, paid: Number(paid2) / 1e18 });
            }
            const iE2 = t.trades.length - 1;
            const netE2 = proceeds(t.trades[iE2].d4, tk2);
            rows.push({ addr, entry: 'E2', policy: 'EOW', pct: Number(netE2 - paid2) * 100 / Number(paid2), pnl: Number(netE2 - paid2) / 1e18, paid: Number(paid2) / 1e18 });
        }
    }

    // ── 报告 ──
    const pct = (a) => a.map(x => x.pct).sort((x, y) => x - y);
    const q = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(p * arr.length)))];
    const fmt = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);

    console.log('════════ gang 创建即买 · 模拟分析 ════════');
    console.log(`窗口：${spanH}h（块 ${from}..${head}）｜单笔 ${AMOUNT_BNB} BNB｜Created 总 ${createdLogs.length}（quote 盘剔除 ${quoteDisc}）→ WNB 队列 ${tokens.size}`);
    console.log(`队列形状：零成交死票 ${deadBirth}｜窗内毕业 ${graduated}｜每票成交中位 ${(() => { const arr = [...tokens.values()].map(t => t.trades.length).sort((a, b) => a - b); return arr[Math.floor(arr.length / 2)]; })()} 笔`);
    console.log(`gradAmt 分布 top5：${[...gradAmtDist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g, c]) => `${Number(g) / 1e18}×${c}`).join(', ')}`);
    console.log(`模型对拍：买 ${buyChecked} 笔失配 ${buyBad}｜卖 ${sellChecked} 笔失配 ${sellBad}｜最大偏差 ${maxPpm.toFixed(3)}ppm${capHit ? `｜触 1% 上限 ${capHit}` : ''}`);
    const pm = peakMults.sort((a, b) => a - b);
    console.log(`\n── 市场形状（相对出生价峰值倍数）──`);
    console.log(`p50 ×${q(pm, .5).toFixed(2)}｜p75 ×${q(pm, .75).toFixed(2)}｜p90 ×${q(pm, .9).toFixed(2)}｜p99 ×${q(pm, .99).toFixed(2)}｜max ×${pm[pm.length - 1].toFixed(2)}｜从未涨过(<×1.05) ${(pm.filter(x => x < 1.05).length * 100 / pm.length).toFixed(1)}%`);
    const tp = timeToPeak.slice().sort((a, b) => a - b);
    console.log(`到峰时间中位 ${(q(tp, .5) / 60).toFixed(1)}min｜p90 ${(q(tp, .9) / 3600).toFixed(1)}h`);

    console.log(`\n── 固定持有退出网格（每票 ${AMOUNT_BNB} BNB）──`);
    console.log('入场│退出  │ n  │胜率   │ΣPnL(BNB) │ROI    │均值%   │中位%  │p10%   │p90%');
    for (const entry of ['E1', 'E2']) {
        for (const pol of [...HORIZONS.map(h => h[0]), 'EOW']) {
            const g = rows.filter(r => r.entry === entry && r.policy === pol);
            if (!g.length) continue;
            const ps = pct(g);
            const pnl = g.reduce((s, r) => s + r.pnl, 0);
            const spend = g.reduce((s, r) => s + r.paid, 0);
            console.log(`${entry} │${pol.padEnd(6)}│${String(g.length).padStart(4)}│${((g.filter(r => r.pnl > 0).length * 100 / g.length).toFixed(1) + '%').padStart(7)}│${pnl.toFixed(4).padStart(10)}│${fmt(pnl * 100 / spend).padStart(7)}%│${fmt(ps.reduce((a, b) => a + b, 0) / ps.length).padStart(8)}│${fmt(q(ps, .5)).padStart(7)}│${fmt(q(ps, .1)).padStart(7)}│${fmt(q(ps, .9)).padStart(7)}`);
        }
    }
    console.log('（E1=出生价 D=0 乐观上限（抢创建者首买前）；E2=首笔链上成交后跟买=现实可达）');

    console.log(`\n── E1 利润目标止盈（6h 超时强退）──`);
    console.log('目标   │命中率  │ΣPnL(BNB) │ROI    │均值%   │中位%');
    for (const tgt of targets) {
        const g = rows.filter(r => r.entry === 'E1' && r.policy === `tgt+${tgt - 100}%`);
        const ps = pct(g);
        const pnl = g.reduce((s, r) => s + r.pnl, 0);
        console.log(`+${String(tgt - 100).padStart(3)}%  │${((g.filter(r => r.hit).length * 100 / g.length).toFixed(1) + '%').padStart(6)}│${pnl.toFixed(4).padStart(10)}│${fmt(pnl * 100 / g.reduce((s, r) => s + r.paid, 0)).padStart(7)}%│${fmt(ps.reduce((a, b) => a + b, 0) / ps.length).padStart(8)}│${fmt(q(ps, .5)).padStart(7)}`);
    }

    console.log(`\n── E1·EOW 最佳/最差 Top5 ──`);
    const eow = rows.filter(r => r.entry === 'E1' && r.policy === 'EOW').sort((a, b) => b.pct - a.pct);
    for (const r of [...eow.slice(0, 5), ...eow.slice(-5)]) console.log(`${r.addr.slice(0, 10)}…${r.addr.slice(-4)} ${fmt(r.pct).padStart(9)}%`);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
