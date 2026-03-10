const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function compareExperiments() {
  const oldExpId = '233e4d94-e771-463a-9296-a93483a9ce96'; // 修复前
  const newExpId = 'bd7e63a2-8f56-4dfd-baef-a1c70d435384'; // 修复后

  console.log('=== 对比修复前后的实验 ===\n');

  // 获取两个实验的配置
  const { data: oldExp } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', oldExpId)
    .maybeSingle();

  const { data: newExp } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', newExpId)
    .maybeSingle();

  console.log('=== 实验配置 ===\n');
  console.log('旧实验 (修复前):');
  console.log('  ID:', oldExpId);
  console.log('  Name:', oldExp?.name);
  console.log('  Created:', oldExp?.created_at);
  console.log('');
  console.log('新实验 (修复后):');
  console.log('  ID:', newExpId);
  console.log('  Name:', newExp?.name);
  console.log('  Created:', newExp?.created_at);
  console.log('');

  // 检查预检查条件是否相同
  const oldCondition = oldExp?.config?.preBuyCheckConfig?.defaultCondition;
  const newCondition = newExp?.config?.preBuyCheckConfig?.defaultCondition;
  
  console.log('=== 预检查条件对比 ===\n');
  console.log('旧实验:', oldCondition || '无');
  console.log('新实验:', newCondition || '无');
  console.log('条件相同:', oldCondition === newCondition ? '✅ 是' : '❌ 否');
  console.log('');
}

compareExperiments().catch(console.error);
