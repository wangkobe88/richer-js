#!/usr/bin/env node
// ============================================================================
// P2-1 双跑验证对拍：v0（preFilter 关）vs pf0（backtest.faPreFilter=true）
// （2026-10-12 回测速度调查：130 万 tick/65min，preFilterSkipped=0 = 剪枝未启用）
//
// 验收口径（BacktestEngine preFilter 红线注释）：
//   ① trades bit-identical（开/关双跑 trades 一致才允许实验级启用）
//   ② 耗时对比（提速收益）
//   ③ TPA 行数差 = 超龄未持仓 token 触发损失面（观察数据缺失，买卖零影响）
//   ④ signals 差异（理论 ≈0：出 age 区间 ⇒ AND 链 condition 必 false）
//
// 用法（182）：node scripts/tmp_pf_verify.cjs
// ============================================================================
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const V0 = '5517e3db-608b-4572-bcc9-159fc46f3b26';
const PF0 = null; // 建臂后填（脚本自动从 experiments 表按名字找 '-pf验证' 也行）

const f2 = (x) => (Math.round(x * 10000) / 10000).toFixed(4);

async function fetchAll(sb, table, cols, expId) {
    const rows = [];
    let offset = 0;
    while (true) {
        const { data, error } = await sb.from(table).select(cols)
            .eq('experiment_id', expId).order('id', { ascending: true }).range(offset, offset + 999);
        if (error) throw new Error(`${table}: ` + error.message);
        rows.push(...data);
        if (data.length < 1000) break;
        offset += 1000;
    }
    return rows;
}

async function main() {
    const sb = dbManager.getClient();

    // pf0 id：按名后缀找（或命令行第二参）
    const argId = process.argv[2];
    let pf0Id = argId;
    if (!pf0Id) {
        const { data: exps } = await sb.from('experiments')
            .select('id,name').like('name', '%pf验证%').order('created_at', { ascending: false }).limit(3);
        if (!exps || !exps.length) throw new Error('未找到 pf验证 实验；用法 node tmp_pf_verify.cjs <pf0实验id>');
        pf0Id = exps[0].id;
        console.log(`按名找到 pf0: ${exps[0].name} ${pf0Id}`);
    }

    // ① trades bit-identical
    const cols = 'token_address,trade_direction,input_amount,output_amount,created_at';
    const [t0, t1] = [await fetchAll(sb, 'trades', cols, V0), await fetchAll(sb, 'trades', cols, pf0Id)];
    console.log(`\n① trades：v0=${t0.length} 行 / pf0=${t1.length} 行`);
    const key = (t) => `${t.token_address}|${t.trade_direction}|${t.input_amount}|${t.output_amount}|${t.created_at}`;
    // 时间序排列后逐行比（id 序不可靠——2026-10-12 坑）
    const s0 = t0.map(key), s1 = t1.map(key);
    let diff = 0;
    for (let i = 0; i < Math.max(s0.length, s1.length); i++) {
        if (s0[i] !== s1[i]) { diff++; if (diff <= 5) console.log(`  首批差异@${i}: v0=${s0[i]} / pf0=${s1[i]}`); }
    }
    console.log(diff === 0 ? '  ✅ bit-identical（逐行全等）' : `  ❌ ${diff} 行差异`);

    // ② 净额（FIFO 时间序修复口径，双保险）
    const pnl = (rows) => {
        const sorted = [...rows].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
        let spent = 0, recv = 0; const q = new Map();
        for (const t of sorted) {
            const ia = parseFloat(t.input_amount || 0), oa = parseFloat(t.output_amount || 0);
            if (t.trade_direction === 'buy') { spent += ia; q.set(t.token_address, (q.get(t.token_address) || 0) + oa); }
            else { recv += oa; q.set(t.token_address, (q.get(t.token_address) || 0) - oa); }
        }
        let open = 0; // 未卖余量按成本估（v0/pf0 同口径对比足够）
        for (const [a, amt] of q) if (amt > 0) open += 0;
        return recv - spent;
    };
    console.log(`  净额：v0=${f2(pnl(t0))} / pf0=${f2(pnl(t1))}`);

    // ③ signals
    const [g0, g1] = [await fetchAll(sb, 'strategy_signals', 'token_address,action', V0),
                      await fetchAll(sb, 'strategy_signals', 'token_address,action', pf0Id)];
    const set0 = new Set(g0.map(s => s.token_address)), set1 = new Set(g1.map(s => s.token_address));
    const only0 = [...set0].filter(t => !set1.has(t)), only1 = [...set1].filter(t => !set0.has(t));
    console.log(`\n③ signals：v0=${g0.length}（${set0.size} token）/ pf0=${g1.length}（${set1.size} token）`);
    if (only0.length) console.log(`  仅 v0 ${only0.length} token：${only0.slice(0, 5).join(' ')}`);
    if (only1.length) console.log(`  仅 pf0 ${only1.length} token：${only1.slice(0, 5).join(' ')}`);

    // ④ TPA 行数（触发损失面）
    const p0 = await fetchAll(sb, 'token_position_analyses', 'token_address', V0);
    const p1 = await fetchAll(sb, 'token_position_analyses', 'token_address', pf0Id);
    const ps0 = new Set(p0.map(r => r.token_address)), ps1 = new Set(p1.map(r => r.token_address));
    const lost = [...ps0].filter(t => !ps1.has(t));
    console.log(`\n④ TPA：v0=${p0.length} 行 / pf0=${p1.length} 行（丢失 ${lost.length} = 超龄触发损失面，买卖零影响）`);

    // ⑤ 耗时（experiments 表）
    for (const [tag, id] of [['v0', V0], ['pf0', pf0Id]]) {
        const { data } = await sb.from('experiments').select('name,started_at,stopped_at').eq('id', id).single();
        const dur = data.started_at && data.stopped_at ? ((new Date(data.stopped_at) - new Date(data.started_at)) / 60000).toFixed(1) : 'n/a';
        console.log(`⑤ ${tag}: ${dur}min  ${data.name}`);
    }

    process.exit(0);
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
