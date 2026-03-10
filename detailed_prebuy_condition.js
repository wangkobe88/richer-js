/**
 * 详细对比 preBuyCheckCondition
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function detailedPreBuyCondition() {
  const oldExpId = '933be40d-1056-463f-b629-aa226a2ea064';
  const newExpId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  const { data: experiments } = await supabase
    .from('experiments')
    .select('config')
    .in('id', [oldExpId, newExpId]);

  const oldExp = experiments.find(e => e.id === oldExpId);
  const newExp = experiments.find(e => e.id === newExpId);

  const oldCondition = oldExp.config?.strategiesConfig?.buyStrategies?.[0]?.preBuyCheckCondition;
  const newCondition = newExp.config?.strategiesConfig?.buyStrategies?.[0]?.preBuyCheckCondition;

  console.log('=== preBuyCheckCondition 对比 ===\n');

  console.log('老回测的 preBuyCheckCondition:');
  console.log(oldCondition || '无');
  console.log('');

  console.log('新回测的 preBuyCheckCondition:');
  console.log(newCondition || '无');
  console.log('');

  if (oldCondition && newCondition && oldCondition !== newCondition) {
    console.log('=== 差异分析 ===\n');

    // 拆分成多个条件来对比
    const oldConditions = oldCondition.split(' AND ').map(s => s.trim());
    const newConditions = newCondition.split(' AND ').map(s => s.trim());

    console.log('老回测条件数量:', oldConditions.length);
    console.log('新回测条件数量:', newConditions.length);

    // 找出不同的条件
    console.log('\n不同的条件:');
    const allConditions = new Set([...oldConditions, ...newConditions]);
    
    allConditions.forEach(cond => {
      const inOld = oldConditions.includes(cond);
      const inNew = newConditions.includes(cond);
      
      if (inOld !== inNew) {
        console.log(`  老回测${inOld ? '有' : '无'}: ${cond}`);
        console.log(`  新回测${inNew ? '有' : '无'}: ${cond}`);
      }
    });

    // 检查新增条件
    const newOnly = newConditions.filter(c => !oldConditions.includes(c));
    const oldOnly = oldConditions.filter(c => !newConditions.includes(c));

    if (newOnly.length > 0) {
      console.log('\n新回测新增的条件:');
      newOnly.forEach(c => console.log('  ' + c));
    }

    if (oldOnly.length > 0) {
      console.log('\n老回测有但新回测没有的条件:');
      oldOnly.forEach(c => console.log('  ' + c));
    }
  }
}

detailedPreBuyCondition().catch(console.error);
