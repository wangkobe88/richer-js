#!/usr/bin/env node
// ============================================================================
// 删除 created_at < 2026-10-14 的 9 个实验（用户 2026-10-28 裁定「全删」）
//   已核实：wss_price_ticks 归属 0 行、无 running、级联=trades/signals/tokens/TPA/手工单
//   防线：删前逐个复查 status≠running，是 running 则跳过该行
//   用法：node scripts/tmp-purge-old-experiments.cjs
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager.js');
const db = dbManager.getClient();

const IDS = [
    'a21fa102-aa00-4d98-b0d9-65f4a2323459',
    '2ad6a39b-9a61-4f6d-905e-54d1d1159d52',
    '4a7aa1ae-2b4b-4131-b61b-6d236a7d9d0c',
    '943f65ff-12c0-472d-8bed-10ee23e49885',
    '8863fb24-7fe6-44df-8c5f-830678086318',
    'd32f9d96-06b7-456b-8e49-25458eac2d29',
    '9bfa172f-ec3b-435a-abd7-a50ef541e57e',
    '2340315d-7863-4f4f-ba8b-58d85221910c',
    '94924a30-c17e-47a2-89bf-dd87c9a7f68c',
];

async function countWhere(table, filter) {
    let q = db.from(table).select('id', { count: 'exact', head: true });
    for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
    const { count, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    return count || 0;
}

async function main() {
    for (const id of IDS) {
        // 防线：删前复查该行存在且非 running
        const { data: row, error: qErr } = await db.from('experiments')
            .select('id, status, experiment_name').eq('id', id).single();
        if (qErr || !row) { console.log(`${id.slice(0, 8)}  SKIP（行不存在）`); continue; }
        if (row.status === 'running') { console.log(`${id.slice(0, 8)}  SKIP ★RUNNING 不删`); continue; }

        const { error } = await db.from('experiments').delete().eq('id', id);
        if (error) { console.log(`${id.slice(0, 8)}  DELETE 失败 ${error.message}`); continue; }
        console.log(`${id.slice(0, 8)}  DELETED  ${(row.experiment_name || '?').slice(0, 40)}`);
    }

    // 收尾核对
    const remain = await countWhere('experiments', {});
    const oldLeft = await db.from('experiments')
        .select('id', { count: 'exact', head: true }).lt('created_at', '2026-10-14T00:00:00Z');
    const idIn = await db.from('experiments').select('id', { count: 'exact', head: true }).in('id', IDS);
    console.log(`\n核对：experiments 剩余=${remain}，清单内残留=${idIn.count || 0}，created<10-14 残留=${oldLeft.count || 0}`);
    const [t, s] = await Promise.all([
        countWhere('trades', {}), countWhere('strategy_signals', {}),
    ]);
    console.log(`全表 trades=${t} signals=${s}`);
    process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
