#!/usr/bin/env node
/**
 * GMGN 战壕（新币）采集覆盖对照
 *
 * 拉取 GMGN 战壕 BSC 两个类别（fourmeme/flap 两平台）：
 *   - new_creation  = 「已开盘」（bonding curve 交易中）
 *   - near_completion = 「即将打满」
 * 对照我方 wss_events kind='token_create'（token 级全局不挂实验，主判定证据），
 * miss 票再查 wss_price_ticks 辅助判定（注意：历史实验删除曾级联删 ticks，ticks miss ≠ 没采集过）。
 *
 * ⚠ 口径教训（2026-10-14 战壕对照案）：GMGN 的 created_timestamp 是「索引时间」，
 * 比链上真实创建晚最多 ~9 分钟——不能用它定位链上块窗；年龄/空洞分析一律以链上块为准。
 * 另：BSC 出块实测 0.45s/块（Maxwell 后），块↔时间换算勿用 0.75s 旧值。
 *
 * 用法：node scripts/check-gmgn-trenches-coverage.cjs [--limit 80]
 * 仅点查（地址 .in() 批 50 / 逐地址 head count），本地可跑。
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { GMGNMarketAPI, preResolveGMGNHost } = require('../src/core/gmgn-api');
const { dbManager } = require('../src/services/dbManager');

const CHAIN = 'bsc';
const OUR_PLATFORMS = ['fourmeme', 'flap'];
const KIND_LABEL = { new_creation: '已开盘', near_completion: '即将打满' };
const BATCH = 50; // Supabase .in() URL 8KB 红线内

function parseArgs() {
    const args = process.argv.slice(2);
    let limit = 80;
    const i = args.indexOf('--limit');
    if (i !== -1 && args[i + 1]) limit = parseInt(args[i + 1], 10) || 80;
    return { limit };
}

async function fetchTrenches(limit) {
    await preResolveGMGNHost();
    const api = new GMGNMarketAPI({ apiKey: process.env.GMGN_API_KEY });
    return api.getTrenches(CHAIN, ['new_creation', 'near_completion'], OUR_PLATFORMS, limit);
}

/** 批量点查 wss_events token_create，返回 Map<address, {platform, block_time}>（多行取最早） */
async function fetchCreateEvents(addresses) {
    const found = new Map();
    const client = dbManager.getClient();
    for (let i = 0; i < addresses.length; i += BATCH) {
        const batch = addresses.slice(i, i + BATCH);
        const { data, error } = await client.from('wss_events')
            .select('token_address, platform, block_time')
            .eq('kind', 'token_create')
            .in('token_address', batch);
        if (error) throw new Error(`wss_events 查询失败: ${error.message}`);
        for (const row of data || []) {
            const prev = found.get(row.token_address);
            if (!prev || (row.block_time && row.block_time < prev.block_time)) {
                found.set(row.token_address, { platform: row.platform, block_time: row.block_time });
            }
        }
    }
    return found;
}

/** 逐地址 head count 查 ticks 是否有行（存在性辅助证据） */
async function fetchTickPresence(addresses) {
    const has = new Map();
    const client = dbManager.getClient();
    for (const addr of addresses) {
        const { count, error } = await client.from('wss_price_ticks')
            .select('id', { head: true, count: 'exact' })
            .eq('token_address', addr);
        if (error) throw new Error(`wss_price_ticks 查询失败 (${addr}): ${error.message}`);
        has.set(addr, count || 0);
    }
    return has;
}

function fmtAge(min) {
    if (min < 60) return `${min}m`;
    if (min < 1440) return `${(min / 60).toFixed(1)}h`;
    return `${(min / 1440).toFixed(1)}d`;
}

