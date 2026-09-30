/**
 * news-monitor 表查询封装（twitter_events / hourly_reports / watch_accounts）。
 * client 走 dbManager（service key）——RLS enable 无 anon policy，anon 会被静默过滤。
 *
 * 查询纪律（poly-swing 教训，全部集中在本文件）：
 *   1. 不用 count:exact；
 *   2. 不做时间过滤（大表时间过滤必超时），一律 id 游标；
 *   3. limit 上限 1000。
 */
'use strict';

const { dbManager } = require('../services/dbManager');

function db() {
    return dbManager.getClient();
}

// ============ twitter_events ============

/** 去重插入。返回 { inserted }（source_event_id 冲突=服务端重推，静默忽略） */
async function insertEvent(row) {
    const { data, error } = await db()
        .from('twitter_events')
        .upsert(row, { onConflict: 'source_event_id', ignoreDuplicates: true })
        .select('id')
        .maybeSingle();
    if (error) throw new Error(`insertEvent: ${error.message}`);
    return { inserted: !!data, id: data?.id ?? null };
}

/** 当前最大事件 id（游标快照）。空表返回 null */
async function getMaxEventId() {
    const { data, error } = await db()
        .from('twitter_events')
        .select('id')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw new Error(`getMaxEventId: ${error.message}`);
    return data?.id ?? null;
}

/** 拉取 id ∈ (fromId, toId] 的全部事件（分页 1000/页）。fromId=null 表示从头 */
async function fetchEventsRange(fromId, toId) {
    const out = [];
    let cursor = fromId;
    while (true) {
        let q = db().from('twitter_events').select('*').order('id', { ascending: true }).limit(1000);
        if (cursor !== null && cursor !== undefined) q = q.gt('id', cursor);
        if (toId !== null && toId !== undefined) q = q.lte('id', toId);
        const { data, error } = await q;
        if (error) throw new Error(`fetchEventsRange: ${error.message}`);
        out.push(...data);
        if (data.length < 1000) break;
        cursor = data[data.length - 1].id;
    }
    return out;
}

/** 事件流（web）：id 倒序，beforeId 游标 */
async function fetchRecentEvents(beforeId, limit = 50) {
    let q = db().from('twitter_events').select('*').order('id', { ascending: false })
        .limit(Math.min(limit, 300));
    if (beforeId) q = q.lt('id', beforeId);
    const { data, error } = await q;
    if (error) throw new Error(`fetchRecentEvents: ${error.message}`);
    return data;
}

/** 报告关联事件：id ∈ [firstId, lastId] 升序 */
async function fetchEventsBetween(firstId, lastId, limit = 300) {
    const { data, error } = await db().from('twitter_events').select('*')
        .gte('id', firstId).lte('id', lastId)
        .order('id', { ascending: true })
        .limit(Math.min(limit, 300));
    if (error) throw new Error(`fetchEventsBetween: ${error.message}`);
    return data;
}

/** 分块 in 删除（in 列表超长会撑爆 PostgREST URL，块上限 1000） */
async function deleteIdsInChunks(ids, chunk = 1000) {
    let n = 0;
    for (let i = 0; i < ids.length; i += chunk) {
        const part = ids.slice(i, i + chunk);
        const { error } = await db().from('twitter_events').delete().in('id', part);
        if (error) throw new Error(`deleteIdsInChunks: ${error.message}`);
        n += part.length;
    }
    return n;
}

/**
 * 30 天滚动清理（原独立项目用 pg_cron；收编后改 daemon 每日任务，日志可见）。
 * id↔created_at 单调对应（bigserial 单写者）：按 id 升序取最老批，
 * 批尾仍老于 cutoff → 按 id 范围整批删（单条件无 URL 膨胀；乱序毫秒级误差可接受，
 * 临界行次日自然过期）；批尾新于 cutoff → 只精确清批内旧行后收工。
 * @returns 删除总行数
 */
