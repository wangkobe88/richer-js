// bt-v102（v117/v118 载体）vs bt-v115（v116 载体）卖腿全清单对比（182 跑）
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager');
const EXPS = {
  v102: { name: 'bt-v102-BP74四步制-删收益50臂-买4卡', prefix: 'c961a49d' },
  v115: { name: 'bt-v115-t139-floor-delgmgn-hold180-v68base', prefix: '34e78e97' },
  v116: { id: 'aa8fb3b3-d4fe-4770-bcd2-b4bd34409b26' },
};

(async () => {
  const c = dbManager.getClient();
  const out = {};
  for (const [label, spec] of Object.entries(EXPS)) {
    let e;
    if (spec.id) {
      const { data } = await c.from('experiments').select('id,experiment_name,config').eq('id', spec.id).limit(1);
      e = data[0];
    } else {
      const { data } = await c.from('experiments').select('id,experiment_name,config').ilike('experiment_name', spec.name + '%').limit(1);
      e = data[0];
      if (!e.id.startsWith(spec.prefix)) throw new Error(label + ' 前缀不符');
    }
    const sc = e.config.strategiesConfig;
    out[label] = {
      name: e.experiment_name,
      buy: sc.buyStrategies.map(l => ({ n: l.name || l.id, c: (l.condition || '').slice(0, 160) })),
      sell: sc.sellStrategies.map(l => ({
        n: l.name || l.id,
        c: (l.condition || ''),
        cards: l.cards, bypass: l.bypassDebounce, prio: l.priority,
      })),
    };
    console.log(label, e.experiment_name, 'buy=' + sc.buyStrategies.length, 'sell=' + sc.sellStrategies.length);
  }
  require('fs').writeFileSync('/tmp/tmp-sellegs.json', JSON.stringify(out));
  console.log('written /tmp/tmp-sellegs.json');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
