const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// 已知的回测实验ID
const KNOWN_BACKTESTS = [
    '931f683f-c69b-499c-8368-2485244bc5eb',
    '8b6408cd-c555-4a98-b9a7-19a5f0925a00',
];

// 分析早期交易数据覆盖的详细统计
async function analyzeEarlyTradesDetails(experimentId) {
    const { data: signals } = await supabase
        .from('strategy_signals')
        .select('*')
        .eq('experiment_id', experimentId)
        .eq('action', 'buy');
    
    if (!signals || signals.length === 0) {
        return null;
    }
    
    const factors = signals.map(s => s.metadata?.preBuyCheckFactors || {});
    
    // 详细分类
    const categories = {
        noEarlyTrades: factors.filter(f => !f.earlyTradesChecked || f.earlyTradesCountPerMin === 0),
        lowCoverage: factors.filter(f => f.earlyTradesDataCoverage > 0 && f.earlyTradesDataCoverage < 50),
        goodCoverage: factors.filter(f => f.earlyTradesDataCoverage >= 50),
        fullCoverage: factors.filter(f => f.earlyTradesDataCoverage >= 90),
        noStrongTrader: factors.filter(f => f.strongTraderWalletCount === 0),
        hasStrongTrader: factors.filter(f => f.strongTraderWalletCount > 0),
    };
    
    return {
        total: signals.length,
        categories: {
            noEarlyTrades: categories.noEarlyTrades.length,
            lowCoverage: categories.lowCoverage.length,
            goodCoverage: categories.goodCoverage.length,
            fullCoverage: categories.fullCoverage.length,
            noStrongTrader: categories.noStrongTrader.length,
            hasStrongTrader: categories.hasStrongTrader.length,
        }
    };
}

async function main() {
    console.log('=== 早期交易者数据获取情况分析 ===\n');
    
    const results = [];
    
    for (const expId of KNOWN_BACKTESTS) {
        console.log(`分析实验: ${expId.substring(0, 8)}...`);
        
        const { data: exp } = await supabase
            .from('experiments')
            .select('created_at')
            .eq('id', expId)
            .single();
        
        if (!exp) {
            console.log('  实验不存在，跳过\n');
            continue;
        }
        
        const analysis = await analyzeEarlyTradesDetails(expId);
        
        if (analysis) {
            results.push({ id: expId, created: exp.created_at, ...analysis });
            
            console.log(`  总信号: ${analysis.total}`);
            console.log(`  无早期数据: ${analysis.categories.noEarlyTrades} (${(analysis.categories.noEarlyTrades/analysis.total*100).toFixed(1)}%)`);
            console.log(`  低覆盖率(<50%): ${analysis.categories.lowCoverage} (${(analysis.categories.lowCoverage/analysis.total*100).toFixed(1)}%)`);
            console.log(`  良好覆盖率(>=50%): ${analysis.categories.goodCoverage} (${(analysis.categories.goodCoverage/analysis.total*100).toFixed(1)}%)`);
            console.log(`  无强势交易者: ${analysis.categories.noStrongTrader} (${(analysis.categories.noStrongTrader/analysis.total*100).toFixed(1)}%)`);
            console.log('');
        }
    }
    
    // 汇总统计
    if (results.length > 0) {
        console.log('\n=== 汇总统计 ===\n');
        
        const totalSignals = results.reduce((sum, r) => sum + r.total, 0);
        const totalNoEarly = results.reduce((sum, r) => sum + r.categories.noEarlyTrades, 0);
        const totalLowCoverage = results.reduce((sum, r) => sum + r.categories.lowCoverage, 0);
        const totalGoodCoverage = results.reduce((sum, r) => sum + r.categories.goodCoverage, 0);
        const totalNoStrongTrader = results.reduce((sum, r) => sum + r.categories.noStrongTrader, 0);
        
        console.log(`总实验数: ${results.length}`);
        console.log(`总信号数: ${totalSignals}`);
        console.log(`\n早期交易者数据:`);
        console.log(`  完全缺失: ${totalNoEarly} (${(totalNoEarly/totalSignals*100).toFixed(1)}%)`);
        console.log(`  低覆盖率(<50%): ${totalLowCoverage} (${(totalLowCoverage/totalSignals*100).toFixed(1)}%)`);
        console.log(`  良好覆盖率(>=50%): ${totalGoodCoverage} (${(totalGoodCoverage/totalSignals*100).toFixed(1)}%)`);
        console.log(`  强势交易者缺失: ${totalNoStrongTrader} (${(totalNoStrongTrader/totalSignals*100).toFixed(1)}%)`);
        
        console.log('\n结论:');
        console.log(`1. 约 ${(totalNoEarly/totalSignals*100).toFixed(1)}% 的信号没有早期交易者数据`);
        console.log(`2. 约 ${((totalNoEarly + totalLowCoverage)/totalSignals*100).toFixed(1)}% 的信号早期交易数据不足或缺失`);
        console.log(`3. 约 ${(totalNoStrongTrader/totalSignals*100).toFixed(1)}% 的信号没有强势交易者数据`);
    }
}

main().catch(console.error);
