#!/usr/bin/env node
// ============================================================================
// 只读：查指定实验竞速归属的 wss_price_ticks 行数（删实验行=级联删这些行）
//   用法：node scripts/tmp-ticks-per-exp.cjs <id1> <id2> ...
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager.js');
const db = dbManager.getClient();

async function main() {
    const ids = process.argv.slice(2);
    if (!ids.length) { console.error('用法: node tmp-ticks-per-exp.cjs <id...>'); process.exit(1); }
    for (const id of ids) {
        const { count, error } = await db.from('wss_price_ticks')
            .select('id', { count: 'exact', head: true }).eq('experiment_id', id);
        if (error) { console.log(`${id.slice(0, 8)}  ERROR ${error.message}`); continue; }
        console.log(`${id.slice(0, 8)}  wss_price_ticks=${count || 0}`);
    }
    process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
