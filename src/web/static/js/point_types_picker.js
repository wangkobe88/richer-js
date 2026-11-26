/**
 * 点位类型激活开关——纯函数核（T242，2026-11-26 用户指令「将 pointType 的开关激活改为
 * 实验层面可配置项」「web 创建页加类型开关」）。
 *
 * 实验 config.pointTypes.active = {类型 id: 布尔} 逐类型覆盖注册表 active 缺省（引擎
 * _resolveStrategyPack 解析，point-type-router.js）。同一份有效表管两处：分类（未激活
 * 类型不命中，信号回落后续类型 / normal 兜底）与专属触发腿（包买腿携带 pointType 绑定，
 * 类型未激活即该腿不组装）。
 *
 * 本文件零 DOM 零网络：创建页（create_experiment.html）负责取数与渲染，这里只算
 * 「初值 / 汇总 / 行模型 / 摘要」。UMD 形态——浏览器挂 window.PointTypesPicker，
 * Node 下 module.exports 供单测（scripts/_test_point_types_picker.cjs）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PointTypesPicker = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NORMAL_ID = 'normal';

  /**
   * 包买腿的 pointType 绑定 → {类型 id: ['P16', …]}（专属触发腿提示；升序）。
   * 不带绑定的腿（ladder 十四腿）不出现；无 definition / 非数组 → {}。
   */
  function boundLegsByType(definition) {
    var out = {};
    var legs = definition && Array.isArray(definition.buyLegs) ? definition.buyLegs : [];
    legs.forEach(function (leg) {
      if (!leg || typeof leg !== 'object' || typeof leg.pointType !== 'string' || !leg.pointType) return;
      (out[leg.pointType] = out[leg.pointType] || []).push('P' + (leg.priority != null ? leg.priority : '?'));
    });
    Object.keys(out).forEach(function (id) { out[id].sort(); });
    return out;
  }

  /**
   * 初始勾选表 {类型 id: 布尔}：复制携带的实验覆盖优先，其次注册表缺省；normal 恒 true
   * （兜底类型不可停用——引擎 resolvePointTypeOverride 同口径拒启）。
   * 覆盖表里出现注册表之外的类型 id 一概忽略（陈旧覆盖不冒充；引擎会拒启那种实验，
   * 但复制件不该把陈旧键带进新实验）。
   * @param {Array<{id:string,active:boolean}>} types - 注册表（GET /api/strategy-library/point-types）
   * @param {Object|null} [override] - 复制携带的 config.pointTypes.active
   */
  function initialChecks(types, override) {
    var ov = override && typeof override === 'object' && !Array.isArray(override) ? override : null;
    var out = {};
    (types || []).forEach(function (t) {
      out[t.id] = t.id === NORMAL_ID ? true
        : (ov && typeof ov[t.id] === 'boolean' ? ov[t.id] : t.active === true);
    });
    return out;
  }

  /**
   * 勾选表 → config.pointTypes 段。与注册表缺省全等 → null（不写段：等价缺省，且不留
   * 一份陈旧覆盖——日后注册表加类型 / 翻 active 自然生效）。
   * @returns {{active:Object}|null}
   */
  function collectConfig(types, checks) {
    var active = {};
    var differs = false;
    (types || []).forEach(function (t) {
      var v = t.id === NORMAL_ID ? true : !!(checks && checks[t.id] === true);
      active[t.id] = v;
      if (v !== (t.active === true)) differs = true;
    });
    return differs ? { active: active } : null;
  }

  /**
   * 渲染行模型（注册表顺序）：{id, label, checked, isNormal, registryActive, legs:[…]}
   */
  function rows(types, boundLegs, checks) {
    return (types || []).map(function (t) {
      return {
        id: t.id,
        label: t.label || t.id,
        checked: t.id === NORMAL_ID ? true : !!(checks && checks[t.id] === true),
        isNormal: t.id === NORMAL_ID,
        registryActive: t.active === true,
        legs: (boundLegs && boundLegs[t.id]) || [],
      };
    });
  }

  /**
   * 一行摘要：激活 n / 未激活 m ｜ 因未激活而不组装的专属腿（无则「专属腿全在」）
   * @returns {{activeN:number, inactiveN:number, disabledLegs:string[]}}
   */
  function summary(types, boundLegs, checks) {
    var activeN = 0, disabled = [];
    (types || []).forEach(function (t) {
      var on = t.id === NORMAL_ID ? true : !!(checks && checks[t.id] === true);
      if (on) { activeN++; return; }
      (boundLegs && boundLegs[t.id] || []).forEach(function (p) { disabled.push(p); });
    });
    disabled.sort();
    return { activeN: activeN, inactiveN: (types || []).length - activeN, disabledLegs: disabled };
  }

  return {
    NORMAL_ID: NORMAL_ID,
    boundLegsByType: boundLegsByType,
    initialChecks: initialChecks,
    collectConfig: collectConfig,
    rows: rows,
    summary: summary,
  };
}));
