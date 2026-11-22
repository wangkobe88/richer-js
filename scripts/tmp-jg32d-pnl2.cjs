const { dbManager } = require('../src/services/dbManager');
(async () => {
  const sb = dbManager.getClient();
  const SYM = { '0xf38f48cfe9e84920e7de4d47823a0fba95a87777':'登天猫','0x988fd57771e0993500c736e032a0e944700c7777':'Greg','0x9c07ea66cbdc29c0e4d11b68ba597d5b20917777':'赵娜丽莎','0xece9cd98e00ac9a56e3f7ab0e4d4df803e587777':'麦麦','0x6fe44c149140f7827213fdeb9ca00d0c85397777':'AGI','0xd0451a539ce2d4321f72e7f1e91c65db8ed87777':'大祭司','0xebbc6754c85e9af69f8939e77fc7cbc284ca7777':'MEME','0xcb1d32fadc28f1dda6a6a799d109396cbfda7777':'Taz','0x1d7d9f2c5480fe49b919c41d1c3952cd92f07777':'金额AI','0x3b2748dfab3c2bc9beab4666cb35af3193be7777':'丁真','0xa2b3b5a7a52595793b733e8eb4cc4bde5f797777':'뿌까','0x995b32765ea74ab7b05b57789fb00c96e6407777':'牢大','0xcadc767df602ce53d42255cefbd8d8e63a747777':'模拟人生','0x5c83f64b15e1b26e8890c5fa4e4e2c60089c7777':'大表鸽','0x2893a7961216a58ce2051dbd9cd4f2d515747777':'万锅共酱会','0xa878e6d446f8906f98203662e595117eb0657777':'SI','0x993816917954aa30b634a262f68c15d60db17777':'女大','0x841b41f3f5266e2931fba12f841a2dbeea2d7777':'人生指南','0x5316e94be2689e4feb4664c79aaf95c01c5d7777':'沫沫','0xe2417e493d109f7d8ee9094ef45b104ffbae7777':'太和殿金像','0x153f8335b1fcda68e459463a5899dd736fd27777':'QAFILA','0xa72df2039229d697abf15da34c515d28f3bb7777':'OON','0xe6765c897daecfecdd4687d49907828a1a2f7777':'黄鲸','0xf37fe6de269801669bdee0e6825a3df107267777':'驴党' };
  const COLL = 'fd3fcb3f-a414-4bdd-a22f-965849f8c59e';
  for (const [name, exp] of [['A现行','2b5e194b-98bb-4f5d-8d9b-a8d5884ae58b'],['B无FP','c4e9f11a-9ce9-46f5-969b-9a935cd16789']]) {
    const { data: trades } = await sb.from('trades').select('token_address,trade_direction,input_amount,output_amount,input_currency,executed_at').eq('experiment_id', exp).order('executed_at');
    const toks = {};
    for (const t of trades || []) {
      const a = t.token_address;
      toks[a] = toks[a] || { cost: 0, proceeds: 0, tokQty: 0 };
      if (t.trade_direction === 'buy' && String(t.input_currency||'').toUpperCase()==='BNB') { toks[a].cost += Number(t.input_amount); toks[a].tokQty += Number(t.output_amount); }
      if (t.trade_direction === 'sell' && String(t.output_currency||'').toUpperCase()==='BNB') { toks[a].proceeds += Number(t.output_amount); toks[a].tokQty -= Number(t.input_amount); }
    }
    console.log(`\n═══ ${name} per-token（pnl=已卖+持仓终值−成本）═══`);
    let sum = 0;
    for (const [a, v] of Object.entries(toks)) {
      let lastP = 0;
      const { data: lt } = await sb.from('case_ticks').select('price_bnb').eq('collection_id', COLL).eq('token_address', a).order('block_time', {ascending:false}).limit(1);
      if (lt && lt[0]) lastP = Number(lt[0].price_bnb);
      const pnl = v.proceeds + v.tokQty * lastP - v.cost;
      sum += pnl;
      console.log(`${String(SYM[a]||a.slice(0,8)).padEnd(7)} 成本${v.cost.toFixed(3)} 已卖${v.proceeds.toFixed(4)} 持仓${v.tokQty > 1e-9 ? v.tokQty.toFixed(0)+'@'+lastP.toExponential(2) : '0'} → pnl ${pnl>=0?'+':''}${pnl.toFixed(4)} BNB`);
    }
    console.log(`合计 ${sum>=0?'+':''}${sum.toFixed(4)} BNB`);
  }
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
