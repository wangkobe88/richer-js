'use strict';
/* gang-live-v1（0bf223e5）持仓清单：trades 表推导净持仓（182 跑，单实验小查询） */
const { dbManager } = require('../src/services/dbManager.js');
const EXP = '0bf223e5-7626-4350-91a9-dfe0fc08bff6';

(async () => {
    const db = dbManager.getClient();
    const { data, error } = await db.from('trades').select('*')
        .eq('experiment_id', EXP)
        .order('executed_at', { ascending: true });
    if (error) throw error;
    console.log(`trades 行数 ${data.length}`);
    if (data.length) console.log('列名样例:', Object.keys(data[0]).join(','));
    const pos = new Map();
    for (const t of data) {
        const k = t.token_address;
        const p = pos.get(k) || { symbol: t.token_symbol || t.symbol || '?', qty: 0, buys: 0, sells: 0 };
        const q = Number(t.quantity ?? t.amount ?? 0);
        if ((t.side === 'buy')) { p.qty += q; p.buys++; }
        else if (t.side === 'sell') { p.qty -= q; p.sells++; }
        pos.set(k, p);
        console.log(t.executed_at, (t.side || '').padEnd(4), (p.symbol).padEnd(10), q, t.token_address);
    }
    console.log('\n== 净持仓 > 0 ==');
    for (const [k, p] of pos) if (p.qty > 1e-9) console.log(p.symbol.padEnd(10), p.qty.toFixed(6), k, `(买${p.buys}/卖${p.sells})`);
    process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
