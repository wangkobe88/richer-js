#!/usr/bin/env node
// ============================================================================
// 只读：列出 created_at 在两周前的实验 + 各归属表数据量（不动任何行）
//   用法：node scripts/tmp-list-old-experiments.cjs [--days 14]
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager.js');
const db = dbManager.getClient();

const DAYS = Number(process.argv.includes('--days')
    ? process.argv[process.argv.indexOf('--days') + 1] : 14);
const CUTOFF = new Date(Date.now() - DAYS * 86400e3).toISOString();
const NOW = new Date().toISOString();
console.log(`现在=${NOW}  界限=created_at < ${CUTOFF}（${DAYS} 天前）\n`);

async function count(table, expId, extra) {
    let q = db.from(table).select('id', { count: 'exact', head: true }).eq('experiment_id', expId);
    if (extra) q = extra(q);
    const { count: c, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    return c || 0;
}

async function main() {
    const { data: exps, error } = await db.from('experiments')
        .select('*').lt('created_at', CUTOFF).order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    if (!exps.length) { console.log('无两周前的实验'); return; }

    console.log(`两周前实验共 ${exps.length} 个：\n`);
    for (const e of exps) {
        const [trades, signals, tokens, rounds, evts] = await Promise.all([
            count('trades', e.id),
            count('strategy_signals', e.id),
            count('experiment_tokens', e.id),
            count('narrative_analysis_rounds', e.id),
            count('experiment_events', e.id),
        ]);
        const flags = [];
        if (e.status === 'running') flags.push('★RUNNING');
        if (trades > 0) flags.push(`trades=${trades}`);
        if (signals > 0) flags.push(`signals=${signals}`);
        console.log([
            `#${e.id}`,
            `${(e.experiment_name || e.name || '?').slice(0, 40)}`,
            `created=${(e.created_at || '').slice(0, 10)}`,
            `status=${e.status}`,
            `mode=${e.mode || e.experiment_mode || '?'}`,
            `chain=${e.blockchain || '?'}`,
            `tokens=${tokens} rounds=${rounds} evts=${evts}`,
            flags.length ? `[${flags.join(' ')}]` : '',
        ].join('  '));
    }
    process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
