// 簇门扩展 182 精确复算 v2（2026-11-15）：时间窗口径——输出 per-token 出生段活跃块序列
// （块偏移/距 block0 时间差/该块首买数），本地任意切 X 秒。
// FA 语义同 v1：尘门 0.001、wallet=sender||trader、首买=钱包最早 buy 行。
// 输入 tmp-cluster-extend-input.json（154 票）→ 输出 tmp-cluster-extend-out2.json
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager');

const DUST = 0.001;
const SPAN_MS = 150 * 1000;
const TAIL_MS = 12 * 1000; // 只输出 block0 后 12s 内活跃块（够切 X<=5s + 余量）

async function main() {
    const c = dbManager.getClient();
    const inp = require('/home/ubuntu/richer-js/tmp-cluster-extend-input.json');
    const out = [];
    let done = 0;
    for (const r of inp) {
        const { data, error } = await c.from('wss_price_ticks')
            .select('trade_type,trader_address,sender_address,bnb_amount,block_number,block_time')
            .eq('token_address', r.token)
            .order('block_time', { ascending: true })
            .limit(900);
        if (error) { out.push({ ...r, err: error.message }); continue; }
        if (!data || !data.length) { out.push({ ...r, err: 'no-ticks' }); continue; }
        const launchTs = new Date(data[0].block_time).getTime();
        const launchBlock = data[0].block_number;
        const rows = data.filter(x => new Date(x.block_time).getTime() - launchTs <= SPAN_MS);

        // FA 首买 map + 活跃块时间（尘门后任何 buy/sell）
        const firstBuyBlk = new Map(); // wallet -> blk
        const blkTs = new Map();       // blk -> 最早 block_time ms（该块首行时间）
        for (const x of rows) {
            const bnb = Number(x.bnb_amount) || 0;
            if (bnb < DUST) continue;
            const blk = x.block_number;
            if (blk == null) continue;
            const ts = new Date(x.block_time).getTime();
            if (!blkTs.has(blk) || ts < blkTs.get(blk)) blkTs.set(blk, ts);
            if (x.trade_type !== 'buy') continue;
            const w = (x.sender_address || x.trader_address || '').toLowerCase();
            if (!w || firstBuyBlk.has(w)) continue;
            firstBuyBlk.set(w, blk);
        }
        const f0 = [...firstBuyBlk.values()].filter(b => b === launchBlock).length;
        // block0 后 12s 内活跃块序列：{off, gapSec, f(该块首买数)}
        const firstBuyCountByBlk = new Map();
        for (const blk of firstBuyBlk.values()) firstBuyCountByBlk.set(blk, (firstBuyCountByBlk.get(blk) || 0) + 1);
        const tail = [...blkTs.entries()]
            .filter(([blk]) => blk > launchBlock && blkTs.get(blk) - launchTs <= TAIL_MS)
            .sort((a, b) => a[0] - b[0])
            .map(([blk, ts]) => ({
                off: blk - launchBlock,
                gapSec: +((ts - launchTs) / 1000).toFixed(2),
                f: firstBuyCountByBlk.get(blk) || 0,
                hasTrade: true,
            }));
        out.push({ ...r, launchBlock, f0, tail });
        done++;
        if (done % 30 === 0) console.log('progress', done, '/', inp.length);
    }
    require('fs').writeFileSync('/home/ubuntu/richer-js/tmp-cluster-extend-out2.json', JSON.stringify(out));
    console.log('DONE', out.length);
    process.exit(0);
}
main().catch(e => { console.error('FATAL', e.stack || e); process.exit(1); });
