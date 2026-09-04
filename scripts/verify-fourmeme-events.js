#!/usr/bin/env node

/**
 * Phase 0 验证脚本：确认 four.meme TokenManager2 合约事件签名 + ankr WSS 订阅 dry-run
 *
 * 验证目标（改造计划 Phase 0 硬门）：
 *   1. TokenCreate / TokenPurchase / TokenSale / LiquidityAdded 的 topic0 与文档签名一致
 *   2. indexed 参数布局（topics 数量）确认，data 字段按文档顺序可解码
 *   3. ankr WSS eth_subscribe(logs) / (newHeads) 订阅确认帧、事件速率、消息格式
 *
 * 用法：node scripts/verify-fourmeme-events.js [--duration-ms 300000]
 * 只读操作：不写任何数据库。
 */

require('dotenv').config({ path: './config/.env' });
const WebSocket = require('ws');
const { ethers } = require('ethers');

const TOKEN_MANAGER_V2 = '0x5c952063c7fc8610FFDB798152D69F0B9550762b';

// 官方文档（fourmeme-api/API-Documents.09-10-2025.md）事件签名 → 规范化（去参数名/去 indexed）
const CANDIDATE_EVENTS = {
    TokenCreate: 'TokenCreate(address,address,uint256,string,string,uint256,uint256,uint256)',
    TokenPurchase: 'TokenPurchase(address,address,uint256,uint256,uint256,uint256,uint256,uint256)',
    TokenSale: 'TokenSale(address,address,uint256,uint256,uint256,uint256,uint256,uint256)',
    TradeStop: 'TradeStop(address)',
    LiquidityAdded: 'LiquidityAdded(address,uint256,address,uint256)',
};

function buildWsUrl() {
    if (process.env.ANKR_WS_URL) return process.env.ANKR_WS_URL;
    if (process.env.ANKR_API_KEY) return `wss://rpc.ankr.com/bsc/ws/${process.env.ANKR_API_KEY}`;
    console.error('缺少 ANKR_WS_URL 或 ANKR_API_KEY（config/.env）');
    process.exit(1);
}

class EventVerifier {
    constructor(durationMs) {
        this.durationMs = durationMs;
        this.wsUrl = buildWsUrl();
        // topic0 → 事件名
        this.topic0Map = new Map();
        for (const [name, sig] of Object.entries(CANDIDATE_EVENTS)) {
            const topic0 = ethers.id(sig);
            this.topic0Map.set(topic0, { name, sig });
        }

        this.stats = {
            startedAt: Date.now(),
            lastMessageAt: null,
            newHeads: 0,
            logs: 0,
            topic0Counts: new Map(),   // topic0(hex) → 次数（含未知）
            perEventSamples: new Map(), // 事件名 → 最新一条解码样本
            blockTimes: new Map(),      // blockNumber → timestamp
            errors: 0,
        };
        this.ws = null;
        this.logSubId = null;
        this.headSubId = null;
        this.rpcId = 1;
    }

    log(msg, obj) {
        if (obj !== undefined) console.log(msg, typeof obj === 'string' ? obj : JSON.stringify(obj));
        else console.log(msg);
    }

    start() {
        this.log(`🔗 连接 ankr WSS: ${this.wsUrl.replace(/\/ws\/[^/?]+/, '/ws/***')}`);
        this.ws = new WebSocket(this.wsUrl);

        this.ws.on('open', () => {
            this.log('✅ WSS 已连接，发送订阅请求');
            this._send({ jsonrpc: '2.0', id: this.rpcId++, method: 'eth_subscribe', params: ['newHeads'] });
            this._send({
                jsonrpc: '2.0', id: this.rpcId++, method: 'eth_subscribe',
                params: ['logs', { address: TOKEN_MANAGER_V2 }],
            });
        });

        this.ws.on('message', (data) => {
            this.stats.lastMessageAt = Date.now();
            let msg;
            try { msg = JSON.parse(data.toString()); } catch { this.stats.errors++; return; }

            if (msg.id !== undefined && msg.result !== undefined && typeof msg.result !== 'object') {
                // 订阅确认帧
                this.log(`📩 订阅确认 id=${msg.id} subId=${msg.result}`);
                if (msg.id === 1) this.headSubId = msg.result;
                if (msg.id === 2) this.logSubId = msg.result;
                return;
            }
            if (msg.method === 'eth_subscription' && msg.params) {
                if (msg.params.subscription === this.logSubId) this._handleLog(msg.params.result);
                else if (msg.params.subscription === this.headSubId) this._handleHead(msg.params.result);
                return;
            }
            if (msg.error) {
                this.stats.errors++;
                this.log('⚠️ RPC 错误帧:', msg.error);
            }
        });

        this.ws.on('error', (err) => { this.stats.errors++; this.log(`❌ WSS 错误: ${err.message}`); });
        this.ws.on('close', (code, reason) => this.log(`🔒 WSS 关闭: ${code} ${reason}`));

        // 周期性进度输出
        this.progressTimer = setInterval(() => this._printProgress(false), 30000);
        // 到时结束
        setTimeout(() => this._finish(), this.durationMs);
    }

