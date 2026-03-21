import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量
const envPath = join(__dirname, 'config', '.env');
const envConfig = readFileSync(envPath, 'utf-8')
  .split('\n')
  .filter(line => line.trim() && !line.startsWith('#'))
  .reduce((acc, line) => {
    const [key, ...values] = line.split('=');
    if (key && values.length > 0) {
      acc[key] = values.join('=');
    }
    return acc;
  }, {});

for (const key in envConfig) {
  process.env[key] = envConfig[key];
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function check() {
  const experimentId = '7667f349-51cd-4945-ab56-72bf3f885b7b';
  
  // 获取实验配置
  const { data: exp, error } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', experimentId)
    .single();
  
  if (error) {
    console.error('获取实验失败:', error);
    return;
  }
  
  console.log('=== 实验配置 ===');
  console.log('实验名称:', exp.experiment_name);
  console.log('交易模式:', exp.trading_mode);
  console.log('区块链:', exp.blockchain);
  
  // config 可能已经是对象或字符串
  let config = exp.config;
  if (typeof config === 'string') {
    try {
      config = JSON.parse(config);
    } catch (e) {
      console.log('config 是字符串但解析失败，可能是对象');
    }
  }
  
  console.log('\n=== config 类型:', typeof config);
  
  if (config && config.strategy) {
    if (config.strategy.narrativeAnalysis) {
      console.log('✅ 叙事分析配置:', config.strategy.narrativeAnalysis);
      console.log('   enabled:', config.strategy.narrativeAnalysis.enabled);
    } else {
      console.log('❌ 没有找到 narrativeAnalysis 配置');
      console.log('   config.strategy 包含的字段:', Object.keys(config.strategy).join(', '));
    }
    
    if (config.strategy.buyStrategies) {
      console.log('\n买入策略数量:', config.strategy.buyStrategies.length);
      config.strategy.buyStrategies.forEach((s, i) => {
        console.log(`  策略 ${i + 1}: ${s.name}`);
        console.log(`    preBuyCheckCondition: ${s.preBuyCheckCondition || '(无)'}`);
      });
    }
  } else {
    console.log('❌ 没有找到 strategy 配置');
    console.log('   config 包含的字段:', config ? Object.keys(config).join(', ') : '(config为空)');
  }
  
  // 检查信号中的 narrativeRating
  console.log('\n=== 检查信号中的 narrativeRating ===');
  const { data: signals, error: signalError } = await supabase
    .from('strategy_signals')
    .select('id, token_symbol, created_at, metadata')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: false })
    .limit(5);
  
  if (signalError) {
    console.error('获取信号失败:', signalError);
    return;
  }
  
  console.log('信号数量:', signals?.length || 0);
  
  if (signals && signals.length > 0) {
    signals.forEach((sig, i) => {
      const metadata = sig.metadata || {};
      const preBuyFactors = metadata.preBuyCheckFactors || {};
      const narrativeRating = preBuyFactors.narrativeRating;
      
      console.log(`\n信号 ${i + 1}: ${sig.token_symbol}`);
      console.log(`  创建时间: ${new Date(sig.created_at).toLocaleString('zh-CN')}`);
      console.log(`  narrativeRating: ${narrativeRating !== undefined ? narrativeRating : '(未设置)'}`);
      
      if (metadata.preBuyCheckFactors) {
        console.log(`  preBuyCheckFactors 包含字段: ${Object.keys(metadata.preBuyCheckFactors).join(', ')}`);
      }
    });
  }
}

check().catch(console.error);
