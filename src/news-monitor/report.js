/**
 * 小时总结：游标取材 → digest 构建 → GLM → 幂等写报告。
 *
 * 游标逻辑（核心）：
 *   toId   = 当前 maxEventId 快照（此后到达的事件自然归下一窗）
 *   fromId = 上份报告 last_event_id（无报告 → toId，跳过历史）
 *   窗口按事件到达序（bigserial id）切分，非事件时间——晚到事件归下窗，无遗漏无重复。
 *
 * 失败策略（宁暴露不掩盖）：
 *   LLM 失败/写库失败 → 不写报告行、游标不推进、全文落 logs/news-monitor-report-fallback.jsonl；
 *   下一小时窗口起点不变 → 自动并窗补上。0 事件窗口写轻量报告（不调 LLM）推进游标，
 *   保证报告时间线连续。
 *
 * GLM 客户端（智谱 Anthropic Messages 协议 /v1/messages）：
 *   429/5xx/超时 → 抖动指数退避重试；4xx 立即抛；
 *   thinking 默认 disabled（glm-5.3 思考会先烧 max_tokens，素材大时正文零输出，实测）；
 *   stop_reason=max_tokens 视为失败（报告截断不可接受）。
 */
'use strict';

const store = require('./store');
const { logger, fileLogger } = require('./logs');

const reportFallbackLog = fileLogger('report-fallback.jsonl');

// ---- GLM 客户端 ----

class LlmError extends Error {
    constructor(message, { status } = {}) {
        super(message);
        this.name = 'LlmError';
        this.status = status;
    }
}

/** 智谱内容审查拦截（1301，HTTP 400）：输入含敏感内容被拒，重试同一素材无意义 */
function isContentPolicyError(err) {
    return err instanceof LlmError && err.status === 400 && /1301|不安全或敏感内容/.test(err.message);
}

const ANTHROPIC_VERSION = '2023-06-01';

class LlmClient {
    constructor({ baseUrl, apiKey, model, timeoutMs = 120000, maxRetries = 2 } = {}) {
        this.baseUrl = (baseUrl || '').replace(/\/+$/, '');
        this.apiKey = apiKey;
        this.model = model;
        if (!this.baseUrl) throw new Error('LlmClient: NEWS_LLM_BASE_URL 未配置（检查 config/.env）');
        if (!this.apiKey) throw new Error('LlmClient: NEWS_LLM_API_KEY 未配置（检查 config/.env）');
        if (!this.model) throw new Error('LlmClient: NEWS_LLM_MODEL 未配置（检查 config/.env）');
        this.timeoutMs = timeoutMs;
        this.maxRetries = maxRetries;
        this.lastUsage = null;
    }

    /** 单轮对话。返回 text（thinking 块已剥离）。lastUsage 更新 token 消耗。 */
    async chat({ system, user, temperature = 0.3, maxTokens = 3000, thinking = 'disabled' }) {
        let lastErr = null;
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                return await this._callOnce({ system, user, temperature, maxTokens, thinking });
            } catch (err) {
                lastErr = err;
                const retryable = err instanceof LlmError ? (err.status === 429 || err.status >= 500) : true;
                if (!retryable || attempt === this.maxRetries) throw err;
                await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt) * (1 + Math.random() * 0.3)));
            }
        }
        throw lastErr;
    }

    async _callOnce({ system, user, temperature, maxTokens, thinking }) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        let res;
        try {
            res = await fetch(`${this.baseUrl}/v1/messages`, {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey,
                    'anthropic-version': ANTHROPIC_VERSION,
                },
                body: JSON.stringify({
                    model: this.model,
                    max_tokens: maxTokens,
                    thinking: { type: thinking },
                    system,
                    temperature,
                    messages: [{ role: 'user', content: user }],
                }),
            });
        } catch (err) {
            if (err.name === 'AbortError') throw new LlmError(`LLM 超时(${this.timeoutMs}ms)`);
            throw new LlmError(`LLM 网络错误: ${err.message}`);
        } finally {
            clearTimeout(timer);
        }

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new LlmError(`LLM HTTP ${res.status}: ${text.slice(0, 300)}`, { status: res.status });
        }
        const data = await res.json();

        // content 是块数组：thinking 块剥离，text 块拼接
        const blocks = Array.isArray(data.content) ? data.content : [];
        const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('');
        if (!text) {
            throw new LlmError(`LLM 响应无 text 块: stop_reason=${data.stop_reason} ${JSON.stringify(data).slice(0, 300)}`);
        }
        if (data.stop_reason === 'max_tokens') {
            throw new LlmError(`LLM 输出被 max_tokens 截断（text 长度 ${text.length}）`);
        }
        this.lastUsage = data.usage
            ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens }
            : null;
        return text;
    }
}

