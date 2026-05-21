/**
 * PumpFun WebSocket Token Collector (Helius Enhanced)
 *
 * 通过 Helius transactionSubscribe 实时监控 PumpFun 新代币创建
 * 检测速度：~0.5-1 秒（vs AVE API 轮询的 ~18-19 秒）
 *
 * 优势：
 * - 服务端过滤：accountInclude 只接收 PumpFun 相关交易，无需客户端过滤全部日志
 * - 完整交易数据：一次消息包含所有 accountKeys、logs、meta，无需额外 RPC 调用
 * - jsonParsed 编码：account keys 直接以字符串形式提供
 * - 无需 @solana/web3.js Connection：彻底避免双 WS 连接冲突
 *
 * 工作流程：
 * 1. 使用 Helius transactionSubscribe 订阅 PumpFun 程序交易
 * 2. 过滤包含 "Instruction: Create" 的日志（新代币创建标志）
 * 3. 从交易 accountKeys 直接提取 mint 地址和创建者钱包
 * 4. 从 Create/CreateV2 指令数据解码 name/symbol
 * 5. 加入 TokenPool，价格由后续监控循环的批量价格 API 获取
 */

const WebSocket = require('ws');
const { PublicKey } = require('@solana/web3.js');
const bs58 = require('bs58').default;
const { BlockchainConfig } = require('../utils/BlockchainConfig');

const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const PUMP_FUN_PROGRAM_PK = new PublicKey(PUMP_FUN_PROGRAM);

// Anchor instruction discriminators (from PumpFun IDL)
const PUMP_CREATE_DISCRIMINATOR = Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]);
const PUMP_CREATE_V2_DISCRIMINATOR = Buffer.from([214, 144, 76, 236, 95, 139, 49, 180]);

function readAnchorString(buf, offset) {
    if (offset + 4 > buf.length) return { value: '', offset: buf.length };
    const len = buf.readUInt32LE(offset);
    offset += 4;
    if (len > 1000 || offset + len > buf.length) return { value: '', offset: buf.length };
    const value = buf.slice(offset, offset + len).toString('utf-8');
    offset += len;
    return { value, offset };
}

function decodePumpCreateInstruction(dataB58) {
    try {
        const data = Buffer.from(bs58.decode(dataB58));
        if (data.length < 8) return null;
        const disc = data.slice(0, 8);
        if (!disc.equals(PUMP_CREATE_DISCRIMINATOR) && !disc.equals(PUMP_CREATE_V2_DISCRIMINATOR)) return null;
        let offset = 8;
        const nameResult = readAnchorString(data, offset);
        const symbolResult = readAnchorString(data, nameResult.offset);
        return { name: nameResult.value, symbol: symbolResult.value };
    } catch { return null; }
}

/**
 * 通过 PDA 推导 PumpFun 代币的 bonding curve 地址（即 pairAddress）
 * seed: ['bonding-curve', mint.toBuffer()]
 */
function deriveBondingCurveAddress(mintAddress) {
    const mint = new PublicKey(mintAddress);
    const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from('bonding-curve'), mint.toBuffer()],
        PUMP_FUN_PROGRAM_PK
    );
    return pda.toString();
}

class PumpFunWsCollector {
    constructor(config, logger, tokenPool) {
        this.config = (config.pumpfunCollectors?.ws) || (config.pumpfunWs) || {};
        this.logger = logger;
        this.tokenPool = tokenPool;
        this.enabled = this.config.enabled === true;

        // Helius API Key
        this.heliusApiKey = this._getHeliusApiKey();

        // WebSocket 连接
        this._ws = null;
        this.subId = null;

        // 心跳
        this.heartbeatIntervalId = null;
        this.pingIntervalId = null;

        // 重连
        this.reconnectDelay = this.config.reconnectBaseDelay || 2000;
        this.maxReconnectDelay = this.config.reconnectMaxDelay || 60000;
        this.reconnectTimer = null;

        // 统计
        this.stats = {
            detected: 0,
            enriched: 0,
            enrichmentFailed: 0,
            duplicate: 0,
            parseFailed: 0,
            reconnects: 0,
            txReceived: 0,
            createDetected: 0,
            decodeSuccess: 0,
            decodeFailed: 0,
            lastDetectedAt: null,
            lastEnrichedAt: null,
            startTime: null
        };
    }

    /**
     * 获取 Helius API Key
     * 优先使用 HELIUS_API_KEY 环境变量
     * 否则从 RPC URL 中提取
     */
    _getHeliusApiKey() {
        if (process.env.HELIUS_API_KEY) {
            return process.env.HELIUS_API_KEY;
        }
        const rpcUrl = process.env.SOLANA_RPC_ENDPOINT ||
            BlockchainConfig.CHAIN_CONFIGS.solana.network.rpcUrl;
        const match = rpcUrl.match(/api-key=([a-f0-9-]+)/i);
        if (match) {
            return match[1];
        }
        this.logger.warn('[PumpFunWsCollector] 无法获取 Helius API Key，请设置 HELIUS_API_KEY 或使用 Helius RPC URL');
        return null;
    }

