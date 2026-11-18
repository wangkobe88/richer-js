// ea78 P0 反推：LibCurve (1e9+h-s)(eth+r)=k 数值拟合（BNB 域齐次，quote 汇率吸收进 R）
// 数据 = 首 8 笔（来自 wss_price_ticks，price_bnb=成交后边际价）
const TRADES = [
  { t: 'buy',  g: 0.99775293, ds: 171130070, post: 6.8274945e-9 },
  { t: 'buy',  g: 0.19753719, ds: 27792686,  post: 7.2517983e-9 },
  { t: 'buy',  g: 0.098766963, ds: 13286185, post: 7.4687429e-9 },
  { t: 'sell', g: 0.27938325, ds: 39871180,  post: 6.8451490e-9 },
  { t: 'sell', g: 0.27420012, ds: 42744325,  post: 6.2595526e-9 },
  { t: 'buy',  g: 0.098771950, ds: 15375862, post: 6.4612331e-9 },
  { t: 'buy',  g: 0.13630351, ds: 20440899,  post: 6.7447997e-9 },
  { t: 'buy',  g: 0.16000583, ds: 22914102,  post: 7.0854469e-9 },
];

// 无模型区间：凸曲线上买入路径均价 ∈ (P0, post)
console.log('== 无模型界 ==');
for (let i = 0; i < TRADES.length; i++) {
  const tr = TRADES[i];
  const avg = tr.g / tr.ds;
  console.log(`#${i + 1} ${tr.t} avg=${avg.toExponential(4)} post=${tr.post.toExponential(4)} post/avg=${(tr.post / avg).toFixed(4)}`);
}

// 拟合：state {eth, N}，k=N0*R
function simulate(params) {
  const { R, h, lb, ls } = params;
  const N0 = 1e9 + h;
  const k = N0 * R;
  let eth = 0, N = N0;
  const out = [];
  for (const tr of TRADES) {
    if (tr.t === 'buy') {
      const de = lb * tr.g;
      eth += de;
      const N2 = k / (eth + R);
      out.push({ dsPred: N - N2, postPred: k / (N2 * N2) });
      N = N2;
    } else {
      const de = ls * tr.g;
      eth -= de;
      const N2 = k / (eth + R);
      out.push({ dsPred: N2 - N, postPred: k / (N2 * N2) });
      N = N2;
    }
  }
  return out;
}

function loss(params) {
  // 约束有效性
  if (params.R <= 0 || params.h <= -1e9 || params.lb <= 0 || params.ls <= 0) return 1e18;
  const out = simulate(params);
  let s = 0;
  for (let i = 0; i < TRADES.length; i++) {
    const e1 = Math.log(out[i].postPred / TRADES[i].post);
    const e2 = Math.log(out[i].dsPred / TRADES[i].ds);
    s += e1 * e1 * 4 + e2 * e2; // postPrice 权重高（无模型噪声小）
  }
  return s;
}

// 坐标下降粗搜 + 细化
let best = { R: 5.0, h: 5e7, lb: 0.98, ls: 1.0204 };
let bestL = loss(best);
const step0 = { R: 2.0, h: 5e7, lb: 0.1, ls: 0.1 };
let scale = 1;
for (let iter = 0; iter < 4000; iter++) {
  for (const key of ['R', 'h', 'lb', 'ls']) {
    for (const dir of [1, -1]) {
      const cand = { ...best };
      cand[key] = best[key] + dir * step0[key] * scale * Math.random();
      const l = loss(cand);
      if (l < bestL) { bestL = l; best = cand; }
    }
  }
  if (iter % 400 === 399) scale *= 0.6;
}
console.log('\n== 最优拟合 ==');
console.log(`R=${best.R.toFixed(4)} BNB  h=${Math.round(best.h)}  λbuy=${best.lb.toFixed(4)}  λsell=${best.ls.toFixed(4)}  loss=${bestL.toFixed(4)}`);
const P0 = best.R / (1e9 + best.h);
const FL = 6.14 / (107036752 + 1e9);
console.log(`P0 = R/(1e9+h) = ${P0.toExponential(4)} BNB  （FL 常量 ${FL.toExponential(4)}，偏差 ${((P0 / FL - 1) * 100).toFixed(1)}%）`);
console.log(`初始市值 = P0×1e9 = ${(P0 * 1e9).toFixed(3)} BNB`);
const out = simulate(best);
console.log('\n逐笔对拍（pred vs obs）:');
for (let i = 0; i < TRADES.length; i++) {
  console.log(`#${i + 1} ${TRADES[i].t} post: ${(out[i].postPred / TRADES[i].post * 100).toFixed(2)}%  Δs: ${(out[i].dsPred / TRADES[i].ds * 100).toFixed(2)}%`);
}