// ---- 小时总结 ----

/** 分批总结的单批事件行数上限：单批触发智谱 1301 审查只丢该批，不卡整个窗口 */
const BATCH_EVENTS = 60;

const SYSTEM_PROMPT = `你是加密（Solana/BSC/ETH/HyperLiquid/Base/Robinhood 生态，及链上情报/巨鲸动向、快讯媒体、加密 OG 与机构）与 AI 领域（实验室/研究者/产品）、以及宏观（白宫/美联储/SEC/主流通讯社）的推特情报分析员。根据给定的一小时监控事件素材，筛选出真正重要的动态，生成简短中文 Markdown 简报。

「重要」的标准：重大公告（升级/上线/合作/融资）、发币或 CA 合约地址相关、安全风险警告（漏洞/攻击/钓鱼）、重要数据里程碑、核心人物（创始人/高管）的重要表态或动向。

要求：
- 只依据素材，不编造；引用推文内容时可适当压缩转述
- 无重要动态就明说，不要硬凑
- 输出格式（Markdown）：
## 重点摘要
（3-6 条，每条一句话结论 + 一句为什么重要，标注来源账号）
## 分账号关键动态
（按账号分组，只列值得注意的账号；不重要的账号不要出现）
## 风险提示
（安全/纠纷类动态；无则整节省略）
- 若整个时段无重要动态，只输出一行「本时段无重要动态。」`;

/** 事件 → digest 单行素材 */
function eventLine(ev, idx, displayNameOf) {
    const typeZh = {
        NEW_TWEET: '发推', NEW_TWEET_REPLY: '回复', NEW_TWEET_QUOTE: '引用转推',
        NEW_RETWEET: '转推', CA: '发推(CA)', CA_CREATE: '新CA',
        NEW_FOLLOWER: '关注', NEW_UNFOLLOWER: '取关',
        UPDATE_NAME: '改名', UPDATE_DESCRIPTION: '改简介',
        UPDATE_AVATAR: '换头像', UPDATE_BANNER: '换横幅',
        TWEET_TOPPING: '置顶', DELETE: '删推',
    }[ev.event_type] || ev.event_type;
    const name = displayNameOf(ev.tw_account) || ev.tw_user_name || '';
    const core = ev.is_core ? '核心' : '普通';
    const time = ev.event_time ? ev.event_time.slice(11, 16) + 'Z' : '??:??';
    const parts = [`[${idx}] @${ev.tw_account}${name ? `(${name})` : ''}`, core, typeZh, time];

    const c = ev.content;
    let text = '';
    let engagement = '';
    if (typeof c === 'string') text = c;
    else if (Array.isArray(c)) text = `关注/取关 ${c.length} 人: ${c.slice(0, 3).map(u => `@${u.userScreenName || '?'}`).join(' ')}${c.length > 3 ? '…' : ''}`;
    else if (c && typeof c === 'object') {
        text = c.text || '';
        const fav = c.favoriteCount ?? 0, rt = c.retweetCount ?? 0, rp = c.replyCount ?? 0;
        const view = c.viewCount;
        engagement = ` 赞${fav}转${rt}回${rp}${view ? `阅${view}` : ''}`;
    }
    if (text) parts.push(String(text).replace(/\s+/g, ' ').slice(0, 300));
    if (engagement) parts.push(engagement.trim());
    if (ev.ca) parts.push(`CA=${ev.ca}`);
    return parts.join(' | ');
}

/**
 * 选材：核心账号事件全保留优先，普通账号按互动数（fav+rt+reply）降序补足到 cap。
 */
function selectEvents(events, cap = 300) {
    const engagement = ev => {
        const c = ev.content;
        if (c && typeof c === 'object' && !Array.isArray(c)) {
            return (c.favoriteCount ?? 0) + (c.retweetCount ?? 0) + (c.replyCount ?? 0);
        }
        return 0;
    };
    const coreEvents = events.filter(e => e.is_core);
    const normalEvents = events.filter(e => !e.is_core)
        .sort((a, b) => engagement(b) - engagement(a));
    if (coreEvents.length >= cap) return coreEvents;
    return coreEvents.concat(normalEvents.slice(0, cap - coreEvents.length));
}

/**
 * 构建素材（selectEvents 选材后逐行成文）。
 * @returns {digest: string, total: number, kept: number}
 */
