const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  const experimentId = '0971b4f0-ea88-4e72-a80f-6fe9b98f2bdd';

  const { data, error } = await supabase
    .from('experiments')
    .update({
      status: 'completed',
      stopped_at: new Date().toISOString()
    })
    .eq('id', experimentId)
    .select();

  if (error) {
    console.log('更新失败:', error.message);
  } else {
    console.log('✅ 实验状态已更新为 completed');
  }
})();
