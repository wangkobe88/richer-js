#!/usr/bin/env node
// ============================================================================
// TPA GMGN 用户剔除 + 主导盘豁免 dry-run 批量预演（2026-10-11 用户裁定，计划 E 步骤）
//
// 对象：b2 臂（TPA wallet 口径重跑，3e57ed75 复刻）全部 token_position_analyses 行，
//   在各自触发时刻（as_of）复刻 FA 累加（含 _walletRoutedBuyBnb）→ 输出：
//   ① gmgnUserPct 分布直方图（量加权，净持仓口径）
//   ② 豁免命中矩阵 × exemptPct 50/60/70/80（命中数 / b2 verdict 分布 / 命中票盈亏）
//   ③ top20 GMGN 占据度（全口径 top20 中 GMGN 钱包数 + 剔除后剩余数）
//   ④ 点名票验证（金狗救回形状）
//   ⑤ b2 内部分：豁免命中票 vs 未命中票的 b2 实跑盈亏（block 票无 trades 由 tnone 臂对拍，另跑）
//
// ticks 拉取：逐 token .eq + keyset 分页（fetchAllTicks 同款形状；勿用 .in+gt+ORDER BY id——
//   36a2c12a 五连折教训 planner 走 pkey 顺序扫 8s 超时）+ 并发 6。
//
// 用法（182）：node scripts/tmp_gmgn_dryrun_b2.cjs [--exp <id前缀=b2>] [--limit N]
// ============================================================================
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const { AGGREGATOR_ROUTER_ADDRS } = require('../src/trading-engine/pre-check/aggregator-routers');

const B2_DEFAULT = 'fb4630c7'; // b2 = TPA wallet 重跑臂（3e57ed75 复刻）
const CHUNK = 50;              // token_position_analyses 分页
const TICK_CONCURRENCY = 6;    // 逐 token ticks 拉取并发

const args = process.argv.slice(2);
function argOf(k, dflt) { const i = args.indexOf(k); return i > -1 ? args[i + 1] : dflt; }
const EXP_PREFIX = argOf('--exp', B2_DEFAULT);
const LIMIT = Number(argOf('--limit', 0)) || Infinity;
const PCTS = [50, 60, 70, 80];

const f2 = (x) => (Math.round(x * 10000) / 10000).toFixed(4);
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
const sum = (a) => a.reduce((s, x) => s + x, 0);
function pct(arr, p) { if (!arr.length) return NaN; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; }

// ── FA 累加复刻（tpa-replay-token 同源；只喂 block_time ≤ as_of 的行） ──
function initState(createEv) {
    const st = {
        firstTickAt: null, firstBlockNumber: null, tradeCount: 0,
        totalBuyBnb: 0, totalSellBnb: 0, totalBuyTokens: 0, totalSellTokens: 0,
        _walletNetTokens: new Map(), _walletMaxNetTokens: new Map(),
        _walletBoughtTokens: new Map(), _walletRoutedBuyBnb: new Map(),
        holderCount: 0, creatorAddress: null, totalSupply: 0,
    };
    if (createEv) {
        st.creatorAddress = createEv.payload?.creator || null;
        st.totalSupply = Number(createEv.payload?.totalSupply) || 0;
    }
    return st;
}

function feedTick(st, t) {
    const isBuy = t.trade_type === 'buy';
    const bnb = Number(t.bnb_amount) || 0;
    const tok = Number(t.token_amount) || 0;
    st.tradeCount++;
    if (st.firstTickAt == null) st.firstTickAt = Date.parse(t.block_time);
    if (st.firstBlockNumber == null && t.block_number != null) st.firstBlockNumber = Number(t.block_number);
    if (isBuy) { st.totalBuyBnb += bnb; st.totalBuyTokens += tok; } else { st.totalSellBnb += bnb; st.totalSellTokens += tok; }
    const w = t.sender_address || t.trader_address;
    if (w) {
        const cur = (st._walletNetTokens.get(w) || 0) + (isBuy ? tok : -tok);
        st._walletNetTokens.set(w, cur);
        const mx = st._walletMaxNetTokens.get(w) || 0;
        if (cur > mx) st._walletMaxNetTokens.set(w, cur);
        if (isBuy) {
            st._walletBoughtTokens.set(w, (st._walletBoughtTokens.get(w) || 0) + tok);
            if (t.trader_address && AGGREGATOR_ROUTER_ADDRS.has(String(t.trader_address).toLowerCase())) {
                st._walletRoutedBuyBnb.set(w, (st._walletRoutedBuyBnb.get(w) || 0) + bnb);
            }
        }
    }
    st.holderCount = 0;
    for (const net of st._walletNetTokens.values()) if (net > 0) st.holderCount++;
}

