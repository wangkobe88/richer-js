/**
 * 事件入库管道：shouldStore 筛选（tier×eventType）→ normalize → content 裁剪 → 去重插入。
 * 入库失败：重试 2 次 → 完整 payload 写 logs/news-monitor-ingest-error.jsonl（可人工重放）+ ERROR，
 * 主循环继续。
 *
 * 筛选规则（常量集中，调整只改这里）：
 * - NEVER_STORE：所有账号都不入库。SYSTEM=服务商系统消息（只写日志），
 *   TRANSLATE=原文机翻副本（冗余）。
 * - 核心账号（Sheet「级别」列标「核心」）：其余全部事件保留——
 *   用户裁定：核心账号的关注/回复/转发等所有信息都重要，不能删。
 * - 普通账号：只保留高信息密度事件。NEW_RETWEET 不在其中：纯转推量大
 *   信息密度最低，被转原文若在监控列表内会以 NEW_TWEET 到达。
 * - 未知新 eventType（协议演进）：照常入库 + warn——宁可先存后分析，不丢新信号。
 */
'use strict';

const store = require('./store');
const { logger, fileLogger } = require('./logs');

const ingestErrorLog = fileLogger('ingest-error.jsonl');

// ---- 筛选规则 ----
const NEVER_STORE = ['SYSTEM', 'TRANSLATE'];

const NORMAL_KEEP = [
    'NEW_TWEET',
    'NEW_TWEET_QUOTE',
    'CA',
    'CA_CREATE',
    'DELETE',
    'TWEET_TOPPING',
];

const KNOWN_TYPES = [
    'NEW_TWEET', 'NEW_TWEET_REPLY', 'NEW_TWEET_QUOTE', 'NEW_RETWEET',
    'CA', 'CA_CREATE', 'NEW_FOLLOWER', 'NEW_UNFOLLOWER',
    'UPDATE_NAME', 'UPDATE_DESCRIPTION', 'UPDATE_AVATAR', 'UPDATE_BANNER',
    'TWEET_TOPPING', 'DELETE', 'SYSTEM', 'TRANSLATE',
];

function shouldStore(eventType, tier) {
    if (NEVER_STORE.includes(eventType)) return false;
    if (tier === 'core') return true;
    // 协议新增的未知 eventType：照常入库（ingest 会 warn 提示）——宁可先存后分析，不丢新信号
    if (!isKnownType(eventType)) return true;
    return NORMAL_KEEP.includes(eventType);
}

function isKnownType(eventType) {
    return KNOWN_TYPES.includes(eventType);
}

// ---- content 裁剪 ----

// 推文类对象 content 白名单字段（体量控制；CA/CA_CREATE 等结构未知的类型原样保留）
const TWEET_FIELDS = ['id', 'createdAt', 'retweetCount', 'favoriteCount', 'replyCount',
    'quoteCount', 'viewCount', 'userFollowers', 'hashtags', 'urls', 'mentions'];
const TWEET_EVENT_TYPES = new Set(['NEW_TWEET', 'NEW_TWEET_REPLY', 'NEW_TWEET_QUOTE', 'NEW_RETWEET', 'CA']);
const FOLLOWER_EVENT_TYPES = new Set(['NEW_FOLLOWER', 'NEW_UNFOLLOWER']);

const TEXT_MAX = 600;       // 推文正文截断
const QUOTED_TEXT_MAX = 300; // 被引用/回复/转推原推正文截断
const STR_MAX = 200;        // 资料更新字符串截断
const FOLLOWER_ITEMS = 10;  // 关注类数组保留条数
const MEDIA_MAX = 4;        // media 数组保留条数（X 单推最多 4 图）

/** media 元素精简：thumbUrl 是 pbs 图片直链（url 是推文图页链接，展示无用） */
function trimMedia(media) {
    if (!Array.isArray(media) || media.length === 0) return undefined;
    const items = media.slice(0, MEDIA_MAX)
        .map(m => (m && typeof m === 'object' && (m.thumbUrl || m.url))
            ? { type: m.type ?? 'photo', url: m.thumbUrl || m.url }
            : null)
        .filter(Boolean);
    return items.length ? items : undefined;
}

/** 被引用/回复/转推的原推对象（replyStatus/quoteStatus/retweetedStatus 三选一，互斥）
 * → 精简 {user, text, media}，供前端渲染引用块 */
function trimQuoted(content) {
    const src = content.replyStatus || content.quoteStatus || content.retweetedStatus || null;
    if (!src || typeof src !== 'object') return undefined;
    const out = {};
    if (src.userScreenName) out.user = String(src.userScreenName).replace(/^@/, '');
    if (src.text) out.text = truncate(String(src.text), QUOTED_TEXT_MAX);
    const media = trimMedia(src.media);
    if (media) out.media = media;
    return Object.keys(out).length ? out : undefined;
}

function truncate(s, n) {
    if (typeof s !== 'string') return s;
    return s.length > n ? s.slice(0, n) + '…' : s;
}

/** 解析服务端 createdAt：ISO 字符串或秒/毫秒时间戳；失败返回 null（宁可 null 不猜） */
function parseTime(v) {
    if (v == null) return null;
    if (typeof v === 'number') {
        const ms = v > 1e12 ? v : v * 1000;   // 秒 vs 毫秒启发式
        const d = new Date(ms);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    if (typeof v === 'string') {
        const d = new Date(v);
        if (!Number.isNaN(d.getTime())) return d.toISOString();
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) return parseTime(n);
    }
    return null;
}

