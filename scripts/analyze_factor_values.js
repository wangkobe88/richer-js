const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function analyzeFactorValues() {
    // 回测实验的信号
    const { data: backtestSignals } = await supabase
        .from('strategy_signals')
        .select('*')
        .eq('experiment_id', '931f683f-c69b-499c-8368-2485244bc5eb')
        .eq('action', 'buy')
        .order('created_at', { ascending: false })
        .limit(20);
    
    console.log('=== 回测实验 - 强势交易者因子分析 ===\n');
    
    backtestSignals.forEach((s, i) => {
        const f = s.metadata?.preBuyCheckFactors || {};
        const trendF = s.metadata?.trendFactors || {};
        
        console.log(`${i + 1}. ${s.token_address?.substring(0, 10)}... | earlyReturn: ${trendF.earlyReturn?.toFixed(2)}%`);
        console.log(`   strongTraderNetPositionRatio: ${f.strongTraderNetPositionRatio ?? 'N/A'}`);
        console.log(`   strongTraderWalletCount: ${f.strongTraderWalletCount ?? 'N/A'}`);
        console.log(`   earlyTradesCountPerMin: ${f.earlyTradesCountPerMin ?? 'N/A'}`);
        console.log(`   holderBlacklistCount: ${f.holderBlacklistCount ?? 'N/A'}`);
        console.log(`   holderWhitelistCount: ${f.holderWhitelistCount ?? 'N/A'}`);
        console.log(`   devHoldingRatio: ${f.devHoldingRatio ?? 'N/A'}`);
        console.log(`   maxHoldingRatio: ${f.maxHoldingRatio ?? 'N/A'}`);
        console.log('');
    });
    
    // 统计强势交易者因子的分布
    const validSignals = backtestSignals.filter(s => s.metadata?.preBuyCheckFactors);
    const netPositionRatios = validSignals.map(s => s.metadata.preBuyCheckFactors.strongTraderNetPositionRatio).filter(v => v != null);
    const walletCounts = validSignals.map(s => s.metadata.preBuyCheckFactors.strongTraderWalletCount).filter(v => v != null);
    
    console.log('=== 强势交易者因子分布 ===');
    console.log(`strongTraderNetPositionRatio 范围: ${Math.min(...netPositionRatios).toFixed(2)} ~ ${Math.max(...netPositionRatios).toFixed(2)}`);
    console.log(`strongTraderWalletCount 范围: ${Math.min(...walletCounts)} ~ ${Math.max(...walletCounts)}`);
    
    // 检查条件: strongTraderNetPositionRatio < 5
    const failNetRatio = validSignals.filter(s => {
        const v = s.metadata.preBuyCheckFactors.strongTraderNetPositionRatio;
        return v != null && v >= 5;
    });
    
    // 检查条件: strongTraderWalletCount > 0
    const failWalletCount = validSignals.filter(s => {
        const v = s.metadata.preBuyCheckFactors.strongTraderWalletCount;
        return v != null && v <= 0;
    });
    
    console.log(`\n因为 strongTraderNetPositionRatio >= 5 失败: ${failNetRatio.length} 个信号`);
    console.log(`因为 strongTraderWalletCount <= 0 失败: ${failWalletCount.length} 个信号`);
    
    // 虚拟实验的信号对比
    const { data: virtualSignals } = await supabase
        .from('strategy_signals')
        .select('*')
        .eq('experiment_id', '015db965-0b33-4d98-88b1-386203886381')
        .eq('action', 'buy')
        .order('created_at', { ascending: false })
        .limit(20);
    
    console.log('\n=== 虚拟实验 - 执行情况 ===');
    const executedVirtual = virtualSignals.filter(s => s.metadata?.executed);
    console.log(`总信号数: ${virtualSignals?.length || 0}`);
    console.log(`已执行: ${executedVirtual.length}`);
    
    if (executedVirtual.length > 0) {
        console.log('\n虚拟实验执行成功的代币 (前5个):');
        executedVirtual.slice(0, 5).forEach((s, i) => {
            const f = s.metadata?.preBuyCheckFactors || {};
            const trendF = s.metadata?.trendFactors || {};
            console.log(`${i + 1}. ${s.token_address?.substring(0, 10)}... | earlyReturn: ${trendF.earlyReturn?.toFixed(2)}% | executed_at: ${s.metadata?.executed_at}`);
        });
    }
}

analyzeFactorValues().catch(console.error);
