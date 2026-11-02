// 看 Jev 实际 state + 引擎侧信号/轮次留痕
const { dbManager } = require('../src/services/dbManager.js');
const ADDR = '0xdb1160d96885993a69bd9cb149ebff4d4a437777';

(async () => {
  const db = dbManager.getClient();
  const { data, error } = await db
    .from('token_narrative')
    .select('jev_prompt,raw_api_data')
    .eq('token_address', ADDR)
    .single();
  if (error) throw error;

  const rad = data.raw_api_data || {};
  console.log('=== raw_api_data.eventTs:', rad.eventTs, '| creator:', rad.creator, '| source:', rad.source);
  console.log('meta:', JSON.stringify(rad.meta || {}).slice(0, 300));

  const st = data.jev_prompt;
  if (st && typeof st === 'object') {
    console.log('\n=== jev_prompt.state 键:', Object.keys(st).join(','));
    const s = JSON.stringify(st, null, 1);
    console.log('state 总长:', s.length);
    // 打 Twitter 段和 header 段
    const tw = st.twitter || st.twitterInfo;
    if (tw) console.log('\n-- twitter 段:', JSON.stringify(tw).slice(0, 1200));
    for (const k of Object.keys(st)) {
      if (/twitter|search|website|corpus|knowledge|header/i.test(k) && k !== 'twitter') {
        console.log(`\n-- ${k}:`, JSON.stringify(st[k]).slice(0, 600));
      }
    }
  } else {
    console.log('jev_prompt:', String(st).slice(0, 500));
  }

  // 引擎信号留痕（含拒买叙事形状）
  const { data: sig, error: es } = await db
    .from('strategy_signals')
    .select('id,signal_type,action,side,reason,metadata,created_at')
    .eq('experiment_id', '7dd26b85-16ac-43dd-a4f7-98840198cebf')
    .eq('token_address', ADDR)
    .order('created_at', { ascending: true });
  if (es) console.log('signals error:', es.message);
  else {
    console.log('\n=== strategy_signals 行数:', sig.length);
    for (const s of sig) {
      console.log(`[${s.created_at}] type=${s.signal_type} action=${s.action} reason=${(s.reason||'').slice(0,150)}`);
      const md = s.metadata || {};
      if (md.narrativeRating !== undefined || md.narrativeCategory !== undefined) {
        console.log('   narrativeRating:', md.narrativeRating, '| category:', md.narrativeCategory, '| narrativeRounds:', md.narrativeRounds);
      }
      const mk = Object.keys(md);
      if (mk.length) console.log('   metadata keys:', mk.join(','));
    }
  }

  // rounds 全列
  const { data: r2, error: er } = await db
    .from('narrative_analysis_rounds')
    .select('*')
    .eq('token_address', ADDR);
  if (!er) {
    console.log('\n=== rounds 全列（', r2.length, '行）');
    for (const r of r2) console.log(JSON.stringify(r).slice(0, 600));
  }

  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
