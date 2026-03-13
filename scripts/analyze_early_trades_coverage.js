const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// 手动指定要分析的回测实验ID
const BACKTEST_EXPERIMENTS = [
    '931f683f-c69b-499c-8368-2485244bc5eb',  // 最近的回测实验
    '8b6408cd-c555-4a98-b9a7-19a5f0925a00',
    '047f5277-9874-4636-9914-567a48a173a8',
    '2c4f7a12-59ef-41b6-a7d9-4c8e5f3a9b12',  // 假设的ID，需要替换为实际ID
];

async function analyzeExperiment(experimentId) {
    console.log(`\n========================================`);
    console.log(`实验 ID: ${experimentId.substring(0, 8)}...`);
    console.log(`========================================`);
    
    // 先获取实验信息
    const { data: exp, error: expError } = await supabase
        .from('experiments')
        .select('id, created_at, config')
        .eq('id', experimentId)
        .single();
    
    if (expError || !exp) {
        console.log(`实验不存在或获取失败`);
        return null;
    }
    
    console.log(`创建时间: ${exp.created_at}`);
    
    // 获取买入信号
    const { data: signals, error: signalError } = await supabase
        .from('strategy_signals')
        .select('*')
        .eq('experiment_id', experimentId)
        .eq('action', 'buy');
    
    if (signalError) {
        console.error('获取信号失败:', signalError);
        return null;
    }
    
    if (!signals || signals.length === 0) {
        console.log('无买入信号\n');
        return { experimentId, created: exp.created_at, signalCount: 0 };
    }
    
    const factors = signals.map(s => s.metadata?.preBuyCheckFactors || {});
    
    // 分析早期交易者数据获取情况
    const noEarlyTradesData = factors.filter(f => 
        !f.earlyTradesChecked || f.earlyTradesCountPerMin === 0
    );
    
    const hasSomeEarlyTradesData = factors.filter(f =>
        f.earlyTradesChecked && f.earlyTradesCountPerMin > 0
    );
    
    // 数据覆盖率
    const withCoverage = factors.filter(f => f.earlyTradesDataCoverage > 0);
    const avgCoverage = withCoverage.length > 0
        ? withCoverage.reduce((sum, f) => sum + (f.earlyTradesDataCoverage || 0), 0) / withCoverage.length
        : 0;
    
    // 强势交易者数据
    const noStrongTraderData = factors.filter(f => f.strongTraderWalletCount === 0);
    const hasStrongTraderData = factors.filter(f => f.strongTraderWalletCount > 0);
    
    console.log(`\n总信号数: ${signals.length}`);
    console.log(`\n--- 早期交易者数据 ---`);
    console.log(`无数据 (earlyTradesCountPerMin=0): ${noEarlyTradesData.length} (${(noEarlyTradesData.length/signals.length*100).toFixed(1)}%)`);
    console.log(`有数据 (earlyTradesCountPerMin>0): ${hasSomeEarlyTradesData.length} (${(hasSomeEarlyTradesData.length/signals.length*100).toFixed(1)}%)`);
    
    if (withCoverage.length > 0) {
        const minCoverage = Math.min(...withCoverage.map(f => f.earlyTradesDataCoverage));
        const maxCoverage = Math.max(...withCoverage.map(f => f.earlyTradesDataCoverage));
        console.log(`数据覆盖率: 平均 ${avgCoverage.toFixed(1)}%, 范围 ${minCoverage.toFixed(1)}% ~ ${maxCoverage.toFixed(1)}%`);
    }
    
    console.log(`\n--- 强势交易者数据 ---`);
    console.log(`无数据 (walletCount=0): ${noStrongTraderData.length} (${(noStrongTraderData.length/signals.length*100).toFixed(1)}%)`);
    console.log(`有数据 (walletCount>0): ${hasStrongTraderData.length} (${(hasStrongTraderData.length/signals.length*100).toFixed(1)}%)`);
    
    return {
        experimentId,
        created: exp.created_at,
        signalCount: signals.length,
        noEarlyTradesData: noEarlyTradesData.length,
        hasEarlyTradesData: hasSomeEarlyTradesData.length,
        noEarlyTradesPct: (noEarlyTradesData.length/signals.length*100).toFixed(1),
        noStrongTraderData: noStrongTraderData.length,
        hasStrongTraderData: hasStrongTraderData.length,
        noStrongTraderPct: (noStrongTraderData.length/signals.length*100).toFixed(1),
        avgCoverage: avgCoverage.toFixed(1)
    };
}

async function main() {
    const results = [];
    
    for (const expId of BACKTEST_EXPERIMENTS) {
        const result = await analyzeExperiment(expId);
        if (result) {
            results.push(result);
        }
    }
    
    // 汇总统计
    console.log('\n\n========================================');
    console.log('汇总统计');
    console.log('========================================');
    
    if (results.length > 0) {
        const totalSignals = results.reduce((sum, r) => sum + r.signalCount, 0);
        const totalNoEarlyTrades = results.reduce((sum, r) => sum + r.noEarlyTradesData, 0);
        const totalNoStrongTrader = results.reduce((sum, r) => sum + r.noStrongTraderData, 0);
        
        console.log(`\n总实验数: ${results.length}`);
        console.log(`总信号数: ${totalSignals}`);
        console.log(`\n早期交易者数据缺失率: ${(totalNoEarlyTrades/totalSignals*100).toFixed(1)}%`);
        console.log(`强势交易者数据缺失率: ${(totalNoStrongTrader/totalSignals*100).toFixed(1)}%`);
        
        console.log('\n各实验详情:');
        results.forEach(r => {
            console.log(`  ${r.experimentId.substring(0, 8)}... | 信号:${r.signalCount} | 无早期数据:${r.noEarlyTradesPct}% | 无强势交易者:${r.noStrongTraderPct}%`);
        });
    }
}

main().catch(console.error);