async function main() {
    const { limit } = parseArgs();
    const nowSec = Math.floor(Date.now() / 1000);

    console.log(`[1/3] 拉取 GMGN 战壕（chain=${CHAIN}, platforms=${OUR_PLATFORMS.join('/')}, limit=${limit}）...`);
    const data = await fetchTrenches(limit);

    // 汇总 token（跨类去重，记录出现类别）
    const tokens = new Map();
    for (const kind of ['new_creation', 'near_completion']) {
        for (const t of data[kind] || []) {
            const addr = (t.address || '').toLowerCase();
            if (!addr) continue;
            const rec = tokens.get(addr) || {
                address: addr,
                symbol: t.symbol || '?',
                gmgnPlatform: t.launchpad_platform || '?',
                created_timestamp: t.created_timestamp,
                progress: t.progress,
                kinds: [],
            };
            rec.kinds.push(kind);
            tokens.set(addr, rec);
        }
    }
    const all = [...tokens.values()];
    console.log(`    GMGN 返回: 已开盘=${(data.new_creation || []).length} 即将打满=${(data.near_completion || []).length} 去重后=${all.length}`);

    console.log('[2/3] 对照 wss_events token_create ...');
    const createEvents = await fetchCreateEvents(all.map(t => t.address));

    console.log('[3/3] 对 miss 票查 wss_price_ticks 辅助证据 ...');
    const missed = all.filter(t => !createEvents.has(t.address));
    const tickPresence = missed.length ? await fetchTickPresence(missed.map(t => t.address)) : new Map();

    // ---- 报告 ----
    const lines = [];
    lines.push('\n===== 采集覆盖对照报告 =====');
    // 命中矩阵：类别 × gmgn 平台
    for (const kind of ['new_creation', 'near_completion']) {
        const sub = all.filter(t => t.kinds.includes(kind));
        for (const plat of OUR_PLATFORMS) {
            const platSub = sub.filter(t => t.gmgnPlatform === plat);
            const hit = platSub.filter(t => createEvents.has(t.address));
            lines.push(`${KIND_LABEL[kind]} × ${plat}: ${hit.length}/${platSub.length} 有 token_create` +
                (platSub.length && hit.length < platSub.length ? `  ⚠ miss ${platSub.length - hit.length}` : ''));
        }
    }

    // platform 口径不一致（GMGN 说 fourmeme，我方行是 flap 等）
    const platMismatch = all.filter(t => createEvents.has(t.address) &&
        createEvents.get(t.address).platform !== t.gmgnPlatform);
    if (platMismatch.length) {
        lines.push(`\n⚠ 平台口径不一致 ${platMismatch.length} 票:`);
        for (const t of platMismatch.slice(0, 10)) {
            lines.push(`  ${t.symbol} ${t.address} GMGN=${t.gmgnPlatform} 我方=${createEvents.get(t.address).platform}`);
        }
    }

    if (!missed.length) {
        lines.push('\n✅ 全部命中：GMGN 两类别代币均有 token_create 采集行。');
    } else {
        lines.push(`\n❌ token_create miss ${missed.length}/${all.length} 票明细:`);
        lines.push('  symbol | address | GMGN平台 | 年龄 | progress | ticks行数 | 类别');
        for (const t of missed) {
            const ageMin = t.created_timestamp ? Math.max(0, Math.round((nowSec - t.created_timestamp) / 60)) : -1;
            const ticks = tickPresence.get(t.address) ?? '?';
            const race = ageMin >= 0 && ageMin < 1 ? '（<1m，可能是采集竞态延迟）' : '';
            lines.push(`  ${t.symbol} | ${t.address} | ${t.gmgnPlatform} | ${ageMin >= 0 ? fmtAge(ageMin) : '?'} | ${t.progress ?? '?'} | ${ticks}${race} | ${t.kinds.map(k => KIND_LABEL[k]).join('+')}`);
        }
        lines.push('\n注：wss_price_ticks 有行=采集过价格（历史实验删除曾级联删旧 ticks，ticks=0 不必然等于没采集）；');
        lines.push('    miss 票创建时间早于当前实跑实验启动时间=当时无实验在跑（无实验运行期采集空洞属既定口径）。');
    }
    console.log(lines.join('\n'));
}

main().catch(e => {
    console.error('FAILED:', e.message);
    process.exit(1);
});