    _send(payload) { this.ws.send(JSON.stringify(payload)); }

    _handleHead(head) {
        this.stats.newHeads++;
        const ts = Number(head.timestamp);
        if (!Number.isNaN(ts)) this.stats.blockTimes.set(Number(head.number), ts);
        // 只保留最近 200 个块的时间戳
        if (this.stats.blockTimes.size > 200) {
            const keys = [...this.stats.blockTimes.keys()].sort((a, b) => a - b);
            for (const k of keys.slice(0, keys.length - 200)) this.stats.blockTimes.delete(k);
        }
    }

    _handleLog(logEntry) {
        this.stats.logs++;
        const topic0 = (logEntry.topics && logEntry.topics[0]) || '(no-topic)';
        this.stats.topic0Counts.set(topic0, (this.stats.topic0Counts.get(topic0) || 0) + 1);

        const known = this.topic0Map.get(topic0);
        if (known) {
            const seen = this.stats.perEventSamples.get(known.name);
            if (!seen || seen.topicsCount !== (logEntry.topics || []).length || seen.dataLen !== (logEntry.data || '0x').length) {
                // 首次见到某事件（或 topics/data 布局变化）时打印原始结构
                this.log(`🔬 [${known.name}] 原始 log 布局:`);
                this.log(`   topics(${(logEntry.topics || []).length}): ${JSON.stringify(logEntry.topics)}`);
                this.log(`   data: ${logEntry.data}`);
                this.log(`   txHash=${logEntry.transactionHash} block=${logEntry.blockNumber}`);
            }
            const decoded = this._decodeEvent(known.name, logEntry);
            this.stats.perEventSamples.set(known.name, decoded);
            if (this.stats.logs <= 30) {
                this.log(`🪙 [${known.name}] ${decoded.summary}`);
            }
        } else if (this.stats.topic0Counts.get(topic0) === 1) {
            this.log(`❓ 未知事件 topic0=${topic0} dataLen=${(logEntry.data || '0x').length} topics=${logEntry.topics ? logEntry.topics.length : 0}`);
        }
    }

    _decodeEvent(name, logEntry) {
        const topics = logEntry.topics || [];
        const data = logEntry.data || '0x';
        const info = {
            txHash: logEntry.transactionHash,
            blockNumber: logEntry.blockNumber != null ? Number(logEntry.blockNumber) : null,
            blockTime: this.stats.blockTimes.get(Number(logEntry.blockNumber)) || null,
            topicsCount: topics.length,
        };

        try {
            if (name === 'TokenCreate') {
                // 已验证（Phase 0）：全部参数在 data，无 indexed。
                // TokenCreate(address creator, address token, uint256 requestId, string name,
                //              string symbol, uint256 totalSupply, uint256 launchTime, uint256 launchFee)
                // 注意：实测 launchTime=launchFee=0（不承载有效信息，代币年龄用块时间）。
                const d = ethers.AbiCoder.defaultAbiCoder().decode(
                    ['address', 'address', 'uint256', 'string', 'string', 'uint256', 'uint256', 'uint256'], data);
                info.fields = {
                    creator: d[0], token: d[1], requestId: d[2].toString(),
                    name: d[3], symbol: d[4],
                    totalSupply: d[5].toString(),
                    launchTime: d[6].toString(), launchFee: ethers.formatEther(d[7]),
                };
                info.summary = `token=${d[1]} name="${d[3]}" symbol="${d[4]}" `
                    + `totalSupply=${ethers.formatEther(d[5])} launchTime=${d[6]} launchFee=${info.fields.launchFee}`;
                return info;
            }

            if (name === 'TokenPurchase' || name === 'TokenSale') {
                // 已验证（Phase 0）：全部参数在 data，无 indexed。
                // TokenPurchase/TokenSale(address token, address account, uint256 price,
                //   uint256 amount, uint256 cost, uint256 fee, uint256 offers, uint256 funds)
                // 实测：fee = cost 的 1%（four.meme 费率）；price×amount ≈ cost 成立。
                const d = ethers.AbiCoder.defaultAbiCoder().decode(
                    ['address', 'address', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'], data);
                info.token = d[0]; info.account = d[1];
                info.fields = {
                    priceBnb: ethers.formatEther(d[2]),
                    tokenAmount: ethers.formatEther(d[3]),
                    costBnb: ethers.formatEther(d[4]),
                    feeBnb: ethers.formatEther(d[5]),
                    offers: ethers.formatEther(d[6]),
                    fundsBnb: ethers.formatEther(d[7]),
                };
                info.summary = `token=${d[0]} acct=${d[1]} price=${info.fields.priceBnb} `
                    + `amt=${info.fields.tokenAmount} cost=${info.fields.costBnb} `
                    + `fee=${info.fields.feeBnb} offers=${info.fields.offers} funds=${info.fields.fundsBnb}`;
                return info;
            }

            if (name === 'LiquidityAdded') {
                // LiquidityAdded(address base, uint256 offers, address quote, uint256 funds)（无 indexed，全在 data）
                const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
                    ['address', 'uint256', 'address', 'uint256'], data);
                info.fields = {
                    base: decoded[0], offers: decoded[1].toString(),
                    quote: decoded[2], funds: ethers.formatEther(decoded[3]),
                };
                info.summary = `base=${decoded[0]} quote=${decoded[2]} funds=${info.fields.funds} BNB`;
                return info;
            }

            if (name === 'TradeStop') {
                // TradeStop(address token)（无 indexed）
                const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['address'], data);
                info.token = decoded[0];
                info.summary = `token=${decoded[0]}`;
                return info;
            }
        } catch (err) {
            info.decodeError = err.message;
            info.summary = `解码失败: ${err.message}`;
        }
        return info;
    }

