// 尝试直接插入一条测试数据，看看是否有外键约束
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  const testExpId = '9ff66c4e-3d95-4486-85fb-2c4a587ebcbc';
  const validExpId = '0c616581-aa7f-4fcf-beed-6c84488925fb'; // 虚拟交易实验，存在

  // 测试1: 使用不存在的实验ID插入信号
  console.log('=== 测试1: 使用不存在的实验ID ===');
  const { data: sig1, error: err1 } = await supabase
    .from('strategy_signals')
    .insert([{
      id: 'test-signal-1',
      experiment_id: testExpId,
      token_symbol: 'TEST',
      token_address: '0x0000000000000000000000000000000000000001',
      action: 'buy',
      confidence: 80,
      reason: 'test',
      status: 'pending',
      executed: false
    }])
    .select();

  console.log('结果:', err1 ? err1.message : '成功');

  // 测试2: 使用存在的实验ID插入信号
  console.log('\n=== 测试2: 使用存在的实验ID ===');
  const { data: sig2, error: err2 } = await supabase
    .from('strategy_signals')
    .insert([{
      id: 'test-signal-2',
      experiment_id: validExpId,
      token_symbol: 'TEST',
      token_address: '0x0000000000000000000000000000000000000002',
      action: 'buy',
      confidence: 80,
      reason: 'test',
      status: 'pending',
      executed: false
    }])
    .select();

  console.log('结果:', err2 ? err2.message : '成功');
  
  // 清理测试数据
  if (sig2 && sig2.length > 0) {
    await supabase.from('strategy_signals').delete().eq('id', 'test-signal-2');
  }
})();