/** 按事件类型裁剪 content（推文对象白名单 / 关注数组前 N 项 / 字符串截断 / 未知原样） */
function trimContent(eventType, content) {
    if (content == null) return null;
    if (TWEET_EVENT_TYPES.has(eventType) && typeof content === 'object' && !Array.isArray(content)) {
        const out = { text: truncate(content.text, TEXT_MAX) };
        for (const k of TWEET_FIELDS) {
            if (content[k] != null) out[k] = content[k];
        }
        const media = trimMedia(content.media);
        if (media) out.media = media;               // 图片直链（thumbUrl），前端渲染用
        if (content.media) out.mediaCount = Array.isArray(content.media) ? content.media.length : 1;
        const quoted = trimQuoted(content);
        if (quoted) out.quoted = quoted;            // 被回复/引用/转推的原推精简
        return out;
    }
    if (FOLLOWER_EVENT_TYPES.has(eventType) && Array.isArray(content)) {
        return content.slice(0, FOLLOWER_ITEMS).map(u => ({
            userName: u?.userName ?? null,
            userScreenName: u?.twAccount ?? u?.userScreenName ?? null,
            userFollowers: u?.followerCount ?? null,
            userAvatar: u?.profileUrl ?? null,
        }));
    }
    if (typeof content === 'string') return truncate(content, STR_MAX);
    return content;  // 未知结构（CA_CREATE 等）原样保留，不裁剪没把握的东西
}

/**
 * 规范化事件为入库行。未知账号按 normal 处理并 WARN（每账号只报一次）。
 * @returns 行对象；NEVER_STORE/SYSTEM 等不入库类型返回 null
 */
function normalizeEvent(params, tierOf) {
    const eventType = params?.eventType;
    const handle = String(params?.twAccount || '').replace(/^@/, '').toLowerCase();
    const tier = tierOf(handle);
    if (tier == null) {
        warnUnknownAccount(handle);
    }
    if (!shouldStore(eventType, tier || 'normal')) return null;

    const content = trimContent(eventType, params.content);
    // 发推账号头像（WSS params.profileUrl 实测为 pbs.twimg.com 头像直链）
    // 挂进 content jsonb（不动表结构）；数组型（关注类）与字符串型（资料更新类）不塞
    if (content && typeof content === 'object' && !Array.isArray(content) && params.profileUrl) {
        content.userAvatar = params.profileUrl;
    }
    const tweetId = (content && typeof content === 'object' && !Array.isArray(content) && content.id != null)
        ? String(content.id) : null;

    return {
        source_event_id: params.id != null ? String(params.id) : null,
        event_type: eventType,
        tw_account: handle,
        tw_user_name: params.twUserName || null,
        tweet_id: tweetId,
        content,
        ca: params.ca || (content && typeof content === 'object' && !Array.isArray(content) && content.ca) || null,
        is_core: tier === 'core',
        event_time: parseTime(params.createdAt),
    };
}

const warnedAccounts = new Set();
function warnUnknownAccount(handle) {
    if (handle && !warnedAccounts.has(handle)) {
        warnedAccounts.add(handle);
        logger.warn('事件来自未知账号（不在 watch_accounts，按 normal 处理）', { handle });
    }
}

/** 主入口：WSS onEvent → 此处。永不抛错（防断 WSS 主循环），失败留痕。 */
async function ingestEvent(params, tierOf) {
    let row;
    try {
        row = normalizeEvent(params, tierOf);
    } catch (err) {
        logger.error('事件规范化失败', { err: err.message });
        ingestErrorLog.write({ ts: new Date().toISOString(), stage: 'normalize', err: err.message, params });
        return;
    }
    if (!row) {
        if (row === null && params?.eventType === 'SYSTEM') {
            logger.info('SYSTEM 事件（不入库，留档）', { content: String(params.content || '').slice(0, 200) });
        }
        return;
    }
    if (!isKnownType(row.event_type)) {
        logger.warn('未知 eventType，照常入库', { eventType: row.event_type });
    }

    let lastErr = null;
    for (let i = 0; i <= 2; i++) {
        try {
            const { inserted, id } = await store.insertEvent(row);
            if (inserted) {
                logger.debug('事件入库', { id, type: row.event_type, account: row.tw_account });
            } else {
                logger.debug('重复事件忽略', { source_event_id: row.source_event_id });
            }
            return;
        } catch (err) {
            lastErr = err;
            if (i < 2) await new Promise(r => setTimeout(r, 1000));
        }
    }
    logger.error('事件入库失败（已重试 2 次，payload 落 ingest-error.jsonl）', {
        err: lastErr.message, type: row.event_type, account: row.tw_account,
    });
    ingestErrorLog.write({ ts: new Date().toISOString(), stage: 'insert', err: lastErr.message, row });
}

// 测试辅助：清空 unknown-account 警告去重集合
function _resetWarned() { warnedAccounts.clear(); }

module.exports = {
    shouldStore,
    isKnownType,
    trimContent,
    normalizeEvent,
    ingestEvent,
    _resetWarned,
};
