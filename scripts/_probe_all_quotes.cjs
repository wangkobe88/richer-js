#!/usr/bin/env node
/**
 * 一次性诊断：flap 非 BNB 计价体系的全部 quote 币换算可得性分类（2026-09-30 wTCENTx 案衍生）。
 * 对每个 quote 探：V2 WBNB / V3 WBNB×4档 / V3 USDT×4档（liquidity>0 才算可用），带 symbol。
 * 只读链上，零 DB 写。输出 JSON 行到 stdout。
 */
const { ethers } = require('ethers');
const { BlockchainConfig } = require('../src/utils/BlockchainConfig');

const V2F = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';
const V3F = '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const USDT = '0x55d398326f99059fF775485246999027B3197955';
const FEES = [100, 500, 2500, 10000];

const rpcUrl = BlockchainConfig.CHAIN_CONFIGS.bsc.network.rpcUrl;
const p = new ethers.JsonRpcProvider(rpcUrl);
const v2f = new ethers.Contract(V2F, ['function getPair(address,address) view returns (address)'], p);
const v3f = new ethers.Contract(V3F, ['function getPool(address,address,uint24) view returns (address)'], p);
const PAIR_ABI = ['function getReserves() view returns (uint112,uint112,uint32)'];
const POOL_ABI = [
    'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
    'function liquidity() view returns (uint128)',
];

// 从 watcher 日志提取的 quote → 使用它的 token 数
const usage = {};
for (const line of require('fs').readFileSync('/tmp/quote-usage.txt', 'utf8').split('\n')) {
    const m = line.match(/^\s*(\d+)\s+quote=(0x[0-9a-fA-F]{40})$/i);
    if (m) usage[m[2].toLowerCase()] = Number(m[1]);
}

async function probeV3(quote, other) {
    let best = null;
    for (const fee of FEES) {
        const pool = await v3f.getPool(quote, other, fee);
        if (!pool || pool === ethers.ZeroAddress) continue;
        const c = new ethers.Contract(pool, POOL_ABI, p);
        const liq = await c.liquidity();
        if (liq > 0n && (!best || liq > best.liq)) best = { pool, fee, liq: liq.toString() };
    }
    return best;
}

async function classify(quote) {
    const out = { quote, tokens: usage[quote] || 0 };
    try {
        const erc20 = new ethers.Contract(quote, ['function symbol() view returns (string)'], p);
        out.symbol = await erc20.symbol();
    } catch { out.symbol = '?'; }
    // V2/WBNB
    const pair = await v2f.getPair(quote, WBNB);
    if (pair && pair !== ethers.ZeroAddress) {
        const c = new ethers.Contract(pair, PAIR_ABI, p);
        const [r0, r1] = await c.getReserves();
        if (r0 > 0n && r1 > 0n) out.v2Wbnb = { pair, r0: r0.toString(), r1: r1.toString() };
    }
    const v3w = await probeV3(quote, WBNB);
    if (v3w) out.v3Wbnb = v3w;
    const v3u = await probeV3(quote, USDT);
    if (v3u) out.v3Usdt = v3u;
    out.category = out.v2Wbnb ? 'V2' : out.v3Wbnb ? 'V3-WBNB' : out.v3Usdt ? 'V3-USDT' : 'NONE';
    return out;
}

(async () => {
    const quotes = Object.keys(usage).sort((a, b) => usage[b] - usage[a]);
    console.error(`probing ${quotes.length} quotes on ${rpcUrl}`);
    const CONC = 5;
    for (let i = 0; i < quotes.length; i += CONC) {
        const batch = quotes.slice(i, i + CONC);
        const results = await Promise.allSettled(batch.map(classify));
        results.forEach((r, j) => {
            if (r.status === 'fulfilled') console.log(JSON.stringify(r.value));
            else console.log(JSON.stringify({ quote: batch[j], tokens: usage[batch[j]] || 0, category: 'PROBE_ERR', err: String(r.reason).slice(0, 120) }));
        });
        if (i % 25 === 0) console.error(`  ${i + batch.length}/${quotes.length}`);
    }
    process.exit(0);
})();
