#!/usr/bin/env node
/** 临时排查：0x9c60…7777 叙事没过是否因「没看图」——token_narrative + vision 链路审计（单 token 小读取） */
require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');

const ADDR = '0x9c6094a5dc41bcacccb91ad35bd507b083507777';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY, {
  fetch: async (url, opts = {}) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 30000);
    try { return await fetch(url, { ...opts, signal: c.signal }); } finally { clearTimeout(t); }
  },
});

(async () => {
  // 1. token_narrative 行
  const { data: rows, error: eNar } = await sb.from('token_narrative').select('*').eq('token_address', ADDR).limit(2);
  if (eNar) console.log('token_narrative err:', eNar.message);
  console.log('=== token_narrative（', (rows || []).length, '行）===');
  for (const row of rows || []) {
    for (const [k, v] of Object.entries(row)) {
      if (k === 'raw_api_data') continue;
      const s = typeof v === 'object' && v !== null ? JSON.stringify(v, null, 1) : String(v);
      console.log(`\n--- ${k} ---`);
      console.log(s && s.length > 6000 ? s.slice(0, 6000) + `…(共${s.length})` : s);
    }
    // raw_api_data 摘要：找主推 URL / 图
    const rad = row.raw_api_data || {};
    console.log('\n--- raw_api_data 摘要 ---');
    console.log('created_at:', rad.created_at);
    console.log('classified_urls:', JSON.stringify(rad.classified_urls)?.slice(0, 2000));
    console.log('twitter_info:', JSON.stringify(rad.twitter_info)?.slice(0, 1500));
    console.log('extracted_info:', JSON.stringify(rad.extracted_info)?.slice(0, 800));
  }
  if (!rows || !rows.length) console.log('(无 token_narrative 行)');

  // 2. 信号 narrativeCall 轨迹（timing 含 vision.gate 段）
  const { data: signals, error: e1 } = await sb.from('strategy_signals').select('id,experiment_id,side,action,status,price,created_at,metadata').eq('token_address', ADDR).order('created_at').limit(10);
  console.log('\n=== strategy_signals（', (signals || []).length, '行）===');
  if (e1) console.log('err:', e1.message);
  for (const s of signals || []) {
    const md = s.metadata || {};
    console.log(`#${s.id} exp=${(s.experiment_id || '').slice(0, 8)} side=${s.side} action=${s.action} status=${s.status} price=${s.price} at=${s.created_at}`);
    console.log('  narrativeCall:', JSON.stringify(md.narrativeCall)?.slice(0, 3000));
  }

  // 3. token_create（名字/宣告链接）
  const { data: ev } = await sb.from('wss_events').select('kind,block_time,payload').eq('token_address', ADDR).eq('kind', 'token_create').limit(1);
  console.log('\n=== token_create ===');
  const p = ev && ev[0] && ev[0].payload || {};
  console.log('name:', p.name, '| symbol:', p.symbol, '| block_time:', ev && ev[0] && ev[0].block_time);
  console.log(JSON.stringify(p).slice(0, 600));

  // 4. 图缓存：tweet_image / tweet_image_raw（key 含 status id 才查，避免全表）
  const strAll = JSON.stringify((rows || []).map(r => r.raw_api_data || {}));
  const statusIds = [...new Set((strAll.match(/status(?:es)?\/(\d{1,20})/g) || []).map(m => m.split('/')[1]))];
  console.log('\n=== 图缓存探查 === status ids:', statusIds);
  for (const sid of statusIds.slice(0, 3)) {
    const { data: cache } = await sb.from('external_resource_cache').select('resource_type,cache_key,created_at,expires_at,is_valid').contains('cache_key', [sid]).limit(20);
    console.log(`sid=${sid}:`, JSON.stringify(cache));
  }
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
