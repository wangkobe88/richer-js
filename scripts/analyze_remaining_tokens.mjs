import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '../config/.env') });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const experimentId = '72667aab-043b-4b5c-9a2d-027fd1101af0';

console.log(`📊 分析实验 ${experimentId} 剩余代币的涨幅分布...\n`);

// 获取所有代币及其分析结果
const { data: tokens, error } = await supabase
  .from('experiment_tokens')
  .select('token_address, token_symbol, analysis_results')
  .eq('experiment_id', experimentId);

if (error) {
  console.error('❌ 获取代币失败:', error);
  process.exit(1);
}

// 分析涨幅分布
const distribution = {
  '100-120%': 0,
  '120-150%': 0,
  '150-200%': 0,
  '200-300%': 0,
  '300-500%': 0,
  '500-1000%': 0,
  '1000%+': 0,
  '无数据': 0
};

const topTokens = [];

tokens.forEach(token => {
  const maxChange = token.analysis_results?.max_change_percent;
  if (maxChange === undefined || maxChange === null) {
    distribution['无数据']++;
  } else if (maxChange < 120) {
    distribution['100-120%']++;
  } else if (maxChange < 150) {
    distribution['120-150%']++;
  } else if (maxChange < 200) {
    distribution['150-200%']++;
  } else if (maxChange < 300) {
    distribution['200-300%']++;
  } else if (maxChange < 500) {
    distribution['300-500%']++;
  } else if (maxChange < 1000) {
    distribution['500-1000%']++;
  } else {
    distribution['1000%+']++;
    topTokens.push({
      symbol: token.token_symbol,
      address: token.token_address,
      maxChange: maxChange
    });
  }
});

console.log('📈 涨幅分布:');
Object.entries(distribution).forEach(([range, count]) => {
  const pct = (count / tokens.length * 100).toFixed(1);
  console.log(`   ${range.padEnd(12)} ${count.toString().padStart(4)} 个 (${pct}%)`);
});

console.log('\n🏆 涨幅超过1000%的代币:');
topTokens.sort((a, b) => b.maxChange - a.maxChange);
topTokens.slice(0, 10).forEach((t, i) => {
  console.log(`   ${i + 1}. ${t.symbol} (${t.address.slice(0, 8)}...): ${t.maxChange.toFixed(1)}%`);
});

// 计算平均涨幅
const validTokens = tokens.filter(t => t.analysis_results?.max_change_percent !== undefined);
const avgMaxChange = validTokens.reduce((sum, t) => sum + (t.analysis_results?.max_change_percent || 0), 0) / validTokens.length;
const medianMaxChange = [...validTokens].sort((a, b) => 
  (a.analysis_results?.max_change_percent || 0) - (b.analysis_results?.max_change_percent || 0)
)[Math.floor(validTokens.length / 2)]?.analysis_results?.max_change_percent || 0;

console.log(`\n📊 统计:`);
console.log(`   总代币数: ${tokens.length}`);
console.log(`   有涨幅数据: ${validTokens.length}`);
console.log(`   平均涨幅: ${avgMaxChange.toFixed(1)}%`);
console.log(`   中位数涨幅: ${medianMaxChange.toFixed(1)}%`);
