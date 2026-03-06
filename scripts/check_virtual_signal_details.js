/**
 * 检查虚拟实验信号的完整 preBuyCheckFactors
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

async function checkSignalDetails() {
  const experimentId = 'c1a4e4b0-74e2-40b9-ad3f-a0574890dd1d';

  const { data: signals, error } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('action', 'buy')
    .limit(2);

  if (error) {
    console.error('获取信号失败:', error);
    return;
  }

  console.log(`找到 ${signals.length} 个买入信号\n`);

  signals.forEach((sig, idx) => {
    console.log(`=== 信号 ${idx + 1} ===`);
    console.log(`ID: ${sig.id}`);
    console.log(`代币: ${sig.token_address}`);
    console.log(`创建时间: ${sig.created_at}`);
    console.log('');

    let metadata = sig.metadata;
    if (typeof metadata === 'string') {
      try {
        metadata = JSON.parse(metadata);
      } catch (e) {
        console.log('metadata 解析失败');
        return;
      }
    }

    console.log('metadata 结构:', Object.keys(metadata || {}));
    console.log('');

    const preBuyFactors = metadata?.preBuyCheckFactors;
    if (preBuyFactors) {
      console.log('preBuyCheckFactors 完整内容:');
      console.log(JSON.stringify(preBuyFactors, null, 2));
    } else {
      console.log('preBuyCheckFactors 不存在');
    }
    console.log('');
    console.log('-'.repeat(80));
    console.log('');
  });
}

checkSignalDetails().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('检查失败:', error);
  process.exit(1);
});