function gmgnStats(st) {
    if (!st._walletNetTokens || !st._walletRoutedBuyBnb) return null;
    let posTotal = 0, gmgnPos = 0, nonGmgnCount = 0;
    for (const [a, net] of st._walletNetTokens) {
        if (net <= 0) continue;
        posTotal += net;
        if ((st._walletRoutedBuyBnb.get(a) || 0) > 0) gmgnPos += net; else nonGmgnCount++;
    }
    return { nonGmgnCount, gmgnUserPct: posTotal > 0 ? Number(((gmgnPos / posTotal) * 100).toFixed(2)) : 0 };
}

/** 全口径 top20 + 剔除后 top20 形状（GMGN 占据度） */
function top20Shape(st) {
    const all = [...st._walletNetTokens].filter(([, net]) => net > 0)
        .map(([addr, net]) => ({ addr, net, gmgn: (st._walletRoutedBuyBnb.get(addr) || 0) > 0 }))
        .sort((a, b) => b.net - a.net);
    const top = all.slice(0, 20);
    return {
        topGmgnCount: top.filter(h => h.gmgn).length,
        afterCount: all.filter(h => !h.gmgn).length, // 剔除后净持仓者总数（top20 取其前 20）
        posHolders: all.length,
    };
}

async function fetchAllTicks(sb, token, asOfIso) {
    const COLS = 'id,trade_type,trader_address,sender_address,bnb_amount,token_amount,block_number,block_time';
    const rows = [];
    let lastId = 0, guard = 0;
    while (guard++ < 500) {
        let q = sb.from('wss_price_ticks').select(COLS)
            .eq('token_address', token).gt('id', lastId)
            .order('id', { ascending: true }).limit(1000);
        if (asOfIso) q = q.lt('block_time', asOfIso);
        const page = await q;
        if (page.error) throw new Error('ticks: ' + page.error.message);
        rows.push(...page.data);
        if (page.data.length < 1000) break;
        lastId = page.data[page.data.length - 1].id;
    }
    return rows;
}

/** FIFO per-token PnL（compare-hg55-pair 同款简化版） */
function pnlByToken(trades) {
    const by = new Map();
    for (const t of trades) {
        if (!(t.success === true || t.trade_status === 'success')) continue;
        const isBuy = t.trade_direction === 'buy' || t.trade_direction === 'BUY';
        const rec = by.get(t.token_address) || { spent: 0, received: 0, buys: 0, sells: 0, queue: [] };
        const inAmt = parseFloat(t.input_amount || 0), outAmt = parseFloat(t.output_amount || 0);
        if (isBuy) {
            if (outAmt > 0) { rec.queue.push({ amount: outAmt, cost: inAmt }); rec.spent += inAmt; rec.buys++; }
        } else {
            let rem = inAmt;
            while (rem > 0 && rec.queue.length) {
                const o = rec.queue[0];
                const sell = Math.min(rem, o.amount);
                const unit = o.cost / o.amount;
                o.amount -= sell; o.cost -= unit * sell; rem -= sell;
                if (o.amount <= 1e-12) rec.queue.shift();
            }
            rec.received += outAmt; rec.sells++;
        }
        by.set(t.token_address, rec);
    }
    for (const [addr, r] of by) {
        r.leftoverCost = r.queue.reduce((s, q) => s + q.cost, 0);
        r.net = r.received - r.spent;
        r.netWithOpen = r.net + r.leftoverCost;
        delete r.queue;
        if (r.buys === 0) by.delete(addr);
    }
    return by;
}

