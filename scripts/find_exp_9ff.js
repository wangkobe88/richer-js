const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  const expId = '9ff66c4e-3d95-4486-85fb-2c4a587ebcbc';

  // 查找实验
  const { data: exp } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', expId)
    .single();

  if (exp) {
    console.log('实验存在:', exp);
  } else {
    console.log('实验不存在');

    // 查找最近的实验
    const { data: recentExps } = await supabase
      .from('experiments')
      .select('id, experiment_name, trading_mode, status, created_at')
      .order('created_at', { ascending: false })
      .limit(5);

    console.log('\n最近的实验:');
    for (const e of recentExps || []) {
      console.log(`${e.id.substring(0, 8)}... | ${e.experiment_name} | ${e.trading_mode} | ${e.status} | ${e.created_at}`);
    }
  }
})();
