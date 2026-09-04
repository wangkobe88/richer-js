/**
 * Tick Kline Service
 *
 * wss_price_ticks → 1m K线 / 最新价（Phase 6：web K线与现价刷新去 AVE 化）
 *
 * 数据口径：
 * - tick 表按 UNIQUE(tx_hash, log_index) 全网去重（多实验竞速归属，首写者持有 experiment_id），
 *   因此 K线查询按 token_address 全市场聚合，不按 experiment_id 过滤——与旧 AVE K线的
 *   「市场级数据」语义一致。
 * - 价格取 price_usd（collector 以 BNB/USD 锚定价换算；锚定完成前的极少量 null 行剔除）。
 * - price_outlier=true 的行是 FA 离群价剔除标记，不作价。
 *
 * 已知边界（既定 trade-off）：AVE 时代旧实验没有 tick 数据，K线/现价为空；
 * 工具级的 /api/ave-kline/* 端点仍可用 AVE 查询。
 */

const PAGE_SIZE = 5000;       // 单页拉取上限（PostgREST 行数安全区）
const MAX_TICKS = 50000;      // 单次 K线聚合的 tick 上限（防失控拉全表）

class TickKlineService {
    constructor(logger) {
        this.logger = logger || console;
    }

    /**
     * 聚合 tick 为 K线
     * @param {Object} supabase - supabase 客户端
     * @param {Object} params
     * @param {string} params.tokenAddress - 代币地址
     * @param {number} params.startTimeMs - 起始时间（毫秒）
     * @param {number} params.endTimeMs - 结束时间（毫秒）
     * @param {number} [params.intervalMinutes=1] - K线周期（分钟）
     * @returns {Promise<Array<{timestamp:number, datetime:string, open_price:string, high_price:string, low_price:string, close_price:string, volume:string}>>}
     *    按时间正序；volume 为区间内 BNB 计价成交量合计
     */
    async getKline(supabase, { tokenAddress, startTimeMs, endTimeMs, intervalMinutes = 1 }) {
        const intervalMs = intervalMinutes * 60 * 1000;
        const ticks = [];
        let from = 0;

        // 分页拉取（时间窗内该代币全部有效 tick，封顶 MAX_TICKS）
        while (ticks.length < MAX_TICKS) {
            const { data, error } = await supabase
                .from('wss_price_ticks')
                .select('price_usd, bnb_amount, block_time')
                .eq('token_address', tokenAddress)
                .eq('price_outlier', false)
                .not('price_usd', 'is', null)
                .gte('block_time', new Date(startTimeMs).toISOString())
                .lte('block_time', new Date(endTimeMs).toISOString())
                .order('block_time', { ascending: true })
                .range(from, from + PAGE_SIZE - 1);

            if (error) {
                throw new Error(`查询 wss_price_ticks 失败: ${error.message}`);
            }
            if (!data || data.length === 0) break;

            ticks.push(...data);
            if (data.length < PAGE_SIZE) break; // 最后一页
            from += PAGE_SIZE;
        }

        if (ticks.length >= MAX_TICKS) {
            this.logger.warn?.(`TickKlineService: ${tokenAddress} tick 数达上限 ${MAX_TICKS}，K线可能被截断`);
        }

        // 按周期分桶聚合 OHLC
        const buckets = new Map(); // bucketStartMs → { open, high, low, close, volume }
        for (const t of ticks) {
            const timeMs = new Date(t.block_time).getTime();
            const bucketStart = Math.floor(timeMs / intervalMs) * intervalMs;
            const price = parseFloat(t.price_usd);
            if (!isFinite(price)) continue;

            let b = buckets.get(bucketStart);
            if (!b) {
                b = { open: price, high: price, low: price, close: price, volume: 0 };
                buckets.set(bucketStart, b);
            } else {
                b.high = Math.max(b.high, price);
                b.low = Math.min(b.low, price);
                b.close = price; // block_time 正序，最后一个 tick 即收盘价
            }
            const bnb = parseFloat(t.bnb_amount);
            if (isFinite(bnb)) b.volume += bnb;
        }

        return [...buckets.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([startMs, b]) => ({
                timestamp: Math.floor(startMs / 1000),
                datetime: new Date(startMs).toISOString(),
                open_price: b.open.toString(),
                high_price: b.high.toString(),
                low_price: b.low.toString(),
                close_price: b.close.toString(),
                volume: b.volume.toString()
            }));
    }

    /**
     * 批量获取代币最新价（USD）：每代币取时间最近一条有效 tick
     * @param {Object} supabase - supabase 客户端
     * @param {string[]} tokenAddresses - 代币地址列表
     * @param {number} [concurrency=20] - 并发查询数
     * @returns {Promise<Object<string, {price:number, blockTime:string}>>}
     */
    async getLatestPrices(supabase, tokenAddresses, concurrency = 20) {
        const result = {};
        const queue = [...tokenAddresses];

        const worker = async () => {
            while (queue.length > 0) {
                const address = queue.shift();
                try {
                    const { data, error } = await supabase
                        .from('wss_price_ticks')
                        .select('price_usd, block_time')
                        .eq('token_address', address)
                        .eq('price_outlier', false)
                        .not('price_usd', 'is', null)
                        .order('block_time', { ascending: false })
                        .limit(1);

                    if (error) {
                        this.logger.warn?.(`查询 ${address} 最新价失败: ${error.message}`);
                        continue;
                    }
                    if (data && data.length > 0) {
                        result[address] = {
                            price: parseFloat(data[0].price_usd),
                            blockTime: data[0].block_time
                        };
                    }
                } catch (err) {
                    this.logger.warn?.(`查询 ${address} 最新价异常: ${err.message}`);
                }
            }
        };

        await Promise.all(
            Array.from({ length: Math.min(concurrency, tokenAddresses.length) }, worker)
        );

        return result;
    }
}

module.exports = TickKlineService;
