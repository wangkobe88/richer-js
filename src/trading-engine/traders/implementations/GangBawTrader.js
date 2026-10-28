/**
 * gang.fun live trader（Binance Agentic Wallet + 官方 gang CLI 子进程封装，2026-10-28）
 *
 * 不 extends BaseTrader：其本质=ethers.Wallet+NonceManager 签名/nonce/gas 全套 EOA 机制，
 * BAW 全不适用（签名在 Binance App 侧，CLI 两段式 preview→requestId→execute）。签名链
 * 全部外包给官方 gang CLI（@gangfun/cli）：WSS 快速回执 race txSeenSignal 复用 gang
 * collector Buy/Sell tick（引擎已接 _txSeenSignal）。
 *
 * CLI 黄金 JSON 形状档案：docs/gang-cli-shapes.md（Step 0 实测，改本文件前先读）。
 * 关键实测语义：
 *   - 买（V2/V3 内盘）requireConfirmation=false：execute 直接 BROADCASTED 全自动
 *   - 卖（内盘曲线）恒 medium_risk_transaction → PENDING_CONFIRMATION → 须 App 人工
 *     确认（与金额/pad 无关，abnormalTxnHandling 无全放行档）——本 trader 告警+轮询
 *     tx-history（approvalTimeoutMs 上限）等确认
 *   - 卖出到账 WNB（WBNB ERC20）非 native BNB：卖腿实收=WBNB balanceOf 前后差，
 *     gas 从 native 扣不混入（比 EOA 余额差法少一步补偿）
 *   - V2 票 CLI 走 gang buy/sell（--bnb 买/分步 wrap-bnb→approve-quote→buy；金额串
 *     带千分位逗号须 strip）；V3 票走 gang v3 buy/sell（--amount 直付无分步）
 *   - requestId 约 5 分钟过期；devMode 过期 351802 / Trade-all-tokens 未开 351803
 *
 * 防双买/双卖状态机（trader 内红线，单测锁死）：
 *   ① preview 前 CLI 失败=无副作用（引擎下轮 tick 天然重试）
 *   ② preview 成功 execute 未发（expired/requestId 拒）=无副作用，可安全重跑 preview
 *      （expired 重试恰一次）
 *   ③ execute BROADCASTED 后一切失败（回执超时）=tx 已广播，绝不重发；超时无回执
 *      → 登记 _unresolvedTxs（同 token 后续 buyToken/sellToken 直接拒绝至人工核查/
 *      重启进程；_syncHoldings 余额差对账接盘链上事实）
 *   ④ execute 进程层失败（CLI 崩溃/超时/输出非 JSON）=链上状态未知 → 同 ③ 登记
 *      unresolved，绝不自动重入（fail-closed throw 带 requestId+时刻）
 *
 * BAW 是外部状态机（App 侧审批流），本 trader 进程内单飞行队列串行一切 CLI 调用
 * （保守设计，防并发交错）；pad（V2/V3）per-token 试探一次缓存（gang buy 对 V3 票
 * 报错指路 v3，shape 见 docs/gang-cli-shapes.md）。
 */

const { spawn } = require('child_process');
const { ethers } = require('ethers');
const ITrader = require('../ITrader');

