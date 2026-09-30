/**
 * 三方同步器：Google Sheet（元数据源）+ news-watchlist.json（名单真相）↔ 6551 服务端
 * watch 列表 ↔ watch_accounts 表。
 *
 * 顺序固定：拉 Sheet（失败→整轮放弃，绝不在旧数据上增删）→ 白名单过滤（名单有
 * Sheet 里找不到的 handle → 抛错放弃）→ listWatched → diff → 逐个 add（300ms 间隔，
 * 配额错误立即停止）/ delete（以名单为准，逐条 WARN）→ upsert watch_accounts +
 * 删除表内名单外行。幂等：无 diff 时 0 次写 API 调用。
 */
'use strict';

const { logger } = require('./logs');
const store = require('./store');

const ADD_INTERVAL_MS = 300;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ============ 6551 REST 客户端（监控列表管理） ============

class WatchApiError extends Error {
    constructor(message, { status, body } = {}) {
        super(message);
        this.name = 'WatchApiError';
        this.status = status;
        this.body = body;
    }
}

/** 配额类错误判定（message/body 里带这些词 → 调用方应停止后续 add） */
function isQuotaError(err) {
    if (!(err instanceof WatchApiError)) return false;
    const s = `${err.message} ${typeof err.body === 'string' ? err.body : JSON.stringify(err.body || '')}`.toLowerCase();
    return /limit|quota|exceed|maximum|too many|上限|限制|每日|最多|明日|try again tomorrow/.test(s);
}

