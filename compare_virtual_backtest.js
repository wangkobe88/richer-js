/**
 * 对比虚拟实验和它生成的回测实验
 * 回测实验应该继承虚拟实验的购买条件
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function compareVirtualBacktest() {
  // 老回测实验 ID
  const oldBacktestId = '933be40d-1056-463f-b629-aa226a2ea064';

  // 获取老回测实验配置
  const { data: oldBacktest, error: oldError } = await supabase
    .from('experiments')
    .select('id, config, source_experiment_id')
    .eq('id', oldBacktestId)
    .single();

  if (oldError || !oldBacktest) {
    console.log('❌ 无法获取老回测实验:', oldError?.message);
    return;
  }

  console.log('=== 老回测实验信息 ===');
  console.log('ID:', oldBacktest.id);
  console.log('源实验ID:', oldBacktest.source_experiment_id);
  console.log('');

  if (!oldBacktest.source_experiment_id) {
    console.log('❌ 老回测没有 source_experiment_id');
    return;
  }

  // 获取源虚拟实验配置
  const { data: virtualExp, error: virtualError } = await supabase
    .from('experiments')
    .select('id, name, config, mode')
    .eq('id', oldBacktest.source_experiment_id)
    .single();

  if (virtualError || !virtualExp) {
    console.log('❌ 无法获取源虚拟实验:', virtualError?.message);
    return;
  }

  console.log('=== 源虚拟实验信息 ===');
  console.log('ID:', virtualExp.id);
  console.log('名称:', virtualExp.name);
  console.log('模式:', virtualExp.mode);
  console.log('');

  // 对比第一阶段购买条件
  const virtualBuy = virtualExp.config?.strategiesConfig?.buyStrategies?.[0];
  const backtestBuy = oldBacktest.config?.strategiesConfig?.buyStrategies?.[0];

  console.log('=== 第一阶段购买条件对比 ===\n');

  console.log('虚拟实验 (condition):');
  console.log(virtualBuy?.condition || '(无)');
  console.log('');

  console.log('回测实验 (condition):');
  console.log(backtestBuy?.condition || '(无)');
  console.log('');

  const conditionSame = virtualBuy?.condition === backtestBuy?.condition;

  if (conditionSame) {
    console.log('✓ 第一阶段购买条件相同');
  } else {
    console.log('⚠️  第一阶段购买条件不同！');

    // 详细差异
    const vCond = virtualBuy?.condition || '';
    const bCond = backtestBuy?.condition || '';

    console.log('\n虚拟实验长度:', vCond.length);
    console.log('回测实验长度:', bCond.length);

    if (vCond.length !== bCond.length) {
      console.log('\n长度不同，可能内容不同');

      // 找第一个差异
      const maxLen = Math.max(vCond.length, bCond.length);
      for (let i = 0; i < maxLen; i++) {
        if (vCond[i] !== bCond[i]) {
          console.log('\n第一个差异位置:', i);
          console.log('虚拟实验:', vCond.substring(Math.max(0, i-30), i+30));
          console.log('回测实验:', bCond.substring(Math.max(0, i-30), i+30));
          break;
        }
      }
    }
  }

  console.log('\n=== 预检查条件对比（仅回测有）===');
  console.log('回测 preBuyCheckCondition:');
  console.log(backtestBuy?.preBuyCheckCondition || '(无)');
}

compareVirtualBacktest().catch(console.error);