    _printProgress(final) {
        const elapsedMin = ((Date.now() - this.stats.startedAt) / 60000).toFixed(1);
        this.log(`\n━━━ 进度${final ? '（最终）' : ''} @ ${elapsedMin}min ━━━`);
        this.log(`newHeads=${this.stats.newHeads} logs=${this.stats.logs} errors=${this.stats.errors}`);

        const sorted = [...this.stats.topic0Counts.entries()].sort((a, b) => b[1] - a[1]);
        this.log('topic0 分布:');
        for (const [topic0, count] of sorted) {
            const known = this.topic0Map.get(topic0);
            const rate = (count / Math.max(elapsedMin, 0.1)).toFixed(1);
            this.log(`  ${known ? `✅ ${known.name}` : '❓ 未知'} × ${count} (~${rate}/min) ${topic0.slice(0, 18)}...`);
        }

        this.log('各事件解码样本:');
        for (const [name, sample] of this.stats.perEventSamples) {
            this.log(`  [${name}] topics=${sample.topicsCount} ${sample.summary}`);
        }
        if (this.stats.blockTimes.size > 0) {
            const ks = [...this.stats.blockTimes.keys()];
            this.log(`blockTime 缓存: ${this.stats.blockTimes.size} 块 (range ${Math.min(...ks)}..${Math.max(...ks)})`);
        }
    }

    async _finish() {
        clearInterval(this.progressTimer);
        this._printProgress(true);

        // 校验结论
        this.log('\n━━━ 验证结论 ━━━');
        const required = ['TokenCreate', 'TokenPurchase', 'TokenSale'];
        let pass = true;
        for (const name of required) {
            const sample = this.stats.perEventSamples.get(name);
            if (sample && !sample.decodeError) {
                this.log(`✅ ${name}: 收到 ${this.stats.topic0Counts.get(ethers.id(CANDIDATE_EVENTS[name])) || 0} 条，解码成功`);
            } else {
                this.log(`❌ ${name}: ${sample ? sample.decodeError : '未观察到（可能需要延长观察时间）'}`);
                pass = false;
            }
        }
        const liq = this.stats.perEventSamples.get('LiquidityAdded');
        this.log(`${liq && !liq.decodeError ? '✅' : '⚠️'} LiquidityAdded: ${liq ? liq.summary : '未观察到（低频事件，不阻塞）'}`);
        this.log(`✅ newHeads 订阅: ${this.stats.newHeads} 个块头`);

        try { this.ws.close(); } catch { /* ignore */ }
        setTimeout(() => process.exit(pass ? 0 : 2), 500);
    }
}

const args = process.argv.slice(2);
const durationIdx = args.indexOf('--duration-ms');
const durationMs = durationIdx >= 0 ? Number(args[durationIdx + 1]) : 5 * 60 * 1000;

// 启动前自检：候选签名 topic0 计算（TokenCreate 应等于 fourmeme-sniper 确认过的 0x396d5e90...）
console.log('━━━ 候选事件 topic0（本地 keccak 计算）━━━');
for (const [name, sig] of Object.entries(CANDIDATE_EVENTS)) {
    console.log(`  ${name}: ${ethers.id(sig)}`);
}
console.log(`  预期 TokenCreate=0x396d5e902b675b032348d3d2e9517ee8f0c4a926603fbc075d3d282ff00cad20`);

new EventVerifier(durationMs).start();