async function purgeOldEvents(retainDays = 30, batchSize = 5000, maxBatches = 20) {
    const cutoff = new Date(Date.now() - retainDays * 86400_000).toISOString();
    let total = 0;
    for (let batch = 0; batch < maxBatches; batch++) {
        // 小结果集取最老批（不直接 where created_at < cutoff 全表扫：无时间索引必超时）
        const { data: rows, error: selErr } = await db()
            .from('twitter_events')
            .select('id, created_at')
            .order('id', { ascending: true })
            .limit(batchSize);
        if (selErr) throw new Error(`purgeOldEvents select: ${selErr.message}`);
        if (!rows || !rows.length) break;
        const newest = rows[rows.length - 1];
        if (newest.created_at >= cutoff) {
            // 批内可能仍有乱序旧行，精确清掉后收工
            const expired = rows.filter(r => r.created_at < cutoff);
            if (!expired.length) break;
            total += await deleteIdsInChunks(expired.map(r => r.id));
            break;
        }
        const { error: delErr } = await db()
            .from('twitter_events')
            .delete()
            .lte('id', newest.id);
        if (delErr) throw new Error(`purgeOldEvents delete: ${delErr.message}`);
        total += rows.length;
        if (rows.length < batchSize) break;   // 表已扫到尾
    }
    return total;
}

// ============ hourly_reports ============

/** 幂等写报告（window_start 冲突=重跑，静默忽略）。返回 { inserted } */
async function insertReport(row) {
    const { data, error } = await db()
        .from('hourly_reports')
        .insert(row)
        .select('id')
        .maybeSingle();
    if (error && error.code !== '23505') throw new Error(`insertReport: ${error.message}`);
    if (error && error.code === '23505') return { inserted: false, id: null };
    return { inserted: true, id: data?.id ?? null };
}

async function getLatestReport() {
    const { data, error } = await db()
        .from('hourly_reports')
        .select('*')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw new Error(`getLatestReport: ${error.message}`);
    return data ?? null;
}

/** 历史列表（仅元数据，不含正文） */
async function getReports(beforeId, limit = 30) {
    let q = db().from('hourly_reports')
        .select('id, window_start, window_end, first_event_id, last_event_id, event_count, llm_called, model, input_tokens, output_tokens, created_at')
        .order('id', { ascending: false })
        .limit(Math.min(limit, 100));
    if (beforeId) q = q.lt('id', beforeId);
    const { data, error } = await q;
    if (error) throw new Error(`getReports: ${error.message}`);
    return data;
}

async function getReport(id) {
    const { data, error } = await db()
        .from('hourly_reports')
        .select('*')
        .eq('id', id)
        .maybeSingle();
    if (error) throw new Error(`getReport: ${error.message}`);
    return data ?? null;
}

// ============ watch_accounts ============

/** 批量 upsert（onConflict handle，tier 变更自然覆盖） */
async function upsertAccounts(rows) {
    if (!rows.length) return;
    const { error } = await db()
        .from('watch_accounts')
        .upsert(rows, { onConflict: 'handle' });
    if (error) throw new Error(`upsertAccounts: ${error.message}`);
}

/** 监控账号数（web 状态条用；limit 200 数行数，不 count:exact） */
async function countWatchAccounts() {
    const { data, error } = await db()
        .from('watch_accounts')
        .select('handle')
        .limit(200);
    if (error) throw new Error(`countWatchAccounts: ${error.message}`);
    return data.length;
}

/** 删除不在名单内的 watch_accounts 行（sync 收缩时清理，表与监控面一致）。handles 必须非空 */
async function deleteAccountsExcept(handles) {
    if (!handles.length) throw new Error('deleteAccountsExcept: 名单为空，拒绝全表删除');
    const { data, error } = await db()
        .from('watch_accounts')
        .delete()
        .not('handle', 'in', `(${handles.join(',')})`)
        .select('handle');
    if (error) throw new Error(`deleteAccountsExcept: ${error.message}`);
    return data?.length ?? 0;
}

/** 全量账号（daemon 启动时建 tier 内存 Map） */
async function fetchAllAccounts() {
    const out = [];
    let cursor = null;
    while (true) {
        let q = db().from('watch_accounts').select('*').order('handle').limit(1000);
        if (cursor) q = q.gt('handle', cursor);
        const { data, error } = await q;
        if (error) throw new Error(`fetchAllAccounts: ${error.message}`);
        out.push(...data);
        if (data.length < 1000) break;
        cursor = data[data.length - 1].handle;
    }
    return out;
}

module.exports = {
    insertEvent,
    getMaxEventId,
    fetchEventsRange,
    fetchRecentEvents,
    fetchEventsBetween,
    purgeOldEvents,
    insertReport,
    getLatestReport,
    getReports,
    getReport,
    upsertAccounts,
    countWatchAccounts,
    deleteAccountsExcept,
    fetchAllAccounts,
};
