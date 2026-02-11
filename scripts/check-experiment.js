/**
 * 检查实验配置结构
 */
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://jbhgrhwcznukmsprimlx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpiaGdyaHdjem51a21zcHJpbWx4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEwNTU5ODEsImV4cCI6MjA1NjYzMTk4MX0.A_P9jMctmr-apy32S_fljjtCmWBrQfIr6iSppVCEMm8';
const EXPERIMENT_ID = '7c5c6fa5-6dcf-43fe-b7f1-0d9c79f2c248';

async function main() {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    const { data, error } = await supabase
        .from('experiments')
        .select('*')
        .eq('id', EXPERIMENT_ID)
        .single();

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log('Experiment data:');
    console.log('ID:', data.id);
    console.log('Name:', data.name);
    console.log('Status:', data.status);
    console.log('');

    console.log('Config type:', typeof data.config);
    console.log('Config keys:', data.config ? Object.keys(data.config) : 'null');

    if (data.config) {
        console.log('');
        console.log('Full config:');
        console.log(JSON.stringify(data.config, null, 2));
    }

    // 检查 wallet 表
    console.log('');
    console.log('Checking wallets table...');
    const { data: wallets, error: walletError } = await supabase
        .from('wallets')
        .select('*')
        .eq('experiment_id', EXPERIMENT_ID);

    if (walletError) {
        console.log('Wallet error:', walletError.message);
    } else {
        console.log('Wallets:', wallets ? wallets.length : 0);
        if (wallets && wallets.length > 0) {
            console.log('First wallet:');
            console.log(JSON.stringify(wallets[0], null, 2));
        }
    }
}

main().catch(console.error);
