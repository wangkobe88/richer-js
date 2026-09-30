/**
 * WSS 客户端：连接 6551 twitter_wss，心跳、指数退避重连、订阅、事件分发。
 *
 * 协议（官方 GitHub 6551Team/opentwitter-mcp）：
 *   连接 wss://ai.6551.io/open/twitter_wss?token=<JWT>
 *   客户端文本 "ping" → 服务端 "pong"
 *   订阅 {"jsonrpc":"2.0","id":1,"method":"twitter.subscribe"}
 *   推送 {"jsonrpc":"2.0","method":"twitter.event","params":{...}}
 *
 * 注意：订阅不跨连接——每次重连成功后必须重新 subscribe。
 * 断线期间事件丢失是接受的（服务端无 replay），日志记录每次断线时长。
 * Node >= 22 内置 WHATWG WebSocket（182 v24 实测可用），不引入 ws 库。
 */
'use strict';

const { logger } = require('./logs');

const SUBSCRIBE_ID = 1;
const STABLE_RESET_MS = 10 * 60 * 1000;   // 稳定 10 分钟后退避指数归零
const MAX_DELAY_MS = 60 * 1000;
const CONNECT_TIMEOUT_MS = 15 * 1000;     // 握手看门狗：内置 WS 无连接超时，自己掐

function createWssClient({ url, token, heartbeatMs = 30000, onEvent, onState }) {
    let ws = null;
    let stopped = false;
    let attempt = 0;            // 重连指数
    let connectedAt = 0;        // 本次连接建立时间
    let reconnectTimer = null;
    let heartbeatTimer = null;
    let connectTimer = null;    // connecting 阶段看门狗
    let lastMessageAt = 0;
    let disconnectedAt = 0;

    const stats = {
        state: 'idle',            // idle | connecting | open | closed
        connectedAt: 0,
        reconnects: 0,
        eventsReceived: 0,
        lastMessageAt: 0,
    };

    function setState(s) {
        stats.state = s;
        if (onState) onState(s);
    }

    function scheduleReconnect() {
        if (stopped) return;
        const delay = Math.min(MAX_DELAY_MS, 1000 * Math.pow(2, attempt)) + Math.random() * 300;
        attempt += 1;
        logger.warn('WSS 将重连', { delayMs: Math.round(delay), attempt });
        reconnectTimer = setTimeout(connect, delay);
    }

    function sendSubscribe() {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: SUBSCRIBE_ID, method: 'twitter.subscribe' }));
        logger.info('WSS 已发送订阅请求');
    }

    function handleMessage(data) {
        lastMessageAt = Date.now();
        stats.lastMessageAt = lastMessageAt;
        if (data === 'pong') return;
        let msg;
        try {
            msg = JSON.parse(data);
        } catch {
            logger.warn('WSS 非 JSON 消息', { raw: String(data).slice(0, 200) });
            return;
        }
        if (msg.method === 'twitter.event') {
            stats.eventsReceived += 1;
            try {
                onEvent(msg.params);
            } catch (err) {
                // onEvent（ingest）自身有错误处理，这里兜住同步异常防断主循环
                logger.error('onEvent 回调抛错', { err: err.message });
            }
            return;
        }
        if (msg.id === SUBSCRIBE_ID) {
            const ok = msg.result?.success === true;
            if (ok) logger.info('WSS 订阅成功');
            else logger.error('WSS 订阅被拒绝', { result: JSON.stringify(msg.result)?.slice(0, 300) });
            return;
        }
        logger.warn('WSS 未识别消息', { raw: JSON.stringify(msg).slice(0, 200) });
    }

    function startHeartbeat() {
        stopHeartbeat();
        heartbeatTimer = setInterval(() => {
            // 死链判定：2 个心跳周期没有任何入站消息（含 pong）→ 主动断开触发重连
            if (lastMessageAt && Date.now() - lastMessageAt > heartbeatMs * 2) {
                logger.error('WSS 心跳超时（2 周期无消息），主动断开重连', {
                    silentMs: Date.now() - lastMessageAt,
                });
                teardown();
                scheduleReconnect();
                return;
            }
            if (ws && ws.readyState === 1) {
                ws.send('ping');
            }
        }, heartbeatMs);
    }

    function stopHeartbeat() {
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    }

    function teardown() {
        stopHeartbeat();
        if (ws) {
            // 移除监听防止主动 close 触发 scheduleReconnect 双跳
            ws.removeAllListeners?.();
            try { ws.close(); } catch { /* already closed */ }
            ws = null;
        }
    }

    function connect() {
        if (stopped) return;
        setState('connecting');
        // Node >= 22 内置 WHATWG WebSocket
        if (typeof WebSocket !== 'function') {
            throw new Error('当前 Node 无内置 WebSocket（需 Node >= 22）');
        }
        ws = new WebSocket(`${url}?token=${token}`);

        // 握手看门狗：网络黑洞时 onopen/onclose 都不触发（原项目实测：
        // code=1006 后重连卡 connecting 15min+，事件全丢），超时强制放弃重试
        clearTimeout(connectTimer);
        connectTimer = setTimeout(() => {
            connectTimer = null;
            if (stats.state !== 'connecting') return;
            logger.error(`WSS 握手超时（${CONNECT_TIMEOUT_MS / 1000}s 未完成），放弃本次连接`, { attempt });
            if (ws) {
                ws.removeAllListeners?.();
                try { ws.close(); } catch { /* already closed */ }
                ws = null;
            }
            scheduleReconnect();
        }, CONNECT_TIMEOUT_MS);

        ws.onopen = () => {
            clearTimeout(connectTimer); connectTimer = null;
            const now = Date.now();
            connectedAt = now;
            stats.connectedAt = now;
            stats.reconnects += 1;
            setState('open');
            lastMessageAt = now;
            const downMs = disconnectedAt ? now - disconnectedAt : 0;
            logger.info('WSS 已连接', { attempt, 断线时长ms: downMs || null });
            sendSubscribe();
            startHeartbeat();
        };

        ws.onmessage = ev => handleMessage(typeof ev.data === 'string' ? ev.data : '');

        ws.onerror = () => {
            // 具体原因在 onclose 里统一处理；这里不重复打日志
        };

        ws.onclose = ev => {
            clearTimeout(connectTimer); connectTimer = null;
            const wasOpen = stats.state === 'open';
            stopHeartbeat();
            if (!disconnectedAt) disconnectedAt = Date.now();
            setState('closed');
            // 认证类错误醒目提示（token 过期需人工换），仍继续退避重试
            const authish = (ev.code >= 4000 && ev.code < 5000) || ev.code === 1008;
            const level = authish ? 'error' : 'warn';
            logger[level]('WSS 连接关闭', { code: ev.code, reason: String(ev.reason || '').slice(0, 200) });
            if (authish) {
                logger.error('WSS 疑似认证失败（token 过期？）——将持续重试，请人工确认 token');
            }
            if (wasOpen) {
                // 稳定连接断开：若已稳定运行足够久则指数归零
                if (connectedAt && Date.now() - connectedAt >= STABLE_RESET_MS) attempt = 0;
            }
            ws = null;
            scheduleReconnect();
        };
    }

    return {
        start() {
            stopped = false;
            connect();
        },
        stop() {
            stopped = true;
            if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
            if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
            teardown();
            setState('idle');
            logger.info('WSS 客户端已停止');
        },
        stats,
    };
}

module.exports = { createWssClient };