async function post(apiBase, token, path, body) {
    let res;
    try {
        res = await fetch(`${apiBase}${path}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(30000),
        });
    } catch (err) {
        if (err.name === 'AbortError') throw new WatchApiError(`${path} 超时`);
        throw new WatchApiError(`${path} 网络错误: ${err.message}`);
    }
    const text = await res.text();
    if (!res.ok) {
        throw new WatchApiError(`${path} HTTP ${res.status}: ${text.slice(0, 300)}`, {
            status: res.status,
            body: text.slice(0, 1000),
        });
    }
    try {
        return JSON.parse(text);
    } catch {
        return { _raw: text };
    }
}

/** 查询当前监控列表 → Set<username 服务端原样> */
async function listWatched(apiBase, token) {
    const json = await post(apiBase, token, '/open/twitter_watch', {});
    // 容错解析：兼容 {data:[...]} / {list:[...]} / {result:[...]} / 裸数组；
    // 数组元素可能是字符串或 {username|twAccount|account: "..."} 对象
    let arr = null;
    if (Array.isArray(json)) arr = json;
    else if (json && typeof json === 'object') {
        for (const key of ['data', 'list', 'result', 'rows', 'records']) {
            if (Array.isArray(json[key])) { arr = json[key]; break; }
        }
    }
    if (!arr) {
        logger.warn('listWatched 响应结构未知，打印原文以确认', { raw: JSON.stringify(json).slice(0, 500) });
        return new Set();
    }
    const names = new Set();
    for (const item of arr) {
        const name = typeof item === 'string'
            ? item
            : item?.username ?? item?.twAccount ?? item?.account ?? null;
        if (name) names.add(name);
    }
    return names;
}

/**
 * 添加监控账号。12 个事件开关全开——tier 是 Sheet 侧自定义分层，
 * 筛选全部放在入库侧（否则核心账号的关注信号会在服务端被永久丢弃）。
 */
async function addWatch(apiBase, token, username) {
    return post(apiBase, token, '/open/twitter_watch_add', {
        username,
        newTweetBol: true,
        newFlwBol: true,
        newUnFlwBol: true,
        newTweetReplyBol: true,
        newTweetQuoteBol: true,
        newRetweetBol: true,
        updateNameBol: true,
        updateDescBol: true,
        updateAvatarBol: true,
        updateBannerBol: true,
        newCaBol: true,
        tweetToppingBol: true,
    });
}

async function deleteWatch(apiBase, token, username) {
    return post(apiBase, token, '/open/twitter_watch_delete', { username });
}

// ============ Google Sheet CSV 拉取 + 解析 ============
//
// Sheet 结构（实测）：首行表头，行内推特 URL 列（B 或 C，布局随 sheet 不同），
// 右边一格=名字、再右边=级别（标「核心」→ core）。列位置自适应找 URL 列。
// 纪律：fetch 失败直接抛错——绝不返回缓存旧数据（旧数据上做增删 watch 是灾难）。

function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { cell += '"'; i++; }
                else inQuotes = false;
            } else cell += c;
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            row.push(cell); cell = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(cell); cell = '';
            if (row.some(x => x !== '')) rows.push(row);
            row = [];
        } else cell += c;
    }
    row.push(cell);
    if (row.some(x => x !== '')) rows.push(row);
    return rows;
}

/** x.com/twitter.com/@ 各种前缀 → 小写 handle；无法识别返回 null */
function extractHandle(cell) {
    if (!cell) return null;
    const s = cell.trim();
    const m = s.match(/^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/(@?[A-Za-z0-9_]{1,15})\/?$/i)
        || s.match(/^@?([A-Za-z0-9_]{1,15})$/);
    if (!m) return null;
    return m[1].replace(/^@/, '').toLowerCase();
}

/**
 * 按显式白名单（news-watchlist.json）过滤账号，并附加 ecosystem 标签。
 *
 * 条目两种形式：
 *   "handle"           —— 必须在 Sheet 里命中（防拼写错误静默缩面，找不到抛错）
 *   {handle, name}     —— 自带元数据的对象条目（Sheet 里没有的大号，如 AI 巨头），
 *                          Sheet 命中则用 Sheet 元数据覆盖 name，否则用自带 name
 * @param {Array<{handle, handleRaw, displayName, tier}>} accounts
 * @param {Object<string, Array<string|{handle,name}>>} watchlist
 */
function filterByWatchlist(accounts, watchlist) {
    const byHandle = new Map(accounts.map(a => [a.handle, a]));
    const out = [];
    const missing = [];
    for (const [eco, entries] of Object.entries(watchlist)) {
        for (const entry of entries) {
            const isObj = typeof entry === 'object' && entry !== null;
            const handle = String(isObj ? entry.handle : entry).toLowerCase();
            const sheet = byHandle.get(handle);
            if (sheet) {
                out.push({ ...sheet, ecosystem: eco });
            } else if (isObj) {
                // 对象条目自带元数据，不依赖 Sheet
                out.push({
                    handle,
                    handleRaw: entry.handle,
                    displayName: entry.name || null,
                    tier: 'normal',
                    ecosystem: eco,
                });
            } else {
                missing.push(handle);
            }
        }
    }
    if (missing.length) {
        throw new Error(`watchlist 中的账号在 Sheet 里找不到: ${missing.join(', ')}（检查 news-watchlist.json 拼写或 Sheet 内容；不在 Sheet 的账号用 {handle,name} 对象条目）`);
    }
    return out;
}

/**
 * 拉取并解析 Sheet（多个 CSV URL，跨 sheet 重复 handle 以先出现为准）。
 * @param {string[]} csvUrls
 * @returns {Promise<Array<{handle, handleRaw, displayName, tier}>>}
 */
async function fetchSheetAccounts(csvUrls) {
    const accounts = [];
    const seen = new Map();
    for (const csvUrl of csvUrls) {
        const res = await fetch(csvUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 news-monitor' },
            redirect: 'follow',
            signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) throw new Error(`Sheet HTTP ${res.status} (${csvUrl})`);
        const text = await res.text();
        if (text.trimStart().startsWith('<')) {
            throw new Error('Sheet 返回 HTML（可能登录墙/权限变更），非 CSV');
        }
        const rows = parseCsv(text);
        if (rows.length < 2) throw new Error(`Sheet 行数异常: ${rows.length} (${csvUrl})`);

        let parsed = 0;
        for (let i = 1; i < rows.length; i++) {  // 跳过表头
            const cols = rows[i];
            // 列位置自适应：找行内推特 URL 列，右边一格=名字、再右边=级别
            const urlIdx = cols.findIndex(c => /(?:twitter|x)\.com\//i.test(c || ''));
            if (urlIdx === -1) continue;   // 无 URL 的行（分区标题等）静默跳过
            const handle = extractHandle(cols[urlIdx]);
            if (!handle) {
                logger.warn('Sheet 行无法解析 handle，跳过', { row: i + 1, cell: cols[urlIdx], sheet: csvUrl });
                continue;
            }
            if (seen.has(handle)) {
                logger.warn('Sheet 重复 handle，以先出现为准', { handle, row: i + 1, sheet: csvUrl });
                continue;
            }
            seen.set(handle, true);
            parsed++;
            const tierRaw = (cols[urlIdx + 2] || '').trim();
            accounts.push({
                handle,
                handleRaw: (cols[urlIdx].match(/([A-Za-z0-9_]{1,15})\/?$/)?.[1]) || handle,
                displayName: (cols[urlIdx + 1] || '').trim() || null,
                tier: tierRaw.includes('核心') ? 'core' : 'normal',
            });
        }
        if (parsed < 10) {
            throw new Error(`Sheet 解析结果异常（仅 ${parsed} 个账号，${csvUrl}）——疑似列结构变更`);
        }
        logger.info('Sheet 拉取成功', { url: csvUrl, accounts: parsed });
    }
    return accounts;
}

// ============ 三方同步主流程 ============

/**
 * @returns {{sheetCount, added: string[], deleted: string[], quotaHit: boolean, failedAdds: string[], accounts: Array}}
 */
async function runSync({ apiBase, wssToken, sheetCsvUrls, watchlist }) {
    // 1. Sheet 是元数据源——失败即放弃本轮
    let allAccounts;
    try {
        allAccounts = await fetchSheetAccounts(sheetCsvUrls);
    } catch (err) {
        logger.error('Sheet 拉取失败，本轮同步整体放弃（watch 状态保持上轮）', { err: err.message });
        throw err;
    }
    // 2. 名单过滤（watchlist 里有 Sheet 找不到的 → 抛错，绝不静默缩面）
    const accounts = filterByWatchlist(allAccounts, watchlist);
    const sheetTotal = allAccounts.length;
    const coreCount = accounts.filter(a => a.tier === 'core').length;

    // 3. 服务端现状
    let serverNames;
    try {
        serverNames = await listWatched(apiBase, wssToken);
    } catch (err) {
        logger.error('listWatched 失败，本轮同步整体放弃', { err: err.message });
        throw err;
    }

    // 4. diff（按小写比较；服务端可能存原样大小写）
    const serverLower = new Map();
    for (const n of serverNames) serverLower.set(n.toLowerCase(), n);
    const sheetHandles = new Set(accounts.map(a => a.handle));
    const toAdd = accounts.filter(a => !serverLower.has(a.handle));
    const toDel = [...serverLower.entries()]
        .filter(([lower]) => !sheetHandles.has(lower))
        .map(([, raw]) => raw);

    logger.info('同步开始', {
        sheet: accounts.length, core: coreCount, server: serverNames.size,
        toAdd: toAdd.length, toDel: toDel.length,
    });

    // 5. 增（配额错误立即停止，保留已成功）
    const added = [];
    const failedAdds = [];
    let quotaHit = false;
    for (const acct of toAdd) {
        try {
            await addWatch(apiBase, wssToken, acct.handleRaw);
            added.push(acct.handle);
            logger.info('watch_add 成功', { handle: acct.handleRaw, progress: `${added.length}/${toAdd.length}` });
        } catch (err) {
            // 「已在监控列表」= 服务端存的原样大小写/旧名与本地小写 diff 不上，实际已监控，
            // 按已存在处理（否则账号改名场景每小时误报 ERROR）
            if (err instanceof WatchApiError && /已在监控列表/.test(String(err.body || err.message))) {
                added.push(acct.handle);
                logger.info('watch_add 返回已在监控列表，按已存在处理', { handle: acct.handleRaw });
                continue;
            }
            if (err instanceof WatchApiError && isQuotaError(err)) {
                quotaHit = true;
                logger.error('watch_add 疑似配额/上限错误，停止后续 add（需要人工决策：升套餐或裁列表）', {
                    handle: acct.handleRaw, err: err.message,
                });
                break;
            }
            failedAdds.push(acct.handle);
            logger.error('watch_add 失败，继续下一个', { handle: acct.handleRaw, err: err.message });
        }
        if (toAdd.indexOf(acct) < toAdd.length - 1) await sleep(ADD_INTERVAL_MS);
    }
    if (quotaHit || failedAdds.length) {
        const remaining = toAdd.map(a => a.handle)
            .filter(h => !added.includes(h) && !failedAdds.includes(h));
        logger.error('add 阶段汇总', { added: added.length, failed: failedAdds, quotaHit, 未尝试: remaining });
    }

    // 6. 删（服务端多余=有人后台手动加过，以 Sheet 为准清理）
    const deleted = [];
    for (const raw of toDel) {
        let ok = false;
        for (let i = 0; i <= 1 && !ok; i++) {   // 重试 1 次
            try {
                await deleteWatch(apiBase, wssToken, raw);
                ok = true;
            } catch (err) {
                if (i === 1) logger.error('watch_delete 失败（重试后仍失败）', { handle: raw, err: err.message });
                else await sleep(1000);
            }
        }
        if (ok) {
            deleted.push(raw.toLowerCase());
            logger.warn('watch_delete（服务端多余账号，以 Sheet 为准）', { handle: raw });
        }
    }

    // 7. upsert watch_accounts（in_watch_list：本就在服务端或 add 成功的为 true；失败/未尝试如实 false）
    //    + 清理名单外旧行
    const inServer = new Set([...serverLower.keys(), ...added]);
    const rows = accounts.map(a => ({
        handle: a.handle,
        handle_raw: a.handleRaw,
        display_name: a.displayName,
        tier: a.tier,
        in_watch_list: inServer.has(a.handle),
        sheet_synced_at: new Date().toISOString(),
    }));
    await store.upsertAccounts(rows);
    const removedRows = await store.deleteAccountsExcept(accounts.map(a => a.handle));
    if (removedRows > 0) logger.warn('watch_accounts 已清理名单外旧行', { removed: removedRows });

    logger.info('同步完成', { added: added.length, deleted: deleted.length, quotaHit });
    return { sheetCount: accounts.length, sheetTotal, coreCount, added, deleted, quotaHit, failedAdds, accounts };
}

module.exports = {
    runSync,
    fetchSheetAccounts,
    filterByWatchlist,
    parseCsv,
    extractHandle,
    listWatched,
    addWatch,
    deleteWatch,
    WatchApiError,
    isQuotaError,
};
