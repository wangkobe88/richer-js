/**
 * 检查虚拟实验的配置
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function checkExperimentConfig() {
  const experimentId = 'c1a4e4b0-74e2-40b9-ad3f-a0574890dd1d';

  // 1. 获取实验配置
  const { data: experiment, error } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', experimentId)
    .single();

  if (error) {
    console.error('获取实验失败:', error);
    return;
  }

  console.log('=== 实验基本信息 ===');
  console.log(`ID: ${experiment.id}`);
  console.log(`名称: ${experiment.experiment_name}`);
  console.log(`模式: ${experiment.trading_mode}`);
  console.log(`状态: ${experiment.status}`);
  console.log('');

  // 2. 解析 config
  let config = experiment.config;
  if (typeof config === 'string') {
    try {
      config = JSON.parse(config);
    } catch (e) {
      console.error('解析config失败:', e);
      return;
    }
  }

  console.log('=== 配置结构 ===');
  console.log('config 的顶层键:', Object.keys(config || {}));
  console.log('');

  // 3. 检查 strategiesConfig
  const strategiesConfig = config?.strategiesConfig;
  console.log('=== strategiesConfig ===');
  if (strategiesConfig) {
    console.log('buyStrategies 数量:', strategiesConfig.buyStrategies?.length || 0);
    console.log('sellStrategies 数量:', strategiesConfig.sellStrategies?.length || 0);
    console.log('');

    if (strategiesConfig.buyStrategies && strategiesConfig.buyStrategies.length > 0) {
      console.log('买入策略:');
      strategiesConfig.buyStrategies.forEach((s, idx) => {
        console.log(`\n策略 ${idx + 1}:`);
        console.log(`  priority: ${s.priority}`);
        console.log(`  condition: ${s.condition ? s.condition.substring(0, 100) + '...' : '无'}`);
        console.log(`  preBuyCheckCondition: ${s.preBuyCheckCondition || '未设置'}`);
      });
    }
  } else {
    console.log('没有 strategiesConfig');
  }
  console.log('');

  // 4. 检查 preBuyCheck 配置
  const preBuyCheck = config?.preBuyCheck;
  console.log('=== preBuyCheck 配置 ===');
  if (preBuyCheck) {
    console.log(JSON.stringify(preBuyCheck, null, 2));
  } else {
    console.log('没有 preBuyCheck 配置');
  }
  console.log('');

  // 5. 检查信号数据
  console.log('=== 检查信号数据 ===');
  const { data: signals, error: signalError } = await supabase
    .from('strategy_signals')
    .select('action, metadata')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .limit(3);

  if (signalError) {
    console.error('获取信号失败:', signalError);
  } else {
    console.log(`找到 ${signals.length} 个买入信号`);
    if (signals.length > 0) {
      signals.forEach((sig, idx) => {
        console.log(`\n信号 ${idx + 1}:`);
        let metadata = sig.metadata;
        if (typeof metadata === 'string') {
          try {
            metadata = JSON.parse(metadata);
          } catch (e) {}
        }
        const preBuyFactors = metadata?.preBuyCheckFactors;
        if (preBuyFactors) {
          console.log(`  preBuyCheckFactors 存在`);
          console.log(`  canBuy: ${preBuyFactors.canBuy}`);
          console.log(`  checkReason: ${preBuyFactors.checkReason}`);
        } else {
          console.log(`  preBuyCheckFactors 不存在`);
        }
      });
    }
  }
}

checkExperimentConfig().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('检查失败:', error);
  process.exit(1);
});
