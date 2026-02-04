/**
 * 通过本地API分析实验 db041ca0-dd20-434f-a49d-142aa0cf3826
 */

const API_BASE = 'http://localhost:3010/api';
const EXPERIMENT_ID = 'db041ca0-dd20-434f-a49d-142aa0cf3826';

async function fetchAPI(endpoint) {
    const response = await fetch(`${API_BASE}${endpoint}`);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
}

async function analyzeExperiment() {
    console.log(`🔍 分析实验: ${EXPERIMENT_ID}\n`);

    try {
        // 1. 获取实验详情
        console.log('📋 1. 获取实验配置...');
        const expResult = await fetchAPI(`/experiment/${EXPERIMENT_ID}`);
        console.log('实验数据:', JSON.stringify(expResult.data, null, 2));

        const experiment = expResult.data;
        const config = experiment.config;

        console.log('\n配置信息:');
        console.log('- 策略配置:', JSON.stringify(config.strategiesConfig, null, 2));
        console.log('- 仓位管理:', JSON.stringify(config.positionManagement, null, 2));

        // 2. 获取信号统计
        console.log('\n📊 2. 获取信号统计...');
        const signalsResult = await fetchAPI(`/experiment/${EXPERIMENT_ID}/signals?limit=1000`);
        const signals = signalsResult.signals || [];

        console.log(`总信号数: ${signals.length}`);
        console.log(`买入信号: ${signals.filter(s => s.action === 'buy' || s.signal_type === 'BUY').length}`);
        console.log(`卖出信号: ${signals.filter(s => s.action === 'sell' || s.signal_type === 'SELL').length}`);

        // 显示买入信号详情
        const buySignals = signals.filter(s => s.action === 'buy' || s.signal_type === 'BUY');
        console.log('\n买入信号详情:');
        buySignals.forEach((s, i) => {
            console.log(`\n  [${i + 1}] ${s.symbol || s.token_symbol} (${s.token_address})`);
            console.log(`      时间: ${s.created_at || s.timestamp}`);
            console.log(`      执行: ${s.executed ? '是' : '否'}`);
            console.log(`      原因: ${s.reason || '-'}`);
            if (s.metadata) {
                console.log(`      元数据:`, JSON.stringify(s.metadata, null, 2));
            }
        });

        // 显示所有信号（包括hold）
        console.log('\n所有信号列表（最近50条）:');
        signals.slice(0, 50).forEach((s, i) => {
            const action = s.action || s.signal_type || '?';
            const symbol = s.symbol || s.token_symbol || '???';
            console.log(`  [${i + 1}] ${action.padEnd(6)} ${symbol.padEnd(15)} ${s.created_at || s.timestamp}`);
        });

        // 3. 获取代币统计
        console.log('\n🪙 3. 获取代币统计...');
        const tokensResult = await fetchAPI(`/experiment/${EXPERIMENT_ID}/tokens?limit=10000`);
        const tokens = tokensResult.tokens || [];

        console.log(`总代币数: ${tokens.length}`);
        console.log(`监控中: ${tokens.filter(t => t.status === 'monitoring').length}`);
        console.log(`已买入: ${tokens.filter(t => t.status === 'bought').length}`);
        console.log(`已退出: ${tokens.filter(t => t.status === 'exited').length}`);

        // 显示前20个代币
        console.log('\n前20个代币:');
        tokens.slice(0, 20).forEach((t, i) => {
            console.log(`  [${i + 1}] ${t.token_symbol.padEnd(12)} ${t.status.padEnd(10)} ${t.discovered_at}`);
        });

        // 4. 获取时序数据统计
        console.log('\n📈 4. 获取时序数据...');
        const timeSeriesResult = await fetchAPI(`/experiment/time-series/data?experimentId=${EXPERIMENT_ID}`);
        const timeSeries = timeSeriesResult.data || [];

        console.log(`时序数据点数: ${timeSeries.length}`);

        if (timeSeries.length > 0) {
            // 统计每个代币的数据点
            const tokenDataPoints = new Map();
            timeSeries.forEach(ts => {
                const addr = ts.token_address;
                if (!tokenDataPoints.has(addr)) {
                    tokenDataPoints.set(addr, { dataPoints: 0, signals: 0, buySignals: 0, sellSignals: 0 });
                }
                tokenDataPoints.get(addr).dataPoints++;
                if (ts.signal_type === 'BUY') tokenDataPoints.get(addr).buySignals++;
                if (ts.signal_type === 'SELL') tokenDataPoints.get(addr).sellSignals++;
            });

            console.log('\n代币数据点统计（前20个）:');
            let count = 0;
            for (const [addr, stats] of tokenDataPoints.entries()) {
                if (count++ >= 20) break;
                const token = tokens.find(t => t.token_address === addr);
                const symbol = token?.token_symbol || addr.substring(0, 8);
                console.log(`  ${symbol.padEnd(12)} 数据点:${stats.dataPoints.toString().padStart(4)} 买入:${stats.buySignals} 卖出:${stats.sellSignals}`);
            }

            // 检查因子值
            console.log('\n检查时序数据中的因子值...');
            const samples = timeSeries.slice(-10);
            console.log('最近10条时序数据:');
            samples.forEach((s, i) => {
                console.log(`\n  [${i + 1}] ${s.token_symbol} - Loop ${s.loop_count}`);
                console.log(`      时间: ${s.timestamp}`);
                console.log(`      价格: ${s.price_usd}`);
                console.log(`      信号: ${s.signal_type || '无'}`);
                if (s.factor_values) {
                    console.log(`      因子:`, JSON.stringify(s.factor_values, null, 2));
                }
            });
        }

        // 5. 分析策略条件
        console.log('\n🎯 5. 分析策略条件...');
        if (config.strategiesConfig) {
            const { buyStrategies, sellStrategies } = config.strategiesConfig;

            console.log(`买入策略数量: ${buyStrategies?.length || 0}`);
            if (buyStrategies && buyStrategies.length > 0) {
                buyStrategies.forEach((s, i) => {
                    console.log(`\n  买入策略 [${i + 1}]:`);
                    console.log(`    条件: ${s.condition}`);
                    console.log(`    卡牌: ${s.cards}`);
                    console.log(`    优先级: ${s.priority}`);
                    console.log(`    冷却时间: ${s.cooldown || '无'}`);
                });
            }

            console.log(`\n卖出策略数量: ${sellStrategies?.length || 0}`);
            if (sellStrategies && sellStrategies.length > 0) {
                sellStrategies.forEach((s, i) => {
                    console.log(`\n  卖出策略 [${i + 1}]:`);
                    console.log(`    条件: ${s.condition}`);
                    console.log(`    卡牌: ${s.cards}`);
                    console.log(`    优先级: ${s.priority}`);
                });
            }
        }

        console.log('\n✅ 分析完成');

    } catch (error) {
        console.error('❌ 分析失败:', error.message);
    }
}

analyzeExperiment();
