require('dotenv').config({ path: './config/.env' });
const { dbManager } = require('./src/services/dbManager');

async function analyze() {
    const supabase = dbManager.getClient();
    const experimentId = '3fe54786-e010-42da-990e-80a5032124f3';
    const tokenAddress = '0xfb2c7fc53103eb4fe803fe641a6c45811aba7777';

    // 首先查询总数据量
    const { count } = await supabase
        .from('experiment_time_series_data')
        .select('*', { count: 'exact', head: true })
        .eq('experiment_id', experimentId)
        .eq('token_address', tokenAddress);

    console.log('=== 总数据量 ===');
    console.log('总数据点数量:', count);
    console.log('');

    // 分页查询所有数据
    const pageSize = 100;
    let offset = 0;
    let hasMore = true;
    let allData = [];

    while (hasMore) {
        const { data, error } = await supabase
            .from('experiment_time_series_data')
            .select('timestamp, price_usd, factor_values')
            .eq('experiment_id', experimentId)
            .eq('token_address', tokenAddress)
            .order('timestamp', { ascending: true })
            .range(offset, offset + pageSize - 1);

        if (error) {
            console.error('查询失败:', error);
            break;
        }

        if (data && data.length > 0) {
            allData = allData.concat(data);
            offset += pageSize;
            hasMore = data.length === pageSize;
        } else {
            hasMore = false;
        }
    }

    console.log('实际获取数据点数量:', allData.length);
    console.log('');

    const timeSeries = allData;

    if (timeSeries && timeSeries.length > 0) {
        console.log('数据点数量:', timeSeries.length);
        console.log('');

        // 找出持有者数量最多的数据点
        let maxHolders = 0;
        let maxHoldersIdx = -1;

        timeSeries.forEach((d, idx) => {
            const fv = d.factor_values;
            if (fv && fv.holders != null) {
                if (fv.holders > maxHolders) {
                    maxHolders = fv.holders;
                    maxHoldersIdx = idx;
                }
            }
        });

        console.log('最大持有者数量: ' + maxHolders + ' (索引 ' + maxHoldersIdx + ')');
        console.log('');

        // 显示所有数据点的持有者数量
        console.log('所有数据点的关键因子:');
        console.log('序号 | 时间 | 价格 | holders | txVolumeU24h | trendTotalReturn | trendCV | trendDirectionCount | trendStrengthScore');
        console.log(''.padEnd(120, '-'));

        timeSeries.forEach((d, idx) => {
            const time = new Date(d.timestamp).toLocaleTimeString('zh-CN');
            const price = parseFloat(d.price_usd).toFixed(8);
            const fv = d.factor_values;
            const holders = fv?.holders ?? 'N/A';
            const txVolume = fv?.txVolumeU24h ?? 'N/A';
            const trendTotalReturn = fv?.trendTotalReturn?.toFixed(2) ?? 'N/A';
            const trendCV = fv?.trendCV?.toFixed(4) ?? 'N/A';
            const trendDirectionCount = fv?.trendDirectionCount ?? 'N/A';
            const trendStrengthScore = fv?.trendStrengthScore?.toFixed(1) ?? 'N/A';

            console.log(`${idx.toString().padStart(3)} | ${time} | ${price} | ${holders} | ${txVolume} | ${trendTotalReturn} | ${trendCV} | ${trendDirectionCount} | ${trendStrengthScore}`);
        });

        console.log('');
        console.log('=== 检查是否有满足所有条件的数据点 ===');

        for (let i = 0; i < timeSeries.length; i++) {
            const d = timeSeries[i];
            const fv = d.factor_values;

            if (!fv) continue;

            // 检查所有条件
            const checks = {
                'trendCV > 0.005': fv.trendCV > 0.005,
                'trendDirectionCount >= 2': fv.trendDirectionCount >= 2,
                'trendStrengthScore >= 30': fv.trendStrengthScore >= 30,
                'trendTotalReturn >= 5': fv.trendTotalReturn >= 5,
                'tvl >= 3000': fv.tvl >= 3000,
                'txVolumeU24h >= 3500': fv.txVolumeU24h >= 3500,
                'holders >= 25': fv.holders >= 25,
                'trendRecentDownRatio < 0.5': fv.trendRecentDownRatio < 0.5,
                'trendConsecutiveDowns < 2': fv.trendConsecutiveDowns < 2
            };

            const allPassed = Object.values(checks).every(v => v === true);
            const passedCount = Object.values(checks).filter(v => v).length;

            if (allPassed) {
                const time = new Date(d.timestamp).toLocaleTimeString('zh-CN');
                console.log('');
                console.log('找到满足所有条件的数据点: [' + i + '] ' + time);
                console.log('价格: $' + parseFloat(d.price_usd).toFixed(8));
                break;
            }

            // 显示接近满足条件的数据点（通过7个或以上条件）
            if (passedCount >= 7) {
                const time = new Date(d.timestamp).toLocaleTimeString('zh-CN');
                console.log('');
                console.log('[' + i + '] ' + time + ' - 通过 ' + passedCount + '/9 条件');
                Object.entries(checks).forEach(([key, passed]) => {
                    const fvValue = fv[key.replace(/ > \d+| >= \d+| < \d+| <= \d+/g, '').replace(/\s*(AND|OR)\s*/g, '')];
                    console.log('  ' + (passed ? '✓' : '✗') + ' ' + key + (passed ? '' : ' (实际值: ' + (typeof fvValue === 'number' ? fvValue.toFixed(4) : fvValue) + ')'));
                });
            }
        }
    }

    process.exit(0);
}

analyze().catch(err => { console.error(err); process.exit(1); });
