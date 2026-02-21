const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

(async () => {
  // 获取一个实验记录来查看字段
  const { data, error } = await supabase
    .from('experiments')
    .select('*')
    .limit(1);

  if (error) {
    console.log('Error:', error);
  } else if (data && data.length > 0) {
    console.log('实验表字段:', Object.keys(data[0]));
  }
})();
