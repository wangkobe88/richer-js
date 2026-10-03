#!/usr/bin/env node
/**
 * four.meme 非 BNB 计价盘（自定义 ERC20 quote）全量扫描（只在 182 跑）
 *
 * 背景（2026-10-03 0xe1d5c933…ffff 案）：four.meme TokenManager2 支持 ERC20/ERC20 交易对，
 * 事件里的 price/amount 是 quote 币单位；fourmeme collector 无 quote 处理（flap 才有三级
 * 换算），这些行被原样当 BNB 落库（price_bnb/bnb_amount/quote_token=NULL），下游
 * graduationProgress（72 锚）/marketCap/买卖腿/现金账本全部失真。
 *
 * 扫描口径：
 *   1. eth_getLogs 枚举 TokenManager2 的 TokenCreate 事件（链上权威源。wss_events 被 flap
 *      token_quote_set 331 万行撑大，kind 过滤必 statement timeout——2026-10-03 两轮实测；
 *      dataseed 全家禁 getLogs（-32005），publicnode 限跨度 ≤5k 块/403，分片走 publicnode）
 *   2. Multicall3 批量 eth_call TokenManagerHelper3.getTokenInfo(token) → quote 分类
 *      WBNB=正常 / 非零非 WBNB=污染源 / 0x0=已清除（毕业删档或失败盘）
 *   3. 污染源：quote 币 symbol、funds/maxFunds 真实进度、liquidityAdded、graduation 事件
 *   4. 影响面（仅污染源，量小）：ticks 计数 / strategy_signals / trades
 *
 * 用法：node scripts/scan-fourmeme-quote-tokens.cjs [--json-only] [--days N]
 * 输出：控制台汇总 + data/scan-fourmeme-quote-tokens-<ts>.json
 */
const path = require('path');
const fs = require('fs');
const { ethers } = require('ethers');
const { dbManager } = require(path.join(__dirname, '..', 'src', 'services', 'dbManager'));