async function main() {
    const sb = dbManager.getClient();

    // ① b2 实验 id
    const { data: exps } = await sb.from('experiments').select('id,config').order('created_at', { ascending: false }).limit(30);
    const exp = (exps || []).find(e => e.id.startsWith(EXP_PREFIX));
    if (!exp) throw new Error('实验不存在: ' + EXP_PREFIX);
    console.log(`▶ 实验 ${exp.id}（${(exp.config || {}).experiment_name || (exp.config || {}).name || '?'}）`);

    // ② TPA 行全集（分页）
    const tpaRows = [];
    {
        let offset = 0;
        while (true) {
            const { data, error } = await sb.from('token_position_analyses')
                .select('token_address,as_of,verdict,holding_factors,trigger_snapshot')
                .eq('experiment_id', exp.id).order('token_address', { ascending: true })
                .range(offset, offset + CHUNK - 1);
            if (error) throw new Error('tpa: ' + error.message);
            tpaRows.push(...data);
            if (data.length < CHUNK || tpaRows.length >= LIMIT) break;
            offset += CHUNK;
        }
    }
    console.log(`TPA 行数 = ${tpaRows.length}`);

    // ③ b2 trades → FIFO PnL
    const trades = [];
    {
        let offset = 0;
        while (true) {
            const { data, error } = await sb.from('trades')
                .select('token_address,trade_direction,input_amount,output_amount,success,trade_status')
                .eq('experiment_id', exp.id).order('id', { ascending: true })
                .range(offset, offset + 999);
            if (error) throw new Error('trades: ' + error.message);
            trades.push(...data);
            if (data.length < 1000) break;
            offset += 1000;
        }
    }
    const pnl = pnlByToken(trades);
    console.log(`trades = ${trades.length}（买票 ${pnl.size}）`);

    // ④ 逐 token 复刻（并发拉 ticks；token_create 批查）
    const results = new Map(); // token → rec
    const tokens = tpaRows.map(r => r.token_address);
    const createMap = new Map();
    for (let i = 0; i < tokens.length; i += CHUNK) {
        const batch = tokens.slice(i, i + CHUNK);
        const { data: evs, error } = await sb.from('wss_events')
            .select('token_address,platform,payload').eq('kind', 'token_create').in('token_address', batch);
        if (error) throw new Error('events: ' + error.message);
        for (const ev of evs || []) if (!createMap.has(ev.token_address)) createMap.set(ev.token_address, ev);
    }

    let done = 0;
    async function workOne(row) {
        const token = row.token_address;
        const asOfIso = row.as_of;
        const ticks = await fetchAllTicks(sb, token, asOfIso);
        const st = initState(createMap.get(token) || null);
        for (const t of ticks) feedTick(st, t);
        const gs = gmgnStats(st);
        const shape = top20Shape(st);
        const hf = row.holding_factors || {};
        results.set(token, {
            asOf: asOfIso, verdict: row.verdict,
            tsB2: hf.TPAPre_tokenScore ?? null,
            gmgnUserPct: gs ? gs.gmgnUserPct : null,
            nonGmgnCount: gs ? gs.nonGmgnCount : null,
            ...shape, tickN: ticks.length,
            pnl: pnl.has(token) ? pnl.get(token).netWithOpen : null,
        });
        if (++done % 500 === 0) console.log(`  … ${done}/${tpaRows.length}`);
    }
    for (let i = 0; i < tpaRows.length; i += TICK_CONCURRENCY) {
        await Promise.all(tpaRows.slice(i, i + TICK_CONCURRENCY).map(workOne));
    }
    console.log(`复刻完成 ${results.size} 票\n`);

    // ── 输出 ①：gmgnUserPct 分布 ──
    const recs = [...results.values()].filter(r => r.gmgnUserPct != null);
    console.log('════════ ① gmgnUserPct 分布（量加权净持仓口径，N=' + recs.length + '）════════');
    const buckets = [[0, 0], [0.001, 20], [20, 40], [40, 50], [50, 60], [60, 70], [70, 80], [80, 99.999], [99.999, 100.001]];
    for (const [lo, hi] of buckets) {
        const n = recs.filter(r => r.gmgnUserPct >= lo && r.gmgnUserPct < hi
            && !(lo === 99.999 && r.gmgnUserPct > 100)).length;
        console.log(`  [${lo}, ${hi})${hi === 100.001 ? '含100' : ''}: ${n} 票`);
    }
    const pcts = recs.map(r => r.gmgnUserPct).sort((a, b) => a - b);
    if (pcts.length) console.log(`  p50=${f1(pct(pcts, 0.5))} p75=${f1(pct(pcts, 0.75))} p90=${f1(pct(pcts, 0.9))} max=${f1(pcts[pcts.length - 1])}`);

    // ── 输出 ②：豁免命中矩阵 ──
    console.log('\n════════ ② 豁免命中矩阵（exemptPct × 命中形状）════════');
    for (const p of PCTS) {
        const hit = recs.filter(r => r.gmgnUserPct >= p);
        const hitBlock = hit.filter(r => r.verdict === 'block');
        const hitApprove = hit.filter(r => r.verdict === 'approve');
        const withPnl = hit.filter(r => r.pnl != null);
        console.log(`  exemptPct=${p}: 命中 ${hit.length} 票（b2 verdict: block=${hitBlock.length} approve=${hitApprove.length}）`
            + ` | b2 有持仓 ${withPnl.length} 票净额 ${f2(sum(withPnl.map(r => r.pnl)))}`
            + ` | block 票（豁免会救回的）有持仓 ${hitBlock.filter(r => r.pnl != null).length}`);
    }

    // ── 输出 ③：top20 GMGN 占据度 ──
    console.log('\n════════ ③ top20 GMGN 占据度（全口径 top20 中 GMGN 钱包数分布）════════');
    for (const n of [0, 1, 2, 3, 4, 5, 10, 15, 20]) {
        const cnt = recs.filter(r => r.topGmgnCount === n).length;
        if (cnt) console.log(`  top20 含 GMGN ×${n}: ${cnt} 票`);
    }
    const highOcc = recs.filter(r => r.topGmgnCount >= 10);
    console.log(`  top20 GMGN ≥10 的票：${highOcc.length}（这些票 tokenScore 被 GMGN 散户画像主导）`);
    const vanish = recs.filter(r => r.afterCount === 0);
    console.log(`  剔除后净持仓者=0 的票：${vanish.length}（纯 GMGN 盘，tokenScore 会变 null）`);
    const shrink4 = recs.filter(r => r.afterCount < 4);
    console.log(`  剔除后 <4 的票：${shrink4.length}（触发门 minHolders=4 会拦/需豁免臂）`);

    // ── 输出 ④：点名票 ──
    console.log('\n════════ ④ 点名票验证 ════════');
    for (const pre of ['0x0ba340f0', '0xea075d64']) {
        const tok = tokens.find(t => t.startsWith(pre));
        if (!tok) { console.log(`  ${pre}…：不在 b2 TPA 行`); continue; }
        const r = results.get(tok);
        console.log(`  ${tok}\n    gmgnUserPct=${r.gmgnUserPct} 非GMGN=${r.nonGmgnCount} top20GMGN=${r.topGmgnCount} 剔除后=${r.afterCount} | b2 ts=${r.tsB2} verdict=${r.verdict} pnl=${r.pnl == null ? '无持仓' : f2(r.pnl)}`);
    }

    // ── 输出 ⑤：b2 内部分（命中 vs 未命中的实跑盈亏）──
    console.log('\n════════ ⑤ b2 实跑盈亏内部分（verdict=approve 且有持仓的票）════════');
    for (const p of PCTS) {
        const bought = recs.filter(r => r.pnl != null);
        const hitBought = bought.filter(r => r.gmgnUserPct >= p);
        const missBought = bought.filter(r => r.gmgnUserPct < p);
        const w = (a) => `${a.length} 票净 ${f2(sum(a.map(r => r.pnl)))}（胜 ${a.filter(r => r.pnl > 0).length}/${a.length}）`;
        console.log(`  exemptPct=${p}: 命中买入 ${w(hitBought)} | 未命中买入 ${w(missBought)}`);
    }
    console.log('\n  ⚠ block 票的假想盈亏（豁免救回的票会买成什么样）待 tnone 臂跑完后对拍（tnone = 去 tokenScore 门，其买入含全部豁免候选）');

    process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
