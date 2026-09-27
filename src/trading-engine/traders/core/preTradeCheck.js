/**
 * 成交前预校验纯函数（live L1 核心防线，迁自 rich-js BURNIE 事故修复）
 *
 * 背景：rich-js BURNIE 事故（2026-09-04）——引擎按 K 线价预期 98855 枚，路由实际
 * 报价 139.34 枚（ratio=0.0014），预期数量从未到达任何能拦交易的层。本模块把
 * 「引擎按信号价推导的预期到手量」与「trader 即将执行的报价」在签名前交叉校验，
 * 不达标即拒绝执行。richer-js 侧对齐双事故面：BURNIE 式报价错位 + 尘埃报价
 * （09-14 V2 死路由 14 笔 ~0.88 BNB，相对滑点对尘埃报价失效——绝对锚才能拦）。
 *
 * 校验点必须放在 trader 内部（拿到可执行报价之后、构建/签名交易之前）：
 * 引擎层先 quote 再下单存在 TOCTOU 缝，校验即将执行的那笔报价才是零缝防线。
 *
 * meme 内盘 vs rich-js 默认值的差异：rich-js 0.9 是对已毕业稳定池；four.meme/flap
 * 内盘波动大（早止窗口 earlyReturn 80-120%，正常滑点 10-30%，貔貅/尘埃 0.1% 级），
 * 默认阈值 0.5 是合理分界（正常波动放行、灾难报价拦截）。可经 live 配置 minOutRatio 覆盖。
 *
 * 纯函数、仅依赖 decimal.js，trader 与引擎均可安全 require。
 */

const Decimal = require('decimal.js');

/**
 * 校验内盘报价到手量不低于引擎预期量的 ratio 倍
 *
 * @param {Object} p
 * @param {string|number} p.expectedOut  引擎按信号价推导的预期到手量（UI 单位：token 数或 BNB 数）
 * @param {number}         p.decimals    精度（0-18 整数；BSC meme 18，BNB 侧恒 18）
 * @param {string|bigint}  p.quoteOutRaw 即将执行的内盘报价到手量（base units 原始整数，
 *                                       如 helper trySell funds-fee、Portal quoteExactInput 返回值）
 * @param {number}         p.minOutRatio 比值阈值（0 < r <= 1）。语义与事后 buyReceiveRatio
 *                                       刻意不同：事前是「报价 vs 信号价预期」（信号滞后+波动，需宽松），
 *                                       事后是「实际到手 vs 请求」（同源对比，可收紧）。不要"统一"这两个值。
 * @param {string}         [p.context]   错误消息上下文（如 'sellToken <addr>'）
 * @returns {{ratio: string, quoteOutUi: string}} 校验通过，携带换算结果供日志
 * @throws 校验不达标 / 参数缺失 / 参数非法 —— 全部 throw（fail loud，绝不静默放行）
 */
function assertMinOut({ expectedOut, decimals, quoteOutRaw, minOutRatio, context = '' }) {
  const where = context ? `${context}: ` : '';

  // 参数契约：expectedOut 必传。缺失即 throw——任何绕过引擎直接调 trader 的
  // 调用方都被逼显式表态，防止"引擎没传就静默不检"回到事故之前的世界
  if (expectedOut === undefined || expectedOut === null) {
    throw new Error(`${where}预期到手校验参数缺失(expectedOut)，拒绝执行`);
  }
  const expected = new Decimal(expectedOut);
  if (!expected.isFinite() || expected.lte(0)) {
    throw new Error(`${where}预期到手校验参数非法(expectedOut=${expectedOut})，拒绝执行`);
  }

  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error(`${where}预期到手校验参数非法(decimals=${decimals})，拒绝执行`);
  }

  if (typeof minOutRatio !== 'number' || !Number.isFinite(minOutRatio) || minOutRatio <= 0 || minOutRatio > 1) {
    throw new Error(`${where}预期到手校验参数非法(minOutRatio=${minOutRatio})，拒绝执行`);
  }

  const quoteRaw = new Decimal(quoteOutRaw.toString());
  if (!quoteRaw.isFinite() || quoteRaw.lte(0)) {
    throw new Error(`${where}报价到手量非法(quoteOutRaw=${quoteOutRaw})，拒绝执行`);
  }

  const quoteOutUi = quoteRaw.div(Decimal.pow(10, decimals));
  const ratio = quoteOutUi.div(expected);

  if (ratio.lt(minOutRatio)) {
    throw new Error(
      `${where}[预成交校验] 拒绝执行: 报价到手 ${quoteOutUi.toFixed(8)} < 预期 ${expected.toFixed(8)} × minOutRatio ${minOutRatio} (ratio=${ratio.toFixed(6)})`
    );
  }

  return { ratio: ratio.toFixed(6), quoteOutUi: quoteOutUi.toFixed(8) };
}

module.exports = { assertMinOut };
