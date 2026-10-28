/**
 * 地址重验等待（C253，2026-10-28 BNCI 0x35c4…7777 案）
 *
 * 病因：dev 自发宣告票常见形状是「创建 token → 拿到 CA → 几分钟后才把 CA 补进
 * bio/宣告推」。prestage 地址核验（账号质量未达标 ∧ 简介/推文无 CA → stage=
 * 'address'）在首析时刻看不到 CA → C238b 回落标准路径 → C250 借壳语料陈旧门
 * （老号+无推文级语料）拦 low 终局。案发实证：MessariCrypto 账号（name 已是
 * BNCI、2011 年老号）02:14:44 创建时刻 bio 无 CA，三轮 accountOnly 补轮
 * （maxAnalyses 默认 3 ≈ 40s 窗）全部拉到 description=null，CA 后补发生在
 * 02:15:23 之后窗已关；事后重析（bio CA 已在场）→ prestage addressVerified=
 * true → 粉丝带 260 粉 mid 翻面。缺口有二：①C84 补轮窗（默认 3 轮）盖不住
 * 分钟级后补 ②PrecheckFailRetryService 的 address 域（300s 窗）按 stage=
 * 'address' 落库行扫，回落分支不落 pre_check_result → 接不到回落票。
 *
 * 修复（NarrativeAnalyzer 回落分支接线）：回落标准路径**之前**进入重验等待——
 * 窗口内周期性纯规则重拉账号语料（getAccountWithFullTweets invalidateCache:
 * true，零 LLM 零 Jev），bio/推文出现 CA（performRulesValidation addressVerified
 * ===true，单一真相源不另写匹配）即失效缓存递归重析一次（走 prestage 核验链，
 * 本案实证 mid）；窗尽未命中照旧回落标准路径（C250 等门接管，既有语义不变）。
 *
 * 等待语义安全性（调用方拓扑实证）：
 * - C84 触发轮：引擎 fire-and-forget 调 getRating（.then 收尾，无 Promise.race
 *   超时包装——与 legacy 直调 30s race 刻意不同），挂 ≤300s 不影响状态机
 *   （inFlight 期间不发新轮，恰是「这轮还没完」的真值）
 * - legacy 直调（NarrativeDirectCaller）：30s Promise.race 超时后台续跑落缓存，
 *   下轮命中——既有语义天然兼容
 * - worker / 手动重析：analyze 何时 resolve 不影响调度（taskTimeout 180s 的
 *   任务会超时重试，重试轮吃缓存行幂等）
 *
 * 三道护栏（shouldAttemptAddressRecheck）：
 * 1. 新鲜门：token 创建锚距 now ≤ windowMs（缺锚 fail-closed 不等待——历史/
 *    回测票不挂 300s）
 * 2. 深度限死：options._addressRecheckDepth < 1——递归重析内再回落（拉验可见
 *    而重析不可见的极端竞态）不得二次等待，直接回落
 * 3. 配置门：显式 enabled:false 关
 *
 * 配置（config/narrative-engine.json 顶层 addressRecheck 段，narrativeRetry
 * 同语义：删段=开+默认参数）：
 *   { enabled: true, intervalMs: 15000, windowMs: 300000 }
 * intervalMs [3000,600000] / windowMs [30000,3600000] 越界/残缺 throw
 * fail-loud（vision/searchFallback 同语义：只在启用时校验）。
 */

import { getConfig } from '../../engine/config.mjs';
import { getAccountWithFullTweets, performRulesValidation } from '../prompts/account/account-community-rules.mjs';

const CODE_DEFAULTS = {
  intervalMs: 15000,
  windowMs: 300000, // 对齐 PrecheckFailRetryService address 域窗（300s）
};

/**
 * 读取并校验 addressRecheck 配置段。
 * @param {Object} [options] - 单测注入 { config }（整个 config 对象形状，覆盖全局读取）
 * @returns {Object|null} 完整配置（含代码默认值）；显式 enabled:false / 显式段 null → null。
 *   段缺失=默认开（narrativeRetry「删段=开」先例——同为重评家族）。
 * @throws 启用但 intervalMs/windowMs 残缺或越界（部署错误 fail-loud）
 */
