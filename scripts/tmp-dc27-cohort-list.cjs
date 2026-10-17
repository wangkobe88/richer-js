#!/usr/bin/env node
/**
 * 临时脚本：拉同期 flap token_create 清单（2026-10-15 00:00 → 现在）——本地轻查询
 */
const { dbManager } = require('../src/services/dbManager');

async function main() {
    const db = dbManager.getClient();
    const rows = [];
    let lastId = null;
    // wss_events 低频：按 id 降序拉最近行，内存过滤 kind/platform/时间（block_time 范围过滤会超时）
    for (;;) {
        let q = db
            .from('wss_events')
            .select('id,token_address,kind,platform,payload,block_time,created_at')
            .order('id', { ascending: false })
            .limit(1000);
        if (lastId !== null) q = q.lt('id', lastId);
        const { data, error } = await q;
        if (error) throw error;
        rows.push(...data);
        if (data.length < 1000) break;
        lastId = data[data.length - 1].id;
        // 拉到 2026-10-15 之前就停
        if (new Date(data[data.length - 1].created_at) < new Date('2026-10-15T00:00:00Z')) break;
    }
    const filtered = rows.filter(r =>
        r.kind === 'token_create' && r.platform === 'flap' &&
        r.block_time >= '2026-10-15' && r.block_time < '2026-10-18');
    rows.length = 0; rows.push(...filtered);
    // token_create 可能重复（多实验并发各写一份）——按 token 去重取最早
    const byToken = new Map();
    for (const r of rows) {
        const t = r.token_address;
        if (!t) continue;
        if (!byToken.has(t)) byToken.set(t, r);
    }
    console.log(`flap token_create rows=${rows.length} unique tokens=${byToken.size}`);
    // 时间分布（每小时）
    const byHour = new Map();
    for (const r of byToken.values()) {
        const h = (r.block_time || '').slice(0, 13);
        byHour.set(h, (byHour.get(h) || 0) + 1);
    }
    for (const [h, n] of [...byHour.entries()].sort()) console.log(`${h}h  ${n}`);
    // Rocketcar 所在小时的清单里 taxToken / quote 情况
    const rc = byToken.get('0xdc27f4256efafc5b979fa89aeea83efd1d797777');
    console.log('\nRocketcar create:', rc ? rc.block_time : 'NOT IN WINDOW');
    require('fs').writeFileSync('/tmp/dc27-cohort-tokens.json',
        JSON.stringify([...byToken.values()].map(r => ({
            token: r.token_address, ts: r.block_time,
            tax: !!(r.payload && r.payload.taxToken),
            creator: r.payload && r.payload.creator,
        })), null, 0));
    console.log('saved /tmp/dc27-cohort-tokens.json');
    dbManager.cleanup();
}
main().catch(e => { console.error(e); process.exit(1); });
