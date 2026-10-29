// 临时排查：0x587c61b4…7777 在 d41b9c29 实验的 trades 行形状（本地小结果读取）
const { createClient } = require('@supabase/supabase-js');

function loadEnv() {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '..', 'config', '.env');
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const env = loadEnv();
const db = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  global: { headers: { apikey: env.SUPABASE_ANON_KEY } },
});

// 红线 3：trades 不在 RLS 静默过滤清单里，但保险起见直接用 service key（dbManager 同款）
const dbSvc = (() => {
  try {
    return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY);
  } catch (e) {
    return db;
  }
})();

(async () => {
  const TOKEN = '0x587c61b4a5052b7e5e0563be61b9be0a0aa27777';
  const EXP = 'd41b9c29-2a06-4178-908a-cd97b33e497f';

  const { data, error } = await db
    .from('trades')
    .select('*')
    .eq('experiment_id', EXP)
    .eq('token_address', TOKEN)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) {
    console.error('ERR', error);
    process.exit(1);
  }
  console.log('rows:', data.length);
  for (const t of data) {
    console.log(JSON.stringify({
      id: t.id,
      dir: t.trade_direction,
      ok: t.success,
      in: t.input_amount,
      out: t.output_amount,
      price: t.unit_price ?? t.price,
      at: t.created_at ?? t.executed_at,
      sym: t.token_symbol,
      platform: t.platform,
      sellPercentage: t.metadata?.sellPercentage,
      cardTrade: t.metadata?.cardTrade ?? null,
      reason: t.metadata?.reason ?? t.metadata?.tradeResult?.reason ?? null,
      execPrice: t.metadata?.buyExecutedPriceBnb ?? null,
      priceBnb: t.metadata?.priceBnb ?? t.metadata?.currentPriceBnb ?? null,
    }));
  }
})();