const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];
const ADDR_RE = /^0x[0-9a-f]{40}$/;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class GangBawTrader extends ITrader {
    constructor(config = {}) {
        super(config);
        this.config = config;
        this.gangCli = config.gangCli || {};
        this.network = config.network || { name: 'BSC', chainId: 56, rpcUrl: 'https://bsc-dataseed1.binance.org/' };
        this.provider = new ethers.JsonRpcProvider(this.network.rpcUrl);
        this.wallet = null;            // { address } plain object（引擎 wallet.address 读点兼容；无 privateKey）
        this.logger = null;
        this._experimentId = null;
        this._alertHook = null;        // 引擎注入（GangWssTradingEngine._postTraderInit）→ _notifyLiveAlert
        this.txWaitTimeoutMs = null;   // 引擎 1032 行统一注入
        this.txSeenSignal = null;      // 引擎 1033 行统一注入（WSS 快速回执）
        this._padCache = new Map();    // token → 'v2' | 'v3'
        this._queue = Promise.resolve(); // 单飞行队列（BAW 外部状态机保守串行）
        this._unresolved = new Map();  // token → { kind, requestId?, txHash?, at, note } 防双发红线
        this._erc20 = (addr) => new ethers.Contract(addr, ERC20_ABI, this.provider);
        this._fatalAlertAt = new Map(); // errCode → ms（351802/351803 类全局 fatal 告警去重 1h）
    }

    setLogger(logger, experimentId) {
        this.logger = logger;
        this._experimentId = experimentId;
    }

    /** Telegram 告警钩子（引擎 _notifyLiveAlert 绑定注入；缺省打日志不静默） */
    setAlertHook(fn) {
        this._alertHook = fn;
    }

    _alert(title, body) {
        if (this._alertHook) {
            this._alertHook(title, body);
        } else {
            this.log(`[无告警钩子] ${title} | ${body}`, 'warn');
        }
    }

    log(msg, level = 'info') {
        if (this.logger) {
            this.logger[level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'info'](
                this._experimentId, 'GangBawTrader', msg);
        } else {
            console.log(`[GangBawTrader] ${msg}`);
        }
    }

    /** 钱包=BAW 链上地址（引擎 BAW 第三形态注入 traderConfig.address）。私钥参数
     *  刻意忽略（BAW 无私钥可设——签名在 App 侧）；跑 baw wallet address 对拍配置
     *  地址，不匹配 throw fail-fast（配置错误绝不带病运行）。
     *  CLI 输出形状（182 实测黄金形状）：`data.addresses[]` 多链列表——BSC 行
     *  binanceChainId='56'；兼容单地址直出形状。 */
    async setWallet(_ignoredPrivateKey) {
        const expect = String(this.config.address || '').toLowerCase();
        if (!ADDR_RE.test(expect)) {
            throw new Error('GangBawTrader: 缺 BAW 地址（traderConfig.address，引擎 BAW 第三形态注入）');
        }
        const out = await this._runCli(this._bin('bawBin', 'baw'), ['wallet', 'address', '--json'], 'BAW 地址');
        const direct = out.address || (out.data && out.data.address);
        const list = (out.data && out.data.addresses) || out.addresses || [];
        const bscRow = list.find(a => String(a.binanceChainId) === '56' || /bsc/i.test(String(a.chainName || '')));
        const actual = String(direct || (bscRow && bscRow.address) || '').toLowerCase();
        if (!ADDR_RE.test(actual)) {
            throw new Error(`BAW 地址命令输出异常（无 BSC 地址行）: ${JSON.stringify(out).slice(0, 200)}`);
        }
        if (actual !== expect) {
            throw new Error(`BAW 地址不匹配: CLI 会话 ${actual} ≠ 实验配置 ${expect}（本机 baw 会话属别的钱包，先 baw auth signin 配对）`);
        }
        this.wallet = { address: expect };
        this.log(`BAW 钱包就绪: ${expect}`);
    }

    async getNativeBalance() {
        if (!this.wallet) throw new Error('Wallet not set. Please call setWallet() first.');
        return this.provider.getBalance(this.wallet.address);
    }

    /** 买（单飞行串行）：全流程 buyToken(token, amountInWei(BNB), {expectedTokenOut}) */
    async buyToken(tokenAddress, amountInWei, options = {}) {
        return this._enqueue(() => this._buy(tokenAddress, amountInWei, options));
    }

    /** 卖（单飞行串行）：全流程 sellToken(token, amountOutWei(token 18d), {expectedNativeOut}) */
    async sellToken(tokenAddress, amountOutWei, options = {}) {
        return this._enqueue(() => this._sell(tokenAddress, amountOutWei, options));
    }

    _enqueue(fn) {
        // 前一单失败不阻塞后单（catch 只保序不吞新错）；本单错误原样抛给引擎
        const p = this._queue.then(fn, fn);
        this._queue = p.then(() => {}, () => {});
        return p;
    }

    // ─────────────────────────── CLI 封装 ───────────────────────────

    _bin(key, fallback) {
        return this.gangCli[key] || fallback;
    }

    _timeout(key, fallback) {
        return Number(this.gangCli[key]) > 0 ? Number(this.gangCli[key]) : fallback;
    }

    /** spawn CLI → stdout JSON。契约：{success:false,error} 也是正常返回（业务失败，
     *  调用方判字段）；进程层失败（崩溃/超时/非 JSON）= throw（调用方按阶段分 ①/④）。 */
    _runCli(bin, args, label) {
        return new Promise((resolve, reject) => {
            const child = spawn(bin, args, { env: process.env });
            const timeoutMs = this._timeout('spawnTimeoutMs', 60000);
            let stdout = '', stderr = '';
            const timer = setTimeout(() => {
                child.kill('SIGKILL');
                reject(new Error(`${label} CLI 超时(${timeoutMs}ms)被杀: ${bin} ${args.join(' ')}`));
            }, timeoutMs);
            child.stdout.on('data', d => { stdout += d; });
            child.stderr.on('data', d => { stderr += d; });
            child.on('error', e => {
                clearTimeout(timer);
                reject(new Error(`${label} CLI 启动失败: ${e.message}（检查 ${bin} 是否安装/PATH）`));
            });
            child.on('close', code => {
                clearTimeout(timer);
                const text = stdout.trim();
                if (!text) {
                    reject(new Error(`${label} CLI 空输出（code=${code}）stderr=${stderr.slice(0, 200)}`));
                    return;
                }
                try {
                    resolve(JSON.parse(text));
                } catch {
                    reject(new Error(`${label} CLI 输出非 JSON（code=${code}）: ${text.slice(0, 200)}`));
                }
            });
        });
    }

    /** CLI 错误码 fatal 告警（351802 devMode 过期 / 351803 Trade all tokens 未开：
     *  全局性后续必连败，逐 token 熔断不解决——去重 1h 打一轮引导人工处理） */
    _alertFatalIfKnown(out, label) {
        if (out && out.success !== false) return;
        const text = JSON.stringify(out && out.error || out || '');
        const m = text.match(/35180[23]/);
        if (!m) return;
        const code = m[0];
        const last = this._fatalAlertAt.get(code) || 0;
        if (Date.now() - last < 3600000) return;
        this._fatalAlertAt.set(code, Date.now());
        this._alert(`⛔ gang CLI 全局风控 ${code}`,
            code === '351802'
                ? 'BAW Developer Mode 已过期（7 天有效期需成功使用续期）。全部买入将持续失败，请 App 重新开启后人工核查。'
                : 'BAW「Trade all tokens」未开启（卖出被风控拦）。请 App 开启后人工核查。');
        this.log(`${label} 触发全局风控 ${code}: ${text.slice(0, 160)}`, 'error');
    }

    /** V2 金额串带千分位逗号（"1,890,146.27"）→ 数值；V3 纯小数字符串 */
    _num(v) {
        return parseFloat(String(v).replace(/,/g, ''));
    }

    // ─────────────────────── pad 分流（V2/V3） ───────────────────────

    /** token → pad。探测：先按 V2 命令 preview（只读快失败），错误指路 v3 → V3；缓存
     *  后同票零成本。误判兜底：V3 分支 preview 也报错时错误原样上抛（不猜）。 */
    async _padFor(token) {
        const cached = this._padCache.get(token);
        if (cached) return cached;
        const probe = await this._runCli(this._bin('gangBin', 'gang'),
            ['buy', '--token', token, '--bnb', '0.001', '--json'], `pad 探测(V2 试探) ${token}`);
        if (probe.success) {
            this._padCache.set(token, 'v2');
            return 'v2';
        }
        const text = JSON.stringify(probe);
        if (/v3/i.test(text)) {
            this._padCache.set(token, 'v3');
            return 'v3';
        }
        throw new Error(`pad 探测失败（非 V3 指路形状，真错误原样上抛）: ${text.slice(0, 200)}`);
    }

    // ─────────────────────── execute / 回执 / 确认 ───────────────────────

    /** execute 一段：BROADCASTED → 回执；PENDING_CONFIRMATION → 告警+轮询 tx-history
     *  等人工确认（approvalTimeoutMs 上限）。返回 {txHash, receipt}。
     *  状态未知（_runCli throw）→ 登记 unresolved 后重抛（状态机④）。 */
    async _executeRequest(bin, requestId, token, label) {
        let exec;
        try {
            exec = await this._runCli(bin, ['execute', '--request-id', requestId, '--json'], `${label} execute`);
        } catch (e) {
            this._markUnresolved(token, label, { requestId, note: `execute 状态未知: ${e.message}` });
            throw new Error(`${label} execute 状态未知（已登记防重发，人工核查后重启进程解锁）| requestId=${requestId} | ${e.message}`);
        }
        this._alertFatalIfKnown(exec, label);
        if (exec.success === false) {
            const text = JSON.stringify(exec);
            // requestId 约 5 分钟过期（expried-preview）：execute 未消费=无副作用，
            // 可安全重跑 preview（调用方 continue，previewRetried 限恰一次）
            if (/expir/i.test(text)) {
                const err = new Error(`${label} requestId 已过期（未消费无副作用，重跑 preview）: ${text.slice(0, 160)}`);
                err.expired = true;
                throw err;
            }
            throw new Error(`${label} execute 被拒: ${text.slice(0, 200)}`);
        }
        if (exec.status === 'BROADCASTED' && exec.txHash) {
            const { receipt } = await this._awaitReceiptOrFail(token, exec.txHash, label);
            return { txHash: exec.txHash, receipt, orderId: exec.orderId || null };
        }
        if (exec.status === 'PENDING_CONFIRMATION') {
            return await this._awaitApproval(exec.orderId, token, label);
        }
        throw new Error(`${label} execute 未知终态: ${JSON.stringify(exec).slice(0, 200)}`);
    }

    /** 回执等待（BROADCASTED 后）：race WSS 快速回执（txSeenSignal）/ethers 轮询；
     *  超时最后回查一次。超时无回执=tx 已广播状态未定 → unresolved 登记+throw（③）；
     *  reverted=终态确定（资金未动，重试安全）→ 清 unresolved 正常 throw。 */
    async _awaitReceiptOrFail(token, txHash, label) {
        const timeoutMs = this.txWaitTimeoutMs || 120000;
        let receipt = null;
        try {
            const wssPath = this.txSeenSignal
                ? this.txSeenSignal.waitFor(txHash, timeoutMs).then(async () => {
                    // WSS 已见 tick：短间隔拿真回执（绝不以「见过」冒充回执）
                    for (let i = 0; i < 10; i++) {
                        const r = await this.provider.getTransactionReceipt(txHash);
                        if (r) return r;
                        await sleep(300);
                    }
                    throw new Error('WSS_SEEN_BUT_NO_RECEIPT'); // 让位原路径
                }).catch(() => new Promise(() => {})) // 永续 pending 让位
                : null;
            receipt = await (wssPath
                ? Promise.race([wssPath, this.provider.waitForTransaction(txHash, 1, timeoutMs)])
                : this.provider.waitForTransaction(txHash, 1, timeoutMs));
        } catch (e) {
            if (!/timeout/i.test(String(e.message || ''))) {
                this._markUnresolved(token, label, { txHash, note: `回执等待异常: ${e.message}` });
                throw new Error(`${label} 回执等待异常 | txHash=${txHash} | ${e.message}`);
            }
        }
        if (!receipt) receipt = await this.provider.getTransactionReceipt(txHash); // 超时回查一次
        if (!receipt) {
            this._markUnresolved(token, label, { txHash, note: '回执超时（tx 已广播，终态未定）' });
            throw new Error(`${label} 确认超时(${timeoutMs / 1000}s) txHash=${txHash} —— tx 已广播未确认，已登记防重发，请人工核查（绝不自动重发防双买）`);
        }
        if (receipt.status !== 1) {
            this._unresolved.delete(token); // reverted=确定终态（资金未动），重试安全
            throw new Error(`${label} 链上执行失败(reverted): ${txHash}`);
        }
        return { receipt };
    }

    /** PENDING_CONFIRMATION（卖侧常态）→ 告警请人工 App 确认 + 轮询 tx-history
     *  （instructions 精确到 token/金额）至 confirmed。超时 → 单可能仍滞留 App 审批
     *  列表：fail-closed throw+告警（明示「勿再确认该单」防确认迟到双卖），不标记
     *  unresolved（requestId/expired 单重试=新单，旧单确认迟到的双卖风险由告警引导
     *  规避——半自动通道固有摩擦，观察点）。 */
    async _awaitApproval(orderId, token, label) {
        const timeoutMs = this._timeout('approvalTimeoutMs', 300000);
        const pollMs = this._timeout('approvalPollMs', 5000);
        const startedAt = Date.now();
        this._alert('🔔 gang 卖出待 App 确认',
            `${label} 单（orderId=${orderId}）等待 Binance App 确认，轮询 ${timeoutMs / 1000}s。` +
            `token: ${token}。请尽快在 App 确认交易。`);
        this.log(`${label} PENDING_CONFIRMATION orderId=${orderId}，轮询 tx-history 等确认（${timeoutMs / 1000}s 上限）`, 'warn');
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            await sleep(pollMs);
            const hist = await this._runCli(this._bin('bawBin', 'baw'),
                ['wallet', 'tx-history', '--binanceChainId', '56', '--type', 'confirmed', '--json'],
                `${label} tx-history 轮询`);
            const txs = (hist.data && hist.data.transactions) || hist.transactions || [];
            // confirmed 且窗口内新增（start 之后确认）且涉本 token 的单（send/receive
            // 任一臂地址匹配——卖出=send token/receive WBNB）
            const hit = txs.find(t => {
                if (t.status !== 'confirmed') return false;
                const tAt = Date.parse(t.confirmedAt || t.timestamp || t.createdAt || '') || 0;
                if (tAt && tAt < startedAt - 60000) return false;
                const ins = t.instructions || {};
                const arms = [...(ins.send || []), ...(ins.receive || [])];
                return arms.some(a =>
                    String(a.address || (a.addressInfo && a.addressInfo.address) || '').toLowerCase() === token.toLowerCase());
            });
            if (hit && hit.txHash) {
                const { receipt } = await this._awaitReceiptOrFail(token, hit.txHash, label);
                return { txHash: hit.txHash, receipt, orderId };
            }
        }
        this._alert('⏰ gang 卖出确认超时',
            `${label} 单（orderId=${orderId}）${timeoutMs / 1000}s 内未确认。` +
            `**若你仍在 App 看到该单请勿再确认**（引擎稍后会下新单，旧单确认会造成重复卖出）。` +
            `token: ${token}`);
        throw new Error(`${label} App 确认超时(${timeoutMs / 1000}s) orderId=${orderId}（引擎冷却后重下新单；旧单勿确认）`);
    }

    _markUnresolved(token, kind, detail) {
        this._unresolved.set(token, { kind, ...detail, at: new Date().toISOString() });
        this._alert('⛔ gang 交易状态未定（防重发锁）',
            `${kind} ${token} 状态未定已锁（${detail.note}）。同 token 后续买卖将被拒绝直至人工核查/重启进程。` +
            `detail=${JSON.stringify(detail)}`);
    }

    _assertNoUnresolved(token, kind) {
        const u = this._unresolved.get(token);
        if (u) {
            throw new Error(`${kind} ${token} 拒绝执行：该 token 存在未定交易（${u.kind} ${u.note} at ${u.at}），` +
                `人工核查链上终态后重启进程解锁（_syncHoldings 余额差对账会接盘链上事实）`);
        }
    }

    // ─────────────────────────── 买 ───────────────────────────

    async _buy(token, amountInWei, options = {}) {
        this._assertNoUnresolved(token, '买');
        const addr = this.wallet.address;
        const amountBnb = Number(ethers.formatEther(amountInWei));
        if (!(amountBnb > 0)) return { success: false, error: '买入金额无效' };
        const tokenC = this._erc20(token);
        const before = await tokenC.balanceOf(addr);

        const maxSteps = this._timeout('maxStepLoops', 8);
        let previewRetried = false;
        for (let step = 0; step < maxSteps; step++) {
            let pad;
            try {
                pad = await this._padFor(token);
            } catch (e) {
                return { success: false, error: `pad 探测失败: ${e.message}` };
            }
            const gangBin = this._bin('gangBin', 'gang');
            const args = pad === 'v3'
                ? ['v3', 'buy', '--token', token, '--amount', String(amountBnb), '--json']
                : ['buy', '--token', token, '--bnb', String(amountBnb), '--json'];
            let preview;
            try {
                preview = await this._runCli(gangBin, args, `买 preview(${pad})`);
            } catch (e) {
                return { success: false, error: `买 preview CLI 失败（无副作用，可重试）: ${e.message}` };
            }
            this._alertFatalIfKnown(preview, '买 preview');
            if (preview.success === false) {
                const text = JSON.stringify(preview);
                // preview 过期不适用买首跑；错误原样上抛（351802/配额/余额等业务失败）
                return { success: false, error: `买 preview 被拒(${pad}): ${text.slice(0, 200)}` };
            }
            // V2 分步（wrap-bnb → approve-quote）：每步 execute 后重跑同命令；分步 execute
            // 也走 BROADCASTED 回执等待（串行依赖，步进失败即整单失败）
            if (preview.step && preview.step !== 'buy' && preview.step !== 'v3-buy') {
                await this._executeRequest(gangBin, preview.requestId, token, `买分步 ${preview.step}`);
                continue;
            }
            // step=buy：L1 预成交校验（expectedTokenOut=引擎按信号价推导；缺失走 CLI 自带
            // minTokensOut 滑点锚降级不裸奔）+ V2 1% 帽退款拒绝（V3 无 refund 字段，
            // 0.002 BNB 试单额远低于帽——帽内截断仓位会失真 sizing，宁拒不买）
            const expectTokens = this._num(preview.expectTokens);
            if (options.expectedTokenOut > 0 && expectTokens > 0
                && expectTokens < options.expectedTokenOut * 0.5) {
                return {
                    success: false,
                    error: `L1 校验拒绝: preview expectTokens ${expectTokens} < 期望 ${options.expectedTokenOut}×0.5（信号价 vs 曲线价背离 >2 倍）`,
                };
            }
            if (pad === 'v2' && this._num(preview.expectRefund) > 0) {
                return {
                    success: false,
                    preflightReject: true,
                    error: `触 1% 钱包上限退款 ${preview.expectRefund} BNB（截断仓位失真 sizing，宁拒不买）`,
                };
            }
            // execute：BROADCASTED 直达（买侧 requireConfirmation=false 实测恒真；PENDING
            // 兜底路径同卖侧）；requestId 过期重跑 preview 恰一次
            let res;
            try {
                res = await this._executeRequest(gangBin, preview.requestId, token, `买 execute(${pad})`);
            } catch (e) {
                if (e.expired && !previewRetried) { previewRetried = true; continue; }
                throw e;
            }
            const { txHash, receipt } = res;
            // 实收=余额差法（税/退款全含在差里；WSS 竞速窗内他人买入不影响 balanceOf 差——
            // 我们的 token 余额只因我们的 tx 变动）
            const after = await tokenC.balanceOf(addr);
            const actualAmountOut = Number(ethers.formatUnits(after - before, 18));
            const gasPriceGwei = receipt.gasPrice ? Number(receipt.gasPrice) / 1e9 : null;
            this.log(`✅ 买入成交 ${pad} tx=${txHash} 得 ${actualAmountOut}`);
            this._unresolved.delete(token);
            return {
                success: true,
                transactionHash: txHash,
                actualAmountOut,
                gasUsed: receipt.gasUsed ? Number(receipt.gasUsed) : null,
                gasPrice: gasPriceGwei,
                protocol: `gang ${pad} Launchpad (BAW CLI)`,
                method: pad === 'v3' ? 'gang v3 buy' : 'gang buy',
            };
        }
        return { success: false, error: `买分步超过 ${maxSteps} 轮未到达交易步（V2 wrap/approve 异常）` };
    }

    // ─────────────────────────── 卖 ───────────────────────────

    async _sell(token, amountOutWei, options = {}) {
        this._assertNoUnresolved(token, '卖');
        const addr = this.wallet.address;
        const qty = Number(ethers.formatUnits(amountOutWei, 18));
        if (!(qty > 0)) return { success: false, error: '卖出数量无效' };
        const qtyStr = qty.toFixed(6); // CLI 精度 6 位截断（残余粉尘由引擎粉尘门/全清腿收口）
        const wbnbBefore = await this._erc20(WBNB).balanceOf(addr); // 卖出到账 WBNB 非 BNB

        const maxSteps = this._timeout('maxStepLoops', 8);
        let previewRetried = false;
        for (let step = 0; step < maxSteps; step++) {
            let pad;
            try {
                pad = await this._padFor(token);
            } catch (e) {
                return { success: false, error: `pad 探测失败: ${e.message}` };
            }
            const gangBin = this._bin('gangBin', 'gang');
            const args = pad === 'v3'
                ? ['v3', 'sell', '--token', token, '--amount', qtyStr, '--json']
                : ['sell', '--token', token, '--amount', qtyStr, '--json'];
            let preview;
            try {
                preview = await this._runCli(gangBin, args, `卖 preview(${pad})`);
            } catch (e) {
                return { success: false, error: `卖 preview CLI 失败（无副作用，可重试）: ${e.message}` };
            }
            this._alertFatalIfKnown(preview, '卖 preview');
            if (preview.success === false) {
                return { success: false, error: `卖 preview 被拒(${pad}): ${JSON.stringify(preview).slice(0, 200)}` };
            }
            if (preview.step === 'approve') {
                await this._executeRequest(gangBin, preview.requestId, token, '卖 approve 分步');
                continue;
            }
            // step=sell：L1 预成交校验（expectOut vs 引擎信号价锚；缺失走 CLI minOut 降级）
            const expectOut = this._num(preview.expectOut);
            if (options.expectedNativeOut > 0 && expectOut > 0
                && expectOut < options.expectedNativeOut * 0.5) {
                return {
                    success: false,
                    error: `L1 校验拒绝: preview expectOut ${expectOut} < 期望 ${options.expectedNativeOut}×0.5（信号价 vs 曲线价背离 >2 倍）`,
                };
            }
            let res;
            try {
                res = await this._executeRequest(gangBin, preview.requestId, token, `卖 execute(${pad})`);
            } catch (e) {
                if (e.expired && !previewRetried) { previewRetried = true; continue; }
                throw e;
            }
            const { txHash, receipt } = res;
            // 实收=WBNB 余额差（gas 从 native 扣不混入；确认等待期他人交易的曲线移动
            // 已含在我们卖单的实际成交里）
            const wbnbAfter = await this._erc20(WBNB).balanceOf(addr);
            const actualReceived = Number(ethers.formatUnits(wbnbAfter - wbnbBefore, 18));
            this.log(`✅ 卖出成交 ${pad} tx=${txHash} 得 ${actualReceived} WBNB`);
            this._unresolved.delete(token);
            return {
                success: true,
                transactionHash: txHash,
                actualReceived,
                gasUsed: receipt.gasUsed ? Number(receipt.gasUsed) : null,
                gasPrice: receipt.gasPrice ? Number(receipt.gasPrice) / 1e9 : null,
                protocol: `gang ${pad} Launchpad (BAW CLI)`,
                method: pad === 'v3' ? 'gang v3 sell' : 'gang sell',
            };
        }
        return { success: false, error: `卖分步超过 ${maxSteps} 轮未到达交易步（approve 异常）` };
    }
}

module.exports = GangBawTrader;
