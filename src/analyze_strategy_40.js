/**
 * 分析 earlyReturn >= 40% 的策略效果
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

async function analyzeWithLowerThreshold() {
    console.log(`🔍 分析策略: earlyReturn >= 40%\n`);

    // 策略参数
    const AGE_LIMIT = 5;
    const RETURN_MIN = 40;  // 改为 40
    const RETURN_MAX = 150;

    console.log(`🎯 新策略条件:`);
    console.log(`age < ${AGE_LIMIT} AND ${RETURN_MIN}% <= earlyReturn < ${RETURN_MAX}%`);
    console.log('');

    // 获取所有有时序数据的代币
    console.log('📊 1. 获取代币列表...');

    // 获取所有时序数据的代币地址
    const tsResult = await fetchAPI(`/experiment/time-series/data?experimentId=${EXPERIMENT_ID}`);
    const allTsData = tsResult.data || [];

    // 按代币分组
    const tokenData = new Map();
    allTsData.forEach(ts => {
        const addr = ts.token_address;
        if (!tokenData.has(addr)) {
            tokenData.set(addr, {
                address: addr,
                symbol: ts.token_symbol,
                dataPoints: []
            });
        }
        tokenData.get(addr).dataPoints.push(ts);
    });

    console.log(`总代币数(有时序数据): ${tokenData.size}`);

    // 分析每个代币
    const results = [];
    let processed = 0;

    for (const [addr, data] of tokenData) {
        const windowData = data.dataPoints.filter(ts => {
            const age = ts.factor_values?.age || 0;
            return age < AGE_LIMIT;
        });

        if (windowData.length === 0) continue;

        // 检查窗口内是否有任何一个点在 40%-150% 范围内
        const triggerPoint = windowData.find(ts => {
            const earlyReturn = ts.factor_values?.earlyReturn || 0;
            return earlyReturn >= RETURN_MIN && earlyReturn < RETURN_MAX;
        });

        // 计算最终收益
        const collectionPrice = data.dataPoints[0].factor_values?.collectionPrice || 0;
        const finalPrice = data.dataPoints[data.dataPoints.length - 1].factor_values?.currentPrice || 0;
        let finalReturn = 0;
        if (collectionPrice > 0 && finalPrice > 0) {
            finalReturn = ((finalPrice - collectionPrice) / collectionPrice) * 100;
        }

        // 计算整体峰值
        const allReturns = data.dataPoints.map(ts => ts.factor_values?.earlyReturn || 0);
        const overallMax = Math.max(...allReturns);

        results.push({
            address: addr,
            symbol: data.symbol,
            triggered: !!triggerPoint,
            triggerPoint: triggerPoint ? {
                age: triggerPoint.factor_values?.age,
                earlyReturn: triggerPoint.factor_values?.earlyReturn,
                loop: triggerPoint.loop_count
            } : null,
            windowMax: Math.max(...windowData.map(ts => ts.factor_values?.earlyReturn || 0)),
            overallMax,
            finalReturn,
            dataPointCount: data.dataPoints.length
        });

        processed++;
        if (processed % 100 === 0) {
            console.log(`已分析 ${processed}/${tokenData.size} 个代币...`);
        }
    }

    console.log(`\n分析完成: ${processed} 个代币\n`);

    // 统计结果
    const triggered = results.filter(r => r.triggered);
    const notTriggered = results.filter(r => !r.triggered);

    console.log('📊 策略结果统计:');
    console.log('─'.repeat(90));
    console.log(`总代币数: ${results.length}`);
    console.log(`触发买入: ${triggered.length} (${(triggered.length/results.length*100).toFixed(1)}%)`);
    console.log(`未触发: ${notTriggered.length} (${(notTriggered.length/results.length*100).toFixed(1)}%)`);

    // 收益分析
    if (triggered.length > 0) {
        const profits = triggered.filter(r => r.finalReturn > 0);
        const losses = triggered.filter(r => r.finalReturn <= 0);
        const avgReturn = triggered.reduce((sum, r) => sum + r.finalReturn, 0) / triggered.length;
        const totalReturn = triggered.reduce((sum, r) => sum + r.finalReturn, 0);

        console.log(`\n💰 收益分析:`);
        console.log('─'.repeat(90));
        console.log(`盈利交易: ${profits.length} (${(profits.length/triggered.length*100).toFixed(1)}%)`);
        console.log(`亏损交易: ${losses.length} (${(losses.length/triggered.length*100).toFixed(1)}%)`);
        console.log(`平均收益: ${avgReturn.toFixed(1)}%`);
        console.log(`总收益: ${totalReturn.toFixed(1)}%`);

        // 显示所有触发交易的详情
        console.log(`\n📋 所有触发交易的代币:`);
        console.log('─'.repeat(90));

        // 按最终收益排序
        triggered.sort((a, b) => b.finalReturn - a.finalReturn);

        triggered.forEach((r, i) => {
            const status = r.finalReturn > 0 ? '✅ 盈利' : '❌ 亏损';
            console.log(`[${i + 1}] ${r.symbol.padEnd(15)} ${status.padEnd(8)} 买入时: ${r.triggerPoint.earlyReturn.toFixed(1)}%(age:${r.triggerPoint.age.toFixed(2)}min) → 最终: ${r.finalReturn.toFixed(1)}%`);
        });

        // 显示最大的盈利和亏损
        console.log(`\n🏆 最大盈利: ${Math.max(...triggered.map(r => r.finalReturn)).toFixed(1)}%`);
        console.log(`📉 最大亏损: ${Math.min(...triggered.map(r => r.finalReturn)).toFixed(1)}%`);
    }

    // 显示错过的机会（未触发但涨幅很高的）
    const missedOpportunities = notTriggered.filter(r => r.overallMax >= 100);
    if (missedOpportunities.length > 0) {
        missedOpportunities.sort((a, b) => b.overallMax - a.overallMax);

        console.log(`\n❌ 错过的机会 (涨幅 >= 100% 但未触发):`);
        console.log('─'.repeat(90));

        missedOpportunities.slice(0, 20).forEach((r, i) => {
            const reason = r.windowMax < RETURN_MIN ? `窗口内最高${r.windowMax.toFixed(1)}% < ${RETURN_MIN}%`
                        : `窗口内最高${r.windowMax.toFixed(1)}% >= ${RETURN_MAX}%`;
            console.log(`[${i + 1}] ${r.symbol.padEnd(15)} 峰值: ${r.overallMax.toFixed(1).padStart(7)}% | 最终: ${r.finalReturn.toFixed(1).padStart(7)}% | 原因: ${reason}`);
        });

        if (missedOpportunities.length > 20) {
            console.log(`     ... 还有 ${missedOpportunities.length - 20} 个`);
        }
    }

    // 特别关注 TORCH
    const torch = results.find(r => r.address.includes('f12ae85a'));
    if (torch) {
        console.log(`\n🔥 TORCH (大牛币) 详细:`);
        console.log('─'.repeat(90));
        console.log(`是否触发: ${torch.triggered ? '✅ 是' : '❌ 否'}`);
        if (torch.triggered) {
            console.log(`触发点: age ${torch.triggerPoint.age.toFixed(2)}分钟, earlyReturn ${torch.triggerPoint.earlyReturn.toFixed(1)}%`);
            console.log(`最终收益: ${torch.finalReturn.toFixed(1)}%`);
        } else {
            console.log(`窗口内最高: ${torch.windowMax.toFixed(1)}%`);
            console.log(`整体最高: ${torch.overallMax.toFixed(1)}%`);
        }
    }

    console.log('\n✅ 分析完成');
}

analyzeWithLowerThreshold().catch(console.error);
