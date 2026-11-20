const { dbManager } = require('../src/services/dbManager');
async function main() {
  const sb = dbManager.getClient();
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 30000));
    const { data, error } = await sb.from('experiments').select('status,updated_at')
      .eq('id','2fe55b27-e275-4792-b3bd-e815bb045be8').limit(1);
    if (error) throw error;
    const st = data[0]?.status;
    process.stdout.write(`[${new Date().toISOString()}] status=${st}\n`);
    if (st === 'completed' || st === 'failed' || st === 'stopped') {
      console.log('FINAL:', st);
      process.exit(0);
    }
  }
  console.log('TIMEOUT 30min');
  process.exit(1);
}
main().catch(e => { console.error(e.message); process.exit(1); });
