/**
 * 详细对比 preBuyCheckCondition 的差异
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function detailedPrebuyDiff() {
  const oldExpId = '933be40d-1056-463f-b629-aa226a2ea064';
  const newExpId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  // 获取两个实验的配置
  const { data: experiments } = await supabase
    .from('experiments')
    .select('id, config')
    .in('id', [oldExpId, newExpId]);

  const oldExp = experiments.find(e => e.id === oldExpId);
  const newExp = experiments.find(e => e.id === newExpId);

  const oldCondition = oldExp.config?.strategiesConfig?.buyStrategies?.[0]?.preBuyCheckCondition;
  const newCondition = newExp.config?.strategiesConfig?.buyStrategies?.[0]?.preBuyCheckCondition;

  console.log('=== preBuyCheckCondition 详细对比 ===\n');

  console.log('老回测长度:', oldCondition?.length || 0);
  console.log('新回测长度:', newCondition?.length || 0);
  console.log('');

  if (!oldCondition || !newCondition) {
    console.log('❌ 某个实验没有 preBuyCheckCondition');
    return;
  }

  console.log('老回测完整条件:');
  console.log(oldCondition);
  console.log('\n' + '='.repeat(80) + '\n');

  console.log('新回测完整条件:');
  console.log(newCondition);
  console.log('\n' + '='.repeat(80) + '\n');

  // 找出差异
  if (oldCondition === newCondition) {
    console.log('✓ 两个条件完全相同');
  } else {
    console.log('⚠️  两个条件不同\n');

    // 简单的字符级对比
    const maxLen = Math.max(oldCondition.length, newCondition.length);
    let firstDiff = -1;

    for (let i = 0; i < maxLen; i++) {
      if (oldCondition[i] !== newCondition[i]) {
        firstDiff = i;
        break;
      }
    }

    if (firstDiff >= 0) {
      console.log('第一个差异位置:', firstDiff);
      console.log('\n老回测 (差异位置前后):');
      const start = Math.max(0, firstDiff - 50);
      const end = Math.min(oldCondition.length, firstDiff + 50);
      console.log('  ...' + oldCondition.substring(start, end) + '...');

      console.log('\n新回测 (差异位置前后):');
      const end2 = Math.min(newCondition.length, firstDiff + 50);
      console.log('  ...' + newCondition.substring(start, end2) + '...');
    }

    // 检查是否只是空格/格式差异
    const oldTrimmed = oldCondition.replace(/\s+/g, ' ').trim();
    const newTrimmed = newCondition.replace(/\s+/g, ' ').trim();

    if (oldTrimmed === newTrimmed) {
      console.log('\n✓ 去除空格后相同，只是格式差异');
    }
  }
}

detailedPrebuyDiff().catch(console.error);
