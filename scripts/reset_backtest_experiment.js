require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

(async () => {
  const experimentId = '9733f934-b263-40e0-a4d3-8639703b0da9';

  console.log('重置实验状态为 initializing...');

  const { error } = await supabase
    .from('experiments')
    .update({ status: 'initializing' })
    .eq('id', experimentId);

  if (error) {
    console.error('更新失败:', error.message);
  } else {
    console.log('实验状态已更新为 initializing');
  }

  // 检查当前状态
  const { data } = await supabase
    .from('experiments')
    .select('status')
    .eq('id', experimentId)
    .single();

  console.log('当前状态:', data?.status);
})();
