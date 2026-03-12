require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

(async () => {
    const { data: experiment } = await supabase
        .from('experiments')
        .select('id, name, mode, status')
        .eq('id', '8b6408cd-c555-4a98-b9a7-19a5f0925a00')
        .single();

    console.log('实验类型:', experiment.mode);
    console.log('实验状态:', experiment.status);
    console.log('实验名称:', experiment.name);
})();
