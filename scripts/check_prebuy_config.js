/**
 * 检查虚拟实验的 preBuyCheck 配置
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function checkPreBuyConfig() {
  const experimentId = 'c1a4e4b0-74e2-40b9-ad3f-a0574890dd1d';

  // 1. 获取实验配置
  const { data: experiment, error } = await supabase
    .from('experiments')
    .select('config')
    .eq('id', experimentId)
    .single();

  if (error) {
    console.error('获取实验失败:', error);
    return;
  }

  let config = experiment.config;
  if (typeof config === 'string') {
    try {
      config = JSON.parse(config);
    } catch (e) {
      console.error('解析config失败:', e);
      return;
    }
  }

  console.log('=== 实验 config.preBuyCheck ===');
  const preBuyCheck = config?.preBuyCheck;
  if (preBuyCheck) {
    console.log(JSON.stringify(preBuyCheck, null, 2));
  } else {
    console.log('没有 preBuyCheck 配置（将使用默认配置）');
  }
  console.log('');

  // 2. 检查默认配置
  const defaultConfig = require('/Users/nobody1/Desktop/Codes/richer-js/config/default.json');
  console.log('=== 默认 config.preBuyCheck ===');
  if (defaultConfig.preBuyCheck) {
    console.log(JSON.stringify(defaultConfig.preBuyCheck, null, 2));
  } else {
    console.log('默认配置中没有 preBuyCheck');
  }
  console.log('');

  // 3. 计算实际使用的配置
  const actualConfig = {
    ...defaultConfig.preBuyCheck,
    ...preBuyCheck
  };
  console.log('=== 实际使用的配置（合并后） ===');
  console.log(JSON.stringify(actualConfig, null, 2));
  console.log('');

  // 4. 关键配置项
  console.log('=== 关键配置项 ===');
  console.log(`earlyParticipantCheckEnabled: ${actualConfig.earlyParticipantCheckEnabled}`);
  console.log(`earlyParticipantFilterEnabled: ${actualConfig.earlyParticipantFilterEnabled}`);
  console.log(`holderCheckEnabled: ${actualConfig.holderCheckEnabled}`);
}

checkPreBuyConfig().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('检查失败:', error);
  process.exit(1);
});