function buildDigest(events, cap = 300, displayNameOf = () => null) {
    const coreEvents = events.filter(e => e.is_core);
    const normalEvents = events.filter(e => !e.is_core);
    const kept = selectEvents(events, cap);
    const lines = kept.map((ev, i) => eventLine(ev, i + 1, displayNameOf));
    const header = `共 ${events.length} 条事件（核心 ${coreEvents.length} / 普通 ${normalEvents.length}）` +
        (kept.length < events.length ? `，已按重要性截取 ${kept.length} 条：` : '：');
    return { digest: header + '\n' + lines.join('\n'), total: events.length, kept: kept.length };
}

function windowLabelCn(startIso, endIso) {
    // 后端展示统一北京时间
    const bj = iso => new Date(new Date(iso).getTime() + 8 * 3600_000);
    const fmt = d => `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ` +
        `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    return `${fmt(bj(startIso))} – ${fmt(bj(endIso))}`;
}

/**
 * 执行一次总结。返回 { reportId } | { skipped: reason } | { failed: reason }。
 * @param {{llm: LlmClient, digestCap: number, displayNameOf?: function}} deps
 */
async function runSummary({ llm, digestCap = 300, displayNameOf = () => null }, trigger = 'cron') {
    const lastReport = await store.getLatestReport();
    const toId = await store.getMaxEventId();

    // 无历史报告：跳过历史存量，游标从现在开始（首份报告覆盖下一个完整窗口）
    if (!lastReport) {
        if (toId == null) {
            logger.info('无历史报告且无事件，summarize 跳过（等首批事件）', { trigger });
            return { skipped: 'no-data' };
        }
        logger.info('无历史报告，游标从当前 maxId 开始（跳过历史存量）', { trigger, maxId: toId });
        // 写一份轻量锚点报告推进时间线（否则下一轮仍走此分支）
        const now = new Date().toISOString();
        const { inserted, id } = await store.insertReport({
            window_start: now,
            window_end: now,
            first_event_id: null,
            last_event_id: toId,
            report_md: '监控启动，跳过历史存量事件，首份报告覆盖下一个小时窗口。',
            event_count: 0,
            llm_called: false,
            model: null,
            input_tokens: null,
            output_tokens: null,
        });
        logger.info('已写入启动锚点报告', { inserted, id });
        return { skipped: 'bootstrap-anchor' };
    }

    const fromId = lastReport.last_event_id ?? null;
    // toId 快照后的新事件归下一窗
    const events = await store.fetchEventsRange(fromId, toId);
    // 锚点报告 window_start === window_end（同一时刻），下一窗直接继承会撞
    // window_start 唯一键（23505）——锚点后第一窗 +1ms 错开
    const windowStart = lastReport.window_start === lastReport.window_end
        ? new Date(new Date(lastReport.window_end).getTime() + 1).toISOString()
        : lastReport.window_end;
    const windowEnd = new Date().toISOString();

    // 0 事件窗口：轻量报告推进游标，时间线连续
    if (events.length === 0) {
        const { inserted, id } = await store.insertReport({
            window_start: windowStart,
            window_end: windowEnd,
            first_event_id: null,
            last_event_id: toId ?? fromId,
            report_md: '本时段无监控事件。',
            event_count: 0,
            llm_called: false,
            model: null,
            input_tokens: null,
            output_tokens: null,
        });
        logger.info('空窗口，写入轻量报告', { inserted, id, trigger });
        return { reportId: id };
    }

    // 分批总结（BATCH_EVENTS 条/批）：单批触发智谱 1301 内容审查只丢该批（报告注明，
    // 事件仍在库可查），不再整窗卡死游标；非 1301 错误（网络/超时等）仍整窗失败并窗。
    const keptEvents = selectEvents(events, digestCap);
    const batches = [];
    for (let i = 0; i < keptEvents.length; i += BATCH_EVENTS) {
        batches.push(keptEvents.slice(i, i + BATCH_EVENTS));
    }
    const windowLabel = windowLabelCn(windowStart, windowEnd);

    const parts = [];
    const skippedBatches = [];
    let inTok = 0, outTok = 0;
    for (let b = 0; b < batches.length; b++) {
        const batch = batches[b];
        const label = `第 ${b + 1}/${batches.length} 批（事件 ${batch[0].id}-${batch[batch.length - 1].id}，${batch.length} 条）`;
        const lines = batch.map((ev, i) => eventLine(ev, i + 1, displayNameOf)).join('\n');
        let md;
        try {
            md = await llm.chat({
                system: SYSTEM_PROMPT,
                user: `监控窗口：${windowLabel}（北京时间），素材 ${label}：\n\n${lines}`,
            });
        } catch (err) {
            if (isContentPolicyError(err)) {
                skippedBatches.push(label);
                logger.warn('批素材触发内容审查，跳过该批（事件仍在库可查）', {
                    batch: label, err: err.message.slice(0, 120),
                });
                continue;
            }
            logger.error('LLM 总结失败，本窗口报告缺失（下一小时自动并窗补上）', {
                trigger, err: err.message, batch: label, fromId, toId, total: events.length,
            });
            reportFallbackLog.write({
                ts: new Date().toISOString(), stage: 'llm', err: err.message,
                window_start: windowStart, fromId, toId, total: events.length, batch: label,
            });
            return { failed: err.message };
        }
        parts.push(`#### ${label}\n\n${md}`);
        inTok += llm.lastUsage?.inputTokens ?? 0;
        outTok += llm.lastUsage?.outputTokens ?? 0;
    }

    // 全部批被审查拦截：写轻量占位报告推进游标（否则小窗口场景每轮全拦 → 游标
    // 永不推进死锁）。不掩盖：报告正文明确注明审查拦截与事件区间。
    if (parts.length === 0) {
        const placeholder =
            `**监控窗口 ${windowLabel}（北京时间）· 共 ${events.length} 条事件，全部 ${batches.length} 批触发内容审查**\n\n` +
            `> ⚠️ 本窗口素材全部被智谱内容审查拦截，未生成 AI 总结；对应事件仍完整保留在事件流中可查（事件 ${events[0].id}-${events[events.length - 1].id}）。\n\n（审查明细见 logs/news-monitor-report-fallback.jsonl）`;
        const { inserted, id } = await store.insertReport({
            window_start: windowStart,
            window_end: windowEnd,
            first_event_id: events[0].id,
            last_event_id: events[events.length - 1].id,
            report_md: placeholder,
            event_count: events.length,
            llm_called: false,
            model: null,
            input_tokens: null,
            output_tokens: null,
        });
        logger.warn('全部批次触发内容审查，写入占位报告（游标推进，事件在库可查）', {
            trigger, id, inserted, total: events.length, skippedBatches: skippedBatches.length,
        });
        reportFallbackLog.write({
            ts: new Date().toISOString(), stage: 'all-batches-blocked-placeholder',
            window_start: windowStart, fromId, toId, total: events.length, skippedBatches,
        });
        return { reportId: id };
    }

    const reportMd =
        `**监控窗口 ${windowLabel}（北京时间）· 共 ${events.length} 条事件，分 ${batches.length} 批总结**\n\n` +
        (skippedBatches.length
            ? `> ⚠️ ${skippedBatches.length} 批素材触发内容审查未总结：${skippedBatches.join('；')}（对应事件仍保留在事件流中可查）\n\n`
            : '') +
        parts.join('\n\n---\n\n');

    const usage = { inputTokens: inTok || null, outputTokens: outTok || null };
    try {
        const { inserted, id } = await store.insertReport({
            window_start: windowStart,
            window_end: windowEnd,
            first_event_id: events[0].id,
            last_event_id: events[events.length - 1].id,
            report_md: reportMd,
            event_count: events.length,
            llm_called: true,
            model: llm.model,
            input_tokens: usage.inputTokens,
            output_tokens: usage.outputTokens,
        });
        logger.info('小时报告已写入', {
            inserted, id, trigger, total: events.length, kept: keptEvents.length,
            batches: batches.length, skippedBatches: skippedBatches.length,
            inTok: usage.inputTokens, outTok: usage.outputTokens,
        });
        return { reportId: id };
    } catch (err) {
        // LLM 成功但写库失败：付费输出不能丢，落 fallback 日志；游标不推进，下小时并窗（会多花一次调用，接受）
        logger.error('报告写库失败（全文已落 report-fallback.jsonl，下一小时并窗重试）', {
            err: err.message, fromId, toId, total: events.length,
        });
        reportFallbackLog.write({
            ts: new Date().toISOString(), stage: 'insert', err: err.message,
            window_start: windowStart, fromId, toId, total: events.length, report_md: reportMd,
            model: llm.model, input_tokens: usage?.inputTokens ?? null, output_tokens: usage?.outputTokens ?? null,
        });
        return { failed: err.message };
    }
}

module.exports = {
    LlmClient,
    LlmError,
    isContentPolicyError,
    runSummary,
    selectEvents,
    buildDigest,
    eventLine,
    SYSTEM_PROMPT,
};