export function getAddressRecheckConfig(options = {}) {
  const raw = options.config
    ? options.config.addressRecheck
    : getConfig().addressRecheck;
  // 显式关：段值为 null/false 或 enabled:false；段缺失（undefined）=默认开+默认参数
  // （narrativeRetry「删段=开」先例——同为重评家族）
  if (raw === null || raw === false || raw?.enabled === false) return null;
  const cfg = { ...CODE_DEFAULTS, ...(raw || {}) };
  if (!Number.isFinite(cfg.intervalMs) || cfg.intervalMs < 3000 || cfg.intervalMs > 600000) {
    throw new Error(`addressRecheck 配置残缺：intervalMs 须为 [3000,600000] 内数字（当前 ${cfg.intervalMs}）`);
  }
  if (!Number.isFinite(cfg.windowMs) || cfg.windowMs < 30000 || cfg.windowMs > 3600000) {
    throw new Error(`addressRecheck 配置残缺：windowMs 须为 [30000,3600000] 内数字（当前 ${cfg.windowMs}）`);
  }
  return cfg;
}

/**
 * 重验资格判定（纯函数）：新鲜门 + 深度限死 + 配置门。
 * @param {Object} tokenData - fetchTokenData 返回（tokenCreatedAtSec 统一源，
 *   wss_events 回退补全后 flap 盘也有）
 * @param {Object} options - analyze 调用 options（_addressRecheckDepth 透传链）
 * @param {number} nowMs - 当前毫秒（调用方传入，禁内部 Date.now——单测可注入）
 * @param {Object|null} [config] - 已解析配置（缺省现场读）
 * @returns {boolean}
 */
export function shouldAttemptAddressRecheck(tokenData, options, nowMs, config) {
  const cfg = config !== undefined ? config : getAddressRecheckConfig();
  if (!cfg) return false;
  if ((options?._addressRecheckDepth || 0) >= 1) return false;
  const createdSec = tokenData?.tokenCreatedAtSec || tokenData?.raw_api_data?.created_at || null;
  if (!Number.isFinite(createdSec)) return false;
  return nowMs - createdSec * 1000 <= cfg.windowMs;
}

/**
 * 重验循环：窗口内周期性真拉账号语料做地址核验（纯规则，零 LLM）。
 * 首查不睡（回落点距首轮拉取已隔分析耗时，立刻验一次）；下次检查点将超窗即停
 * （不发超窗拉取）。拉取/校验异常计为一次尝试继续（窗口自节流，宁跳不冒充）。
 *
 * @param {Object} p
 * @param {string} p.tokenAddress - 代币地址（小写）
 * @param {string} p.tokenSymbol
 * @param {string} p.tokenName
 * @param {string} p.screenName - 回落票的宣告账号（fetchResults.twitterInfo）
 * @param {number|null} [p.untilSec] - 推文窗下界（prestage 同款：创建锚-24h）
 * @param {Object} [deps] - 单测注入 { pull, sleep, now, config }
 * @returns {Promise<{hit: boolean, attempts: number, followersCount: number|null}>}
 */
export async function recheckAddressEvidence(p, deps = {}) {
  const cfg = deps.config !== undefined ? deps.config : getAddressRecheckConfig();
  const pull = deps.pull ?? ((screenName, opts) => getAccountWithFullTweets(screenName, 20, opts));
  const sleep = deps.sleep ?? ((ms) => new Promise(r => setTimeout(r, ms)));
  const now = deps.now ?? (() => Date.now());
  const startMs = now();
  const pullOpts = {
    tokenAddress: p.tokenAddress,
    invalidateCache: true,
    ...(p.untilSec != null ? { untilSec: p.untilSec } : {}),
  };
  let attempts = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempts++;
    let data = null;
    try {
      data = await pull(p.screenName, pullOpts);
    } catch {
      // 拉取失败计尝试继续（不中断窗口）
    }
    if (data) {
      try {
        const rules = performRulesValidation(p.tokenAddress, p.tokenSymbol, p.tokenName, data, {});
        if (rules.addressVerified === true) {
          return { hit: true, attempts, followersCount: data.followers_count ?? null };
        }
      } catch {
        // 校验异常计尝试继续
      }
    }
    if (now() - startMs + cfg.intervalMs >= cfg.windowMs) {
      return { hit: false, attempts, followersCount: null };
    }
    await sleep(cfg.intervalMs);
  }
}
