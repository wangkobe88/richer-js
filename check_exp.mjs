import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: 'config/.env' });

const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

const exp008 = "015db965-0b33-4d98-88b1-386203886381";
const exp007 = "4c265a5b-8fa9-4b4e-b19d-f7bd1adc2bb1";

for (const [id, name] of [[exp008, "虚拟008"], [exp007, "虚拟007"]]) {
  console.log(`\n=== ${name} (${id.substr(0, 8)}...) ===`);

  const { count: tokenCount } = await client
    .from("experiment_tokens")
    .select("*", { count: "exact", head: true })
    .eq("experiment_id", id);

  const { count: tsCount } = await client
    .from("experiment_time_series_data")
    .select("*", { count: "exact", head: true })
    .eq("experiment_id", id);

  const { count: signalCount } = await client
    .from("strategy_signals")
    .select("*", { count: "exact", head: true })
    .eq("experiment_id", id);

  console.log(`  Tokens: ${tokenCount || 0}`);
  console.log(`  TimeSeries: ${tsCount || 0}`);
  console.log(`  Signals: ${signalCount || 0}`);
}
