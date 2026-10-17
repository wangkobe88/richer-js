#!/usr/bin/env node
/**
 * 临时脚本：0xdc27…7777 基本信息（本地轻查询：单 token 事件行 + tick 计数）
 */
const { dbManager } = require('../src/services/dbManager');

const TOKEN = '0xdc27f4256efafc5b979fa89aeea83efd1d797777';

async function main() {
    const db = dbManager.getClient();

    // 1) wss_events：token_create / graduation（低频事件通道，几行）
    const { data: events, error: evErr } = await db
        .from('wss_events')
        .select('kind,platform,block_time,payload,created_at')
        .eq('token_address', TOKEN)
        .order('created_at', { ascending: true })
        .limit(20);
    if (evErr) throw evErr;
    console.log('=== wss_events (%d rows) ===', events.length);
    for (const ev of events) {
        console.log(JSON.stringify({
            kind: ev.kind,
            platform: ev.platform,
            block_time: ev.block_time,
            payload: ev.payload,
        }));
    }

    // 2) ticks 基本统计（单 token count + 时间范围——索引扫描，轻）
    const { count, error: cErr } = await db
        .from('wss_price_ticks')
        .select('id', { count: 'exact', head: true })
        .eq('token_address', TOKEN);
    if (cErr) throw cErr;
    console.log('\n=== wss_price_ticks count ===', count);

    if (count > 0) {
        const { data: first } = await db
            .from('wss_price_ticks')
            .select('block_time,price_bnb,block_number')
            .eq('token_address', TOKEN)
            .order('block_number', { ascending: true })
            .limit(1);
        const { data: last } = await db
            .from('wss_price_ticks')
            .select('block_time,price_bnb,block_number')
            .eq('token_address', TOKEN)
            .order('block_number', { ascending: false })
            .limit(1);
        console.log('first tick:', JSON.stringify(first && first[0]));
        console.log('last  tick:', JSON.stringify(last && last[0]));
    }

    // 3) 叙事缓存行（如果有）
    const { data: narr } = await db
        .from('token_narrative')
        .select('final_rating,max_rating,pre_check_result,category,created_at,updated_at')
        .eq('token_address', TOKEN)
        .limit(2);
    console.log('\n=== token_narrative ===', narr && narr.length ? JSON.stringify(narr[0], null, 1) : '(none)');

    dbManager.cleanup();
}

main().catch(e => { console.error(e); process.exit(1); });