const HELPER = '0xF251F83e40a78868FcfA3FA4599Dad6494E46034'; // TokenManagerHelper3（live trader 同源）
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'; // canonical Multicall3（BSC 已部署）
const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const TOKEN_MANAGER_2 = '0x5c952063c7fc8610FFDB798152D69F0B9550762b'; // watcher 订阅口径（subscribeV1=false）
const TOKEN_CREATE_TOPIC0 = ethers.id('TokenCreate(address,address,uint256,string,string,uint256,uint256,uint256)');
const CREATE_DATA_TYPES = ['address', 'address', 'uint256', 'string', 'string', 'uint256', 'uint256', 'uint256'];
// getLogs 专用：182 的 ANKR 付费连接（config/.env ANKR_WS_URL 换 https 同路径）。
// 实测矩阵（2026-10-03）：dataseed 全家禁 getLogs（-32005）；publicnode 仅链头 ~5k 深度（更深 403，
// 12 天历史枚举不可行）；ANKR HTTP/WSS 对 230 万块深度的 5k 分片均 OK（648 logs/片）。
function ankrHttpUrlFromEnv() {
    const envPath = path.join(__dirname, '..', 'config', '.env');
    const m = fs.readFileSync(envPath, 'utf8').match(/^ANKR_WS_URL=["']?([^"'\r\n]+)["']?/m);
    if (!m) throw new Error('config/.env 缺 ANKR_WS_URL');
    return m[1].trim().replace(/^wss:\/\//, 'https://');
}
const BATCH = 150; // 每 multicall 打包的 token 数
const GETLOGS_CHUNK = 5000;

const GET_TOKEN_INFO_ABI = [
    'function getTokenInfo(address token) view returns (uint256 version, address tokenManager, address quote, uint256 lastPrice, uint256 tradingFeeRate, uint256 minTradingFee, uint256 launchTime, uint256 offers, uint256 maxOffers, uint256 funds, uint256 maxFunds, bool liquidityAdded)',
];
const ERC20_ABI = ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'];
const MULTICALL_ABI = ['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] results)'];

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** eth_call 池（dataseed，启动健康检查剔除死端点） */
class CallPool {
    constructor(urls) {
        this.providers = [];
        this.i = 0;
        this.mc = new ethers.Interface(MULTICALL_ABI);
        this.iface = new ethers.Interface(GET_TOKEN_INFO_ABI);
        this.erc20 = new ethers.Interface(ERC20_ABI);
        this.coder = ethers.AbiCoder.defaultAbiCoder();
        this._candidates = urls;
    }
    async init() {
        for (const u of this._candidates) {
            try {
                const p = new ethers.JsonRpcProvider(u, 56, { batchMaxCount: 1 });
                const net = await Promise.race([p.getNetwork(), sleep(6000).then(() => { throw new Error('timeout'); })]);
                if (String(net.chainId) === '56') this.providers.push(p);
            } catch { /* 剔除 */ }
        }
        if (!this.providers.length) throw new Error('无可用 dataseed eth_call 端点');
        return this.providers.length;
    }
    next() { const p = this.providers[this.i % this.providers.length]; this.i++; return p; }

    async withRetry(fn, what, tries = 3) {
        let lastErr = null;
        for (let a = 0; a < tries; a++) {
            try { return await fn(this.next()); }
            catch (e) {
                lastErr = e;
                log(`  ${what} 失败（attempt ${a + 1}/${tries}）：${e.message.slice(0, 80)}`);
                await sleep(1500 * (a + 1));
            }
        }
        throw lastErr;
    }

    async multicall(calls) {
        const calldata = calls.map((c) => ({ target: c.target, allowFailure: true, callData: c.iface.encodeFunctionData(c.fn, c.args) }));
        const payload = this.mc.encodeFunctionData('aggregate3', [calldata]);
        const ret = await this.withRetry(async (p) => p.call({ to: MULTICALL3, data: payload }), 'multicall');
        const [results] = this.mc.decodeFunctionResult('aggregate3', ret);
        return results.map((r, idx) => {
            if (!r.success) return { idx, error: 'call-failed' };
            try {
                const d = calls[idx].iface.decodeFunctionResult(calls[idx].fn, r.returnData);
                return { idx, values: Array.from(d) };
            } catch (e) {
                return { idx, error: `decode-failed:${e.message.slice(0, 60)}` };
            }
        });
    }
}

/** getLogs 专用连接（单 publicnode，403/429 冷却、范围错误降片） */
async function getLogsChunk(provider, from, to) {
    return provider.send('eth_getLogs', [{
        address: TOKEN_MANAGER_2,
        topics: [TOKEN_CREATE_TOPIC0],
        fromBlock: '0x' + from.toString(16),
        toBlock: '0x' + to.toString(16),
    }]);
}

/** 二分找 timestamp ≥ targetSec 的最早块（块时间戳单调不减；BSC 出块间隔历经 0.75s→0.45s，不可假设常数） */
async function findBlockByTime(provider, targetSec, latest) {
    let lo = 0, hi = latest;
    // 假设 hi 的 ts ≥ target（调用方保证）；先取端点缓存避免重复 getBlock
    const cache = new Map();
    const tsOf = async (n) => {
        if (cache.has(n)) return cache.get(n);
        const b = await provider.send('eth_getBlockByNumber', ['0x' + n.toString(16), false]);
        const t = Number(b.timestamp);
        cache.set(n, t);
        return t;
    };
    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if ((await tsOf(mid)) < targetSec) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

async function fetchTokenCreatesFromChain(provider, days, logFn) {
    const latest = await provider.send('eth_blockNumber', []);
    const latestN = parseInt(latest, 16);
    const targetSec = Math.floor(Date.now() / 1000) - days * 86400;
    const fromBlock = await findBlockByTime(provider, targetSec, latestN);
    logFn(`latest=${latestN} from=${fromBlock}（${days} 天 ≈ ${latestN - fromBlock} 块）`);
    const out = new Map(); // token → { blockNumber, totalSupply, name, symbol }
    let chunk = GETLOGS_CHUNK;
    let start = fromBlock;
    let chunksDone = 0;
    let rateLimitStreak = 0;
    let floorFails = 0; // chunk 已到下限仍持续被拒的轮数（防无限循环，fail-loud）
    while (start <= latestN) {
        const end = Math.min(start + chunk - 1, latestN);
        let logs;
        try {
            logs = await getLogsChunk(provider, start, end);
            rateLimitStreak = 0;
            floorFails = 0;
        } catch (e) {
            const msg = String(e.message || e);
            if (/403|429|rate/i.test(msg) && rateLimitStreak < 6) { // 限频：冷却重试同片
                rateLimitStreak++;
                logFn(`  限频冷却 8s（${msg.slice(0, 50)}）`);
                await sleep(8000);
                continue;
            }
            const newChunk = Math.max(1000, Math.floor(chunk / 2)); // 范围超限或持续 403：降片
            if (newChunk === chunk) {
                floorFails++;
                if (floorFails >= 10) throw new Error(`getLogs 持续被拒（chunk 已到下限 ${chunk}，端点对本机 IP 硬拒）`);
            }
            chunk = newChunk;
            rateLimitStreak = 0;
            logFn(`  getLogs 片段降级 → chunk=${chunk}（${msg.slice(0, 60)}）`);
            continue;
        }
        for (const l of logs || []) {
            try {
                const d = ethers.AbiCoder.defaultAbiCoder().decode(CREATE_DATA_TYPES, l.data);
                const token = String(d[1]).toLowerCase();
                const block = parseInt(l.blockNumber, 16);
                const prev = out.get(token);
                if (!prev || block < prev.blockNumber) {
                    out.set(token, {
                        blockNumber: block,
                        totalSupply: Number(ethers.formatEther(d[5])),
                        name: d[3], symbol: d[4],
                    });
                }
            } catch { /* 单条解码失败不中断 */ }
        }
        start = end + 1;
        chunksDone++;
        if (chunksDone % 50 === 0) logFn(`  进度 ${((start - fromBlock) / (latestN - fromBlock) * 100).toFixed(0)}%（${out.size} token）`);
        await sleep(80); // 温和限速
    }
    return out;
}

async function main() {
    const jsonOnly = process.argv.includes('--json-only');
    const daysIdx = process.argv.indexOf('--days');
    const days = daysIdx > -1 ? parseInt(process.argv[daysIdx + 1], 10) || 12 : 12;
    const enumOnlyIdx = process.argv.indexOf('--enum-only'); // --enum-only <out.json>：只跑 Step1 枚举并落盘（publicnode 拒 182 时本地跑）
    const enumFileIdx = process.argv.indexOf('--enum-file'); // --enum-file <in.json>：跳过 Step1，直接用枚举结果（182 接力）
    const db = dbManager.getClient();
    const cfg = require(path.join(__dirname, '..', 'config', 'default.json'));
    const callPool = new CallPool(cfg.senderResolve?.rpcUrls?.length ? cfg.senderResolve.rpcUrls : ['https://bsc-dataseed.bnbchain.org']);
    const nOk = await callPool.init();
    log(`eth_call 池就绪：${nOk} 个 dataseed 端点`);

    // ── 1. 链上枚举 TokenCreate ──
    let tokens;
    if (enumFileIdx > -1) {
        const enumFile = process.argv[enumFileIdx + 1];
        tokens = new Map(JSON.parse(fs.readFileSync(enumFile, 'utf8')));
        log(`Step1(跳过): 从 ${enumFile} 载入枚举结果 ${tokens.size} token`);
    } else {
        const logsProvider = new ethers.JsonRpcProvider(ankrHttpUrlFromEnv(), 56, { batchMaxCount: 1, staticNetwork: true });
        log(`Step1: eth_getLogs 枚举 TokenManager2 TokenCreate（${days} 天）…`);
        tokens = await fetchTokenCreatesFromChain(logsProvider, days, log);
        const enumCache = path.join(__dirname, '..', 'data', `scan-fourmeme-enum-${Date.now()}.json`);
        fs.writeFileSync(enumCache, JSON.stringify([...tokens.entries()]));
        log(`枚举快照已落 ${enumCache}（后续阶段崩溃可用 --enum-file 接力）`);
        if (enumOnlyIdx > -1) {
            const outFile = process.argv[enumOnlyIdx + 1];
            fs.writeFileSync(outFile, JSON.stringify([...tokens.entries()]));
            log(`枚举结果已写入 ${outFile}（${tokens.size} token）`);
            dbManager.cleanup();
            return;
        }
    }
    const addrs = [...tokens.keys()];
    log(`  共 ${addrs.length} 个 four.meme token`);

    // ── 2. 批量链上查 quote ──
    log(`Step2: Multicall3 批量 getTokenInfo（batch=${BATCH}）…`);
    const info = new Map(); // token → {quote, funds, maxFunds, liquidityAdded, error?}
    const calls = addrs.map((a) => ({ target: HELPER, iface: callPool.iface, fn: 'getTokenInfo', args: [a] }));
    let done = 0;
    // 并发 worker（每 dataseed 端点一路；串行实测 6s/批 → 1111 批要 111 分钟，5 路并发 ≈ 22 分钟）
    const rangeStarts = [];
    for (let i = 0; i < calls.length; i += BATCH) rangeStarts.push(i);
    let nextRange = 0;
    const workerCount = Math.max(1, callPool.providers.length);
    const lastLogged = { at: 0 };
    const worker = async () => {
        while (true) {
            const ri = nextRange++;
            if (ri >= rangeStarts.length) return;
            const i = rangeStarts[ri];
            const slice = calls.slice(i, i + BATCH);
            const sliceTokens = addrs.slice(i, i + BATCH);
            const results = await callPool.multicall(slice);
            for (const r of results) {
                const t = sliceTokens[r.idx];
                if (r.error) { info.set(t, { error: r.error }); continue; }
                const v = r.values;
                info.set(t, {
                    version: Number(v[0]),
                    tokenManager: String(v[1]).toLowerCase(),
                    quote: String(v[2]).toLowerCase(),
                    funds: Number(ethers.formatEther(BigInt(v[9]))),
                    maxFunds: Number(ethers.formatEther(BigInt(v[10]))),
                    liquidityAdded: v[11] === true,
                });
            }
            done += slice.length;
            if (!jsonOnly && Date.now() - lastLogged.at > 15000) { lastLogged.at = Date.now(); log(`  进度 ${done}/${calls.length}`); }
        }
    };
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    // ── 3. 分类 ──
    // 实测语义（2026-10-03 抽样验证）：quote=0x0 且 version≠0 = 正常 BNB 内盘（占大头）；
    // version=0 + mgr=0x0 + quote=0x0 = 毕业删档/失败盘（真清除）；quote=非零非 WBNB = ERC20 quote 盘。
    const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
    const normal = [], polluted = [], cleared = [], errored = [];
    for (const [t, v] of info) {
        if (v.error) { errored.push({ token: t, ...v }); continue; }
        if (v.version === 0 && v.tokenManager === ZERO_ADDR) cleared.push(t);
        else if (v.quote === ZERO_ADDR) normal.push(t);
        else if (v.quote === WBNB) normal.push(t); // 理论不存在（four.meme BNB 盘 quote=0x0），留观察桶
        else polluted.push({ token: t, ...v, ...tokens.get(t) });
    }
    log(`分类: BNB正常=${normal.length} | 非BNB计价=${polluted.length} | 已清除=${cleared.length} | 查询失败=${errored.length}`);

    // quote 币 symbol
    const quoteAddrs = [...new Set(polluted.map((p) => p.quote))];
    const quoteMeta = {};
    if (quoteAddrs.length) {
        const symResults = await callPool.multicall(quoteAddrs.map((q) => ({ target: q, iface: callPool.erc20, fn: 'symbol', args: [] })));
        for (const r of symResults) {
            const q = quoteAddrs[r.idx];
            quoteMeta[q] = r.error ? `?(${r.error})` : String(r.values[0]);
        }
    }

    // ── 4. 影响面 ──
    // 逐 token 的 ticks/graduation 查询只跑 funds>0 活跃盘（funds=0 死盘 13 万逐查是灾难；
    // 抽样实测死盘无 swap 活动）。signals/trades 批查覆盖全量（兜住「死盘被实验碰过」）。
    const activePolluted = polluted.filter((p) => p.funds > 0);
    log(`活跃 quote 盘（funds>0）=${activePolluted.length} / 死盘（funds=0）=${polluted.length - activePolluted.length}`);
    for (const p of activePolluted) {
        const { count: tickCount } = await db.from('wss_price_ticks')
            .select('id', { count: 'exact', head: true }).eq('token_address', p.token);
        p.tickCount = tickCount ?? 0;
        const { data: grad } = await db.from('wss_events')
            .select('created_at').eq('token_address', p.token).eq('kind', 'graduation').limit(1);
        p.graduatedInDb = (grad || []).length > 0;
    }
    const pollTokens = polluted.map((p) => p.token);
    const impact = {};
    if (pollTokens.length) {
        const sigByToken = new Map();
        for (let i = 0; i < pollTokens.length; i += 50) {
            const { data } = await db.from('strategy_signals')
                .select('token_address,experiment_id,action,created_at')
                .in('token_address', pollTokens.slice(i, i + 50)).limit(10000);
            for (const s of data || []) {
                const k = s.token_address.toLowerCase();
                if (!sigByToken.has(k)) sigByToken.set(k, []);
                sigByToken.get(k).push(`${(s.experiment_id || '').slice(0, 8)}:${s.action}@${String(s.created_at).slice(5, 19)}`);
            }
        }
        const tradeByToken = new Map();
        for (let i = 0; i < pollTokens.length; i += 50) {
            const { data } = await db.from('trades')
                .select('token_address,experiment_id,created_at')
                .in('token_address', pollTokens.slice(i, i + 50)).limit(10000);
            for (const t of data || []) {
                const k = t.token_address.toLowerCase();
                if (!tradeByToken.has(k)) tradeByToken.set(k, []);
                tradeByToken.get(k).push(`${(t.experiment_id || '').slice(0, 8)}@${String(t.created_at).slice(5, 19)}`);
            }
        }
        for (const p of polluted) {
            impact[p.token] = {
                signals: sigByToken.get(p.token) || [],
                trades: tradeByToken.get(p.token) || [],
            };
        }
    }

    // ── 5. 汇总输出 ──
    const byQuote = {};
    for (const p of polluted) {
        const key = `${quoteMeta[p.quote] || '?'} ${p.quote}`;
        if (!byQuote[key]) byQuote[key] = { tokens: 0, active: 0, dead: 0, ticks: 0, minBlock: null, maxBlock: null, graduated: 0 };
        byQuote[key].tokens++;
        if (p.funds > 0) byQuote[key].active++; else byQuote[key].dead++;
        byQuote[key].ticks += p.tickCount ?? 0;
        if (byQuote[key].minBlock == null || p.blockNumber < byQuote[key].minBlock) byQuote[key].minBlock = p.blockNumber;
        if (byQuote[key].maxBlock == null || p.blockNumber > byQuote[key].maxBlock) byQuote[key].maxBlock = p.blockNumber;
        if (p.liquidityAdded || p.graduatedInDb) byQuote[key].graduated++;
    }

    // 明细收敛：死盘（funds=0 且零信号零交易）只进聚合不落明细（13 万条 × name/symbol 会撑爆 JSON）
    const detailPolluted = polluted.filter((p) =>
        p.funds > 0 || (impact[p.token]?.signals || []).length > 0 || (impact[p.token]?.trades || []).length > 0);
    const report = {
        scannedAt: new Date().toISOString(),
        scanWindowDays: days,
        totalFourmemeTokens: addrs.length,
        classification: { bnbNormal: normal.length, nonBnb: polluted.length, activeNonBnb: activePolluted.length, cleared: cleared.length, errored: errored.length },
        byQuote,
        polluted: detailPolluted.map((p) => ({
            token: p.token,
            symbol: p.symbol, name: p.name,
            quote: `${quoteMeta[p.quote] || '?'} ${p.quote}`,
            createBlock: p.blockNumber,
            totalSupply: p.totalSupply,
            funds: +p.funds.toFixed(4), maxFunds: +p.maxFunds.toFixed(4),
            fundsProgress: p.maxFunds > 0 ? +(p.funds / p.maxFunds).toFixed(4) : null,
            liquidityAdded: p.liquidityAdded, graduatedInDb: p.graduatedInDb ?? false,
            tickCount: p.tickCount ?? null,
            signals: impact[p.token]?.signals || [],
            trades: impact[p.token]?.trades || [],
        })),
        errored: errored.slice(0, 50),
    };
    const outPath = path.join(__dirname, '..', 'data', `scan-fourmeme-quote-tokens-${Date.now()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    log(`报告已写入 ${outPath}（明细 ${detailPolluted.length} 条）`);

    if (!jsonOnly) {
        console.log('\n════════ 汇总 ════════');
        console.log(`four.meme token 总数（${days} 天链上枚举）: ${addrs.length}`);
        console.log(`BNB 正常盘: ${normal.length} | 非BNB计价: ${polluted.length}（活跃 ${activePolluted.length} / 死盘 ${polluted.length - activePolluted.length}）| 已清除: ${cleared.length} | 失败: ${errored.length}`);
        console.log('\n按 quote 币分组:');
        for (const [k, v] of Object.entries(byQuote)) {
            console.log(`  ${k}: ${v.tokens} token（活跃 ${v.active}/死 ${v.dead}）/ ${v.ticks} ticks / 块 ${v.minBlock}~${v.maxBlock} / 已毕业 ${v.graduated}`);
        }
        const hitPolluted = report.polluted.filter((p) => (p.tickCount ?? 0) > 0 || p.signals.length > 0 || p.trades.length > 0);
        console.log(`\n影响面命中（有 ticks/信号/交易）${hitPolluted.length} 条:`);
        for (const p of hitPolluted) {
            console.log(`  ${p.token} ${String(p.symbol).slice(0, 12)} quote=${p.quote.split(' ')[0]} funds=${p.funds}/${p.maxFunds} ticks=${p.tickCount} grad=${p.liquidityAdded || p.graduatedInDb} signals=${p.signals.length} trades=${p.trades.length}`);
        }
    }
    dbManager.cleanup();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
