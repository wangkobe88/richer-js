import { readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';

// 读取环境变量
const envContent = readFileSync(join(process.cwd(), 'config', '.env'), 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length > 0) {
    env[key.trim()] = valueParts.join('=').trim();
  }
});

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

// 源实验ID
const sourceExperimentId = '4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1';

async function review() {
  console.log('=== 从源实验获取数据 ===');
  console.log('源实验ID:', sourceExperimentId);

  // 获取源实验的代币
  const { data: tokens, error: tokensError } = await supabase
    .from('experiment_tokens')
    .select('token_address, token_symbol, analysis_results, human_judges')
    .eq('experiment_id', sourceExperimentId)
    .limit(500);

  if (tokensError) {
    console.error('获取代币失败:', tokensError);
    return;
  }

  console.log('代币数量:', tokens.length);

  // 检查字段
  if (tokens.length > 0) {
    console.log('第一个代币字段:', Object.keys(tokens[0]).join(', '));
    console.log('第一个代币的analysis_results:', JSON.stringify(tokens[0].analysis_results || 'null').substring(0, 200));
  }

  // 过滤有涨幅数据的代币
  const tokensWithReturn = tokens.filter(t =>
    t.analysis_results && t.analysis_results.max_change_percent !== null
  );

  console.log('有涨幅数据的代币:', tokensWithReturn.length);

  if (tokensWithReturn.length === 0) {
    console.log('没有涨幅数据，退出');
    return;
  }

  // 获取叙事数据
  const addresses = tokens.map(t => t.token_address.toLowerCase());
  const { data: narratives, error: narrativesError } = await supabase
    .from('token_narrative')
    .select('*')
    .in('token_address', addresses);

  if (narrativesError) {
    console.error('获取叙事失败:', narrativesError);
    return;
  }

  console.log('叙事数据数量:', narratives.length);

  // 创建叙事映射
  const narrativeMap = {};
  narratives.forEach(n => {
    narrativeMap[n.token_address] = n;
  });

  // 关联数据
  const combined = tokensWithReturn.map(token => {
    const narrative = narrativeMap[token.token_address.toLowerCase()];
    return {
      symbol: token.token_symbol,
      address: token.token_address,
      maxChange: token.analysis_results?.max_change_percent || 0,
      finalReturn: token.analysis_results?.final_return_percent || 0,
      llmCategory: narrative?.llm_category || 'N/A',
      llmScore: narrative?.llm_summary?.total_score || 0,
      llmReasoning: narrative?.llm_summary?.reasoning || '',
      humanJudge: token.human_judges || null
    };
  });

  // 按最大涨幅排序
  combined.sort((a, b) => b.maxChange - a.maxChange);

  console.log('');
  console.log('=== 前30名代币（按最大涨幅排序）===');
  console.log('排名  代币       最大涨幅   LLM评级  LLM分数');
  console.log('----------------------------------------------');

  combined.slice(0, 30).forEach((item, i) => {
    console.log(`${(i+1).toString().padStart(2)}   ${item.symbol.padEnd(10)}   ${item.maxChange.toFixed(6).padStart(7)}%   ${item.llmCategory.padStart(6)}   ${item.llmScore.toString().padStart(3)}`);
  });

  // 找出问题案例
  const highReturnLow = combined.filter(item => item.maxChange > 50 && item.llmCategory === 'low');
  const highReturnMid = combined.filter(item => item.maxChange > 50 && item.llmCategory === 'mid');
  const highReturnNoNarrative = combined.filter(item => item.maxChange > 50 && item.llmCategory === 'N/A');

  console.log('');
  console.log('=== 高涨幅(>50%)但被评為 low 的代币 ===');
  if (highReturnLow.length === 0) {
    console.log('无');
  } else {
    highReturnLow.forEach((item, i) => {
      console.log(`${i+1}. ${item.symbol} (${item.address.slice(0,10)}...)`);
      console.log(`   最大涨幅: ${item.maxChange.toFixed(2)}%`);
      console.log(`   LLM推理: ${item.llmReasoning.substring(0, 150)}...`);
      console.log('');
    });
  }

  console.log('=== 高涨幅(>50%)但无叙事分析 ===');
  if (highReturnNoNarrative.length === 0) {
    console.log('无');
  } else {
    highReturnNoNarrative.forEach((item, i) => {
      console.log(`${i+1}. ${item.symbol} (${item.address.slice(0,10)}...) - ${item.maxChange.toFixed(2)}%`);
    });
  }

  // 统计
  console.log('=== 统计分析 ===');
  const highReturn = combined.filter(item => item.maxChange > 50);
  console.log(`高涨幅代币(>50%): ${highReturn.length}`);

  for (const cat of ['low', 'mid', 'high', 'N/A']) {
    const count = highReturn.filter(item => item.llmCategory === cat).length;
    const pct = highReturn.length > 0 ? (count / highReturn.length * 100).toFixed(1) : 0;
    console.log(`  LLM评级 ${cat}: ${count} (${pct}%)`);
  }
}

review().catch(err => console.error('Error:', err));