    /**
     * 构建 Helius WebSocket URL
     */
    _buildWsUrl() {
        if (!this.heliusApiKey) {
            throw new Error('Helius API Key 不可用');
        }
        return `wss://mainnet.helius-rpc.com?api-key=${this.heliusApiKey}`;
    }

    /**
     * 启动 WS 收集器
     */
    start() {
        if (!this.enabled) {
            this.logger.info('[PumpFunWsCollector] 已禁用，跳过启动');
            return;
        }

        if (!this.heliusApiKey) {
            this.logger.error('[PumpFunWsCollector] Helius API Key 不可用，无法启动');
            this.enabled = false;
            return;
        }

        this.stats.startTime = Date.now();
        this._subscribe();
        this._startHeartbeat();

        this.logger.info('[PumpFunWsCollector] 已启动，通过 Helius transactionSubscribe 监控 PumpFun 新代币');
    }

    /**
     * 停止 WS 收集器
     */
    stop() {
        if (this._ws) {
            // 发送取消订阅
            if (this.subId !== null) {
                try {
                    this._ws.send(JSON.stringify({
                        jsonrpc: '2.0',
                        id: 2,
                        method: 'transactionUnsubscribe',
                        params: [this.subId]
                    }));
                } catch (_) {}
            }
            this._ws.removeAllListeners();
            this._ws.close();
            this._ws = null;
        }

        if (this.heartbeatIntervalId) {
            clearInterval(this.heartbeatIntervalId);
            this.heartbeatIntervalId = null;
        }

        if (this.pingIntervalId) {
            clearInterval(this.pingIntervalId);
            this.pingIntervalId = null;
        }

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        this.logger.info('[PumpFunWsCollector] 已停止', this.stats);
    }

