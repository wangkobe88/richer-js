// 8aca25e2 对拍终审：回填后双口径 top1 → 翻案清单 + 假想盈亏（2026-09-30 ②号修复第二步）
//
// 翻案 = 首 90s 窗 trader 口径 top1≥60（当时被拦）且 sender 口径(COALESCE) top1<60（现在该放行）。
// 盈亏三口径（每翻案 token 一票，按首个被拦 signal 时刻假想买入 buyAmt=perCardBNB×cards）：
//   TP 口径：+30% 卖一半、+50% 清尾、未触发期末估值，双边费 1%（主口径）
//   期末口径：持有到 30min 观察窗末（保守）
//   峰值口径：满仓吃最高点（不可实现上限，仅参考）
// 对照组：仍被拦（真实主导 sender 口径仍≥60）同样算——验证门继续拦的票质量。
'use strict';
require('dotenv').config({ path: '/home/ubuntu/richer-js/config/.env' });
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager');

const EXP = '8aca25e2-7baf-421d-9a6a-6698d85d977d';
const FEE = 0.01;          // 双边费 ~1%（flap 0.5%×2 近似）
const R1 = 1.3, R2 = 1.5;  // 简化止盈档（策略 default：+30% 卖 50%、+50% 清仓）
const HOLD_MS = 30 * 60 * 1000; // 30min 观察窗

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function main() {
    const c = dbManager.getClient();

    // 买入金额：config perCardBNB × buy 首腿 cards
    const { data: exp, error: eErr } = await c.from('experiments').select('config').eq('id', EXP).single();
    if (eErr) throw new Error(eErr.message);
    const pm = exp.config?.positionManagement || {};
    const buyLegs = exp.config?.strategiesConfig?.buyStrategies || [];
    const cards = buyLegs.reduce((m, l) => Math.max(m, l.cards || 1), 0) || 1;
    const buyAmt = (pm.perCardBNB || 0) * cards;
    console.log(`买入规格: perCardBNB=${pm.perCardBNB} × cards=${cards} = ${buyAmt} BNB/票`);

    // 已买 token 清单（翻案票与已实现盈亏的交集标注用）
    const { data: bought } = await c.from('trades').select('token_address').eq('experiment_id', EXP).eq('trade_direction', 'buy');
    const boughtSet = new Set((bought || []).map(t => t.token_address));

    // 被拦 signals
    const { data: sigs, error: sErr } = await c.from('strategy_signals')
        .select('token_address,created_at,metadata->preBuyCheckFactors->earlyTradesTop1BuySharePct')
        .eq('experiment_id', EXP).eq('action', 'buy').limit(3000);
    if (sErr) throw new Error(sErr.message);
    const blocked = sigs.filter(s => (s.earlyTradesTop1BuySharePct ?? -1) >= 60);
    const byToken = new Map();
    for (const s of blocked) {
        const cur = byToken.get(s.token_address);
        if (!cur) byToken.set(s.token_address, { n: 1, firstAt: s.created_at, oldTop1: s.earlyTradesTop1BuySharePct });
        else if (s.created_at < cur.firstAt) byToken.set(s.token_address, { ...cur, n: cur.n + 1, firstAt: s.created_at });
        else byToken.set(s.token_address, { ...cur, n: cur.n + 1 });
    }
    const tokens = [...byToken.keys()];
    log(`被拦 signal ${blocked.length} 个 / token ${tokens.length} 个`);

    // 锚 + 首窗行
    const anchor = new Map();
    for (let i = 0; i < tokens.length; i += 100) {
        const { data: evs, error } = await c.from('wss_events').select('token_address,block_time')
            .eq('kind', 'token_create').in('token_address', tokens.slice(i, i + 100));
        if (error) throw new Error(error.message);
        for (const e of evs) {
            const prev = anchor.get(e.token_address);
            if (!prev || (e.block_time && e.block_time < prev)) anchor.set(e.token_address, e.block_time);
        }
    }

    const verdicts = [];
    for (const tok of tokens) {
        const t = anchor.get(tok);
        if (!t) continue;
        const to = new Date(new Date(t).getTime() + 90 * 1000).toISOString();
        const { data: rows, error } = await c.from('wss_price_ticks')
            .select('trader_address,sender_address,bnb_amount')
            .eq('token_address', tok).eq('trade_type', 'buy')
            .gte('block_time', t).lt('block_time', to).limit(2000);
        if (error) throw new Error(error.message);
        if (!rows.length) continue;
        const aggTrader = new Map(), aggSender = new Map();
        let tot = 0;
        for (const r of rows) {
            const v = r.bnb_amount || 0; tot += v;
            aggTrader.set(r.trader_address, (aggTrader.get(r.trader_address) || 0) + v);
            const s = r.sender_address || r.trader_address;
            aggSender.set(s, (aggSender.get(s) || 0) + v);
        }
        if (tot <= 0) continue;
        const topTrader = Math.max(...aggTrader.values()) / tot * 100;
        const topSender = Math.max(...aggSender.values()) / tot * 100;
        const info = byToken.get(tok);
        verdicts.push({ tok, n: info.n, firstAt: info.firstAt, oldTop1: info.oldTop1, topTrader, topSender, alreadyBought: boughtSet.has(tok) });
    }

    const flipped = verdicts.filter(v => v.topTrader >= 60 && v.topSender < 60);
    const stillBlocked = verdicts.filter(v => v.topTrader >= 60 && v.topSender >= 60);
    const wasOk = verdicts.filter(v => v.topTrader < 60); // 存的 signal 值 ≥60 但重算 <60（窗口口径差）
    log(`判定: 翻案 ${flipped.length} / 仍拦 ${stillBlocked.length} / 重算口径差 ${wasOk.length}`);

    // ---- 盈亏模拟 ----
    async function simulate(v) {
        // 买价 = 首个被拦 signal created_at 前最近 tick
        const { data: bt } = await c.from('wss_price_ticks')
            .select('price_bnb,id').eq('token_address', v.tok).lte('block_time', v.firstAt)
            .order('id', { ascending: false }).limit(1);
        if (!bt || !bt.length || !bt[0].price_bnb) return null;
        const buyPrice = bt[0].price_bnb;
        const afterId = bt[0].id;
        const to = new Date(new Date(v.firstAt).getTime() + HOLD_MS).toISOString();
        const { data: ticks } = await c.from('wss_price_ticks')
            .select('price_bnb').eq('token_address', v.tok)
            .gt('id', afterId).lt('block_time', to).order('id', { ascending: true }).limit(5000);
        if (!ticks || !ticks.length) return null;
        let peak = 0, end = 0, hit1 = false, hit2 = false;
        for (const t of ticks) {
            const p = t.price_bnb; if (!p) continue;
            if (p > peak) peak = p;
            end = p;
            if (!hit1 && p >= buyPrice * R1) hit1 = true;
            if (p >= buyPrice * R2) hit2 = true;
        }
        const tpFactor = hit2 ? 0.5 * R1 + 0.5 * R2 : hit1 ? 0.5 * R1 + 0.5 * (end / buyPrice) : end / buyPrice;
        const tpNet = buyAmt * tpFactor * (1 - FEE) - buyAmt;
        const endNet = buyAmt * (end / buyPrice) * (1 - FEE) - buyAmt;
        const peakNet = buyAmt * (peak / buyPrice) * (1 - FEE) - buyAmt;
        return { buyPrice, peakPct: (peak / buyPrice - 1) * 100, endPct: (end / buyPrice - 1) * 100, tpNet, endNet, peakNet, ticks: ticks.length };
    }

    async function runGroup(name, list) {
        let tp = 0, endS = 0, peak = 0, ok = 0, overlap = 0;
        const details = [];
        for (const v of list) {
            const r = await simulate(v);
            if (!r) continue;
            ok++;
            tp += r.tpNet; endS += r.endNet; peak += r.peakNet;
            if (v.alreadyBought) overlap++;
            details.push({ tok: v.tok.slice(0, 10), old: v.topTrader.toFixed(0), neu: v.topSender.toFixed(1), peak: r.peakPct.toFixed(0) + '%', end: r.endPct.toFixed(0) + '%', tpBNB: r.tpNet.toFixed(4), sig: v.n, re: v.alreadyBought ? 'Y' : '' });
        }
        console.log(`\n===== ${name}: ${ok}/${list.length} 票完成模拟（与已买交集 ${overlap}）=====`);
        console.log(`假想净效应(BNB): TP口径 ${tp.toFixed(3)} | 期末口径 ${endS.toFixed(3)} | 峰值口径 ${peak.toFixed(3)}`);
        console.log(`单票均值(BNB): TP ${(tp / (ok || 1)).toFixed(4)} | 期末 ${(endS / (ok || 1)).toFixed(4)}`);
        details.sort((a, b) => parseFloat(b.tpBNB) - parseFloat(a.tpBNB));
        console.log('TOP15（按TP口径）: old=旧top1% neu=新top1% sig=被拦signal数 re=已买交集');
        for (const d of details.slice(0, 15)) console.log('  ', JSON.stringify(d));
        const losers = details.filter(d => parseFloat(d.tpBNB) < 0).length;
        console.log(`TP口径亏损票: ${losers}/${ok}`);
        return { tp, endS, peak, ok };
    }

    await runGroup('翻案（当时该买）', flipped);
    await runGroup('仍拦（真实主导，门继续拦对的）', stillBlocked);
    process.exit(0);
}
main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
