/**
 * 分析实验 db041ca0-dd20-434f-a49d-142aa0cf3826
 * 调试为什么一晚上只有3个买入信号
 */

const https = require('https');

const SUPABASE_URL = 'https://ndojvftpwbbhfnqjhvkt.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kb2p2ZnB3YmJoZm5xamdodmt0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImF1ZCI6ImQwZmFhNzIyLTgyNzktNDU0ZC04YjZiLWJkN2Q2NTM1ZTUyMCIsImlhdCI6MTczMTk5MTI1OSwiZXhwIjoxMzE5OTQ4MDU5fQ.QvpdYZ8F0MjMgJ-BB4CLkGuS_jw2B68XLGLWBQJ_xGs';

const EXPERIMENT_ID = 'db041ca0-dd20-434f-a49d-142aa0cf3826';

function httpsGet(url, headers) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers }, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(body) });
                } catch (e) {
                    resolve({ status: res.statusCode, data: body });
                }
            });
        }).on('error', reject);
    });
}

async function querySupabase(table, select = '*', filters = {}) {
    let url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`;

    // 添加过滤条件
    for (const [key, value] of Object.entries(filters)) {
        url += `&${key}=${encodeURIComponent(value)}`;
    }

    const headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
    };

    return await httpsGet(url, headers);
}

async function analyzeExperiment() {
    console.log(`🔍 分析实验: ${EXPERIMENT_ID}\n`);

    // 1. 获取实验配置
    console.log('📋 1. 获取实验配置...');
    const expResult = await querySupabase('experiments', '*', { id: `eq.${EXPERIMENT_ID}` });
    console.log('实验数据:', JSON.stringify(expResult.data, null, 2));

    if (!expResult.data || expResult.data.length === 0) {
        console.log('❌ 实验不存在');
        return;
    }

    const experiment = expResult.data[0];
    const config = experiment.config;
    console.log('\n配置信息:');
    console.log('- 策略配置:', JSON.stringify(config.strategiesConfig, null, 2));
    console.log('- 仓位管理:', JSON.stringify(config.positionManagement, null, 2));
    console.log('- 虚拟交易配置:', JSON.stringify(config.virtual, null, 2));

    // 2. 获取信号统计
    console.log('\n📊 2. 获取信号统计...');
    const signalsResult = await querySupabase('strategy_signals', '*', { experiment_id: `eq.${EXPERIMENT_ID}` });
    const signals = signalsResult.data || [];

    console.log(`总信号数: ${signals.length}`);
    console.log(`买入信号: ${signals.filter(s => s.signal_type === 'BUY').length}`);
    console.log(`卖出信号: ${signals.filter(s => s.signal_type === 'SELL').length}`);
    console.log(`持有信号: ${signals.filter(s => s.action === 'hold').length}`);

    // 显示买入信号详情
    const buySignals = signals.filter(s => s.signal_type === 'BUY');
    console.log('\n买入信号详情:');
    buySignals.forEach((s, i) => {
        console.log(`\n  [${i + 1}] ${s.token_symbol} (${s.token_address})`);
        console.log(`      时间: ${s.created_at}`);
        console.log(`      执行: ${s.executed ? '是' : '否'}`);
        console.log(`      原因: ${s.reason || s.metadata?.strategyName || '-'}`);
        if (s.metadata) {
            console.log(`      元数据:`, JSON.stringify(s.metadata, null, 2));
        }
    });

    // 3. 获取代币统计
    console.log('\n🪙 3. 获取代币统计...');
    const tokensResult = await querySupabase('experiment_tokens', '*', { experiment_id: `eq.${EXPERIMENT_ID}` });
    const tokens = tokensResult.data || [];

    console.log(`总代币数: ${tokens.length}`);
    console.log(`监控中: ${tokens.filter(t => t.status === 'monitoring').length}`);
    console.log(`已买入: ${tokens.filter(t => t.status === 'bought').length}`);
    console.log(`已退出: ${tokens.filter(t => t.status === 'exited').length}`);

    // 4. 获取时序数据统计
    console.log('\n📈 4. 获取时序数据统计...');
    const timeSeriesResult = await querySupabase('experiment_time_series_data', 'token_address,loop_count,signal_type', {
        experiment_id: `eq.${EXPERIMENT_ID}`,
        order: 'timestamp.asc',
        limit: '1000'
    });
    const timeSeries = timeSeriesResult.data || [];

    console.log(`时序数据点数: ${timeSeries.length}`);

    // 统计每个代币的数据点
    const tokenDataPoints = new Map();
    timeSeries.forEach(ts => {
        const addr = ts.token_address;
        if (!tokenDataPoints.has(addr)) {
            tokenDataPoints.set(addr, { dataPoints: 0, signals: 0 });
        }
        tokenDataPoints.get(addr).dataPoints++;
        if (ts.signal_type) {
            tokenDataPoints.get(addr).signals++;
        }
    });

    console.log('\n代币数据点统计（前20个）:');
    let count = 0;
    for (const [addr, stats] of tokenDataPoints.entries()) {
        if (count++ >= 20) break;
        const token = tokens.find(t => t.token_address === addr);
        const symbol = token?.token_symbol || addr.substring(0, 8);
        console.log(`  ${symbol}: ${stats.dataPoints} 数据点, ${stats.signals} 信号`);
    }

    // 5. 检查策略条件
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
    }

    // 6. 检查时序数据中的因子值
    console.log('\n📊 6. 检查时序数据中的因子值...');
    const sampleResult = await querySupabase('experiment_time_series_data', '*', {
        experiment_id: `eq.${EXPERIMENT_ID}`,
        order: 'timestamp.desc',
        limit: '10'
    });
    const samples = sampleResult.data || [];

    if (samples.length > 0) {
        console.log('\n最近10条时序数据样本:');
        samples.forEach((s, i) => {
            console.log(`\n  [${i + 1}] ${s.token_symbol} - Loop ${s.loop_count}`);
            console.log(`      时间: ${s.timestamp}`);
            console.log(`      价格: ${s.price_usd}`);
            console.log(`      信号: ${s.signal_type || '无'}`);
            if (s.factor_values) {
                const factors = Object.keys(s.factor_values);
                console.log(`      因子: ${factors.slice(0, 10).join(', ')}${factors.length > 10 ? '...' : ''}`);
            }
        });
    }

    console.log('\n✅ 分析完成');
}

analyzeExperiment().catch(console.error);