    /**
     * 使用 Helius transactionSubscribe 订阅 PumpFun 交易
     * - accountInclude: 服务端过滤，只接收包含 PumpFun 程序的交易
     * - jsonParsed: account keys 直接以字符串形式提供
     * - failed: false: 排除失败交易
     */
    _subscribe() {
        const wsUrl = this._buildWsUrl();
        const programId = this.config.programId || PUMP_FUN_PROGRAM;

        this.logger.info('[PumpFunWsCollector] 连接 Helius WebSocket', { wsUrl: wsUrl.replace(/api-key=.+/, 'api-key=***') });

        this._ws = new WebSocket(wsUrl);

        this._ws.on('open', () => {
            this.logger.info('[PumpFunWsCollector] WebSocket 已连接');

            // 发送 Helius transactionSubscribe 请求
            this._ws.send(JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'transactionSubscribe',
                params: [
                    {
                        failed: false,
                        accountInclude: [programId]
                    },
                    {
                        commitment: this.config.commitment || 'confirmed',
                        encoding: 'jsonParsed',
                        transactionDetails: 'full',
                        maxSupportedTransactionVersion: 0
                    }
                ]
            }));

            // 定期 ping 保持连接
            this.pingIntervalId = setInterval(() => {
                if (this._ws && this._ws.readyState === WebSocket.OPEN) {
                    this._ws.ping();
                }
            }, 10000);
        });

        this._ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());

            // 订阅确认
            if (msg.id === 1 && msg.result !== undefined) {
                this.subId = msg.result;
                this.logger.info('[PumpFunWsCollector] transactionSubscribe 订阅成功', { subId: this.subId });
                return;
            }

            // 交易通知
            if (msg.method === 'transactionNotification' && msg.params?.result) {
                this._handleTransaction(msg.params.result);
            }
        });

        this._ws.on('error', (error) => {
            this.logger.error('[PumpFunWsCollector] WebSocket 错误', { error: error.message });
        });

        this._ws.on('close', (code, reason) => {
            this.logger.warn('[PumpFunWsCollector] WebSocket 关闭', { code, reason: reason?.toString() });
            this._scheduleReconnect();
        });
    }

    /**
     * 处理接收到的交易通知
     * 从 Helius transactionSubscribe 返回的 jsonParsed 数据中提取代币信息
     */
    _handleTransaction(result) {
        this.stats.txReceived++;

        try {
            const meta = result.transaction?.meta;
            const txMessage = result.transaction?.transaction?.message;

            if (!meta || !txMessage) {
                this.stats.parseFailed++;
                return;
            }

            const logs = meta.logMessages || [];

            // 检测 PumpFun 新代币创建：匹配 Create 和 CreateV2
            const isPumpCreate = logs.some(log =>
                log.includes('Instruction: Create')
            );

            if (!isPumpCreate) return;

            this.stats.createDetected++;

            // jsonParsed 格式下 accountKeys 直接包含 pubkey 字符串
            const accountKeys = txMessage.accountKeys || [];
            const keys = accountKeys.map(k => {
                if (typeof k === 'string') return k;
                return k.pubkey || k.toString();
            });

            if (keys.length < 2) {
                this.stats.parseFailed++;
                return;
            }

            const signature = result.signature;
            const devWallet = keys[0];
            const mintAddress = keys[1];

            if (!mintAddress || !devWallet) {
                this.stats.parseFailed++;
                return;
            }

            // 二次验证：PumpFun 代币地址以 "pump" 结尾
            if (!mintAddress.endsWith('pump')) {
                this.stats.filteredNonPump = (this.stats.filteredNonPump || 0) + 1;
                return;
            }

            // 从 PumpFun 指令数据中解码 name/symbol
            let tokenName = '';
            let tokenSymbol = '';
            const instructions = txMessage.instructions || [];
            for (const ix of instructions) {
                const programId = typeof ix.programId === 'string' ? ix.programId : (ix.programId?.pubkey || '');
                if (programId !== PUMP_FUN_PROGRAM) continue;
                if (!ix.data) continue;

                const decoded = decodePumpCreateInstruction(ix.data);
                if (decoded) {
                    tokenName = decoded.name || '';
                    tokenSymbol = decoded.symbol || '';
                    this.stats.decodeSuccess++;
                    break;
                }
            }

            if (!tokenName && !tokenSymbol) {
                this.stats.decodeFailed++;
            }

            this._handleNewToken(signature, mintAddress, devWallet, tokenName, tokenSymbol);

        } catch (error) {
            this.logger.error('[PumpFunWsCollector] 解析交易失败', { error: error.message });
            this.stats.parseFailed++;
        }
    }

    /**
     * 处理检测到的新代币
     * name/symbol 从 Create/CreateV2 指令数据中解码
     * 价格由后续监控循环的批量价格 API 获取
     */
    _handleNewToken(signature, mintAddress, devWallet, tokenName, tokenSymbol) {
        // 去重检查
        const existingToken = this.tokenPool.getToken(mintAddress, 'solana');
        if (existingToken) {
            this.stats.duplicate++;
            return;
        }

        const now = Date.now();
        this.stats.detected++;
        this.stats.lastDetectedAt = now;

        // 创建 token 对象并加入池
        // PumpFun pairAddress 是 mint 的 PDA（bonding-curve seed），可确定性推导
        const pairAddress = deriveBondingCurveAddress(mintAddress);
        const minimalToken = {
            token: mintAddress,
            chain: 'solana',
            platform: 'pumpfun',
            data_source: 'wss',
            name: tokenName || '',
            symbol: tokenSymbol || '',
            created_at: Math.floor(now / 1000),
            current_price_usd: null,
            creator_address: devWallet,
            pairAddress
        };

        const added = this.tokenPool.addToken(minimalToken);
        if (added) {
            this.logger.info('[PumpFunWsCollector] 新代币入池', {
                mint: mintAddress,
                name: tokenName || '',
                symbol: tokenSymbol || '',
                dev: devWallet,
                signature: signature?.slice(0, 20) + '...',
                poolSize: this.tokenPool.getStats().total
            });
        } else {
            this.stats.duplicate++;
        }
    }

    /**
     * 启动心跳检测
     * 使用 WS ping/pong 检测连接存活
     */
    _startHeartbeat() {
        this.heartbeatIntervalId = setInterval(() => {
            if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
                this.logger.warn('[PumpFunWsCollector] WebSocket 未连接，触发重连');
                this._scheduleReconnect();
                return;
            }
            // 连接正常，重置重连延迟
            this.reconnectDelay = this.config.reconnectBaseDelay || 2000;
        }, 30000);
    }

    /**
     * 安排重连
     */
    _scheduleReconnect() {
        if (this.reconnectTimer) return; // 已在重连中

        this.stats.reconnects++;

        // 清理旧 WebSocket
        if (this._ws) {
            this._ws.removeAllListeners();
            this._ws.close();
            this._ws = null;
        }

        if (this.pingIntervalId) {
            clearInterval(this.pingIntervalId);
            this.pingIntervalId = null;
        }

        this.subId = null;

        this.logger.info('[PumpFunWsCollector] 计划重连', {
            delay: `${this.reconnectDelay}ms`,
            attempt: this.stats.reconnects
        });

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this._subscribe();
        }, this.reconnectDelay);

        // 指数退避
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    }

    /**
     * 获取统计信息
     */
    getStats() {
        return {
            enabled: this.enabled,
            ...this.stats,
            connected: this._ws?.readyState === WebSocket.OPEN,
            uptimeSeconds: this.stats.startTime
                ? Math.floor((Date.now() - this.stats.startTime) / 1000)
                : 0
        };
    }
}

module.exports = PumpFunWsCollector;
