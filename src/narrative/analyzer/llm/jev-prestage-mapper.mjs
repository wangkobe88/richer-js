/**
 * Jev prestage answers → 前置判定结果映射器（P3）
 *
 * 全部确定性判定在本文件完成（原 V2.0/V1.0 prompt 的评级数学下沉代码端）：
 * - addressVerified=false → 固定 account_based_meme：名称关联≠none 且 P(has_traffic)≥0.5
 *   两条件同时满足 → mid，否则 low（2026-09-27 裁定：abm 双证据成立给结论 mid，
 *   不再 unrated——分析完成必须有 low/mid/high 结论，9 只保留给直调失败/超时/未触发）
 * - addressVerified=true → token_type 二分（V2.0 第一步）：
 *   - web3_native_ip_early → 按账号基本面定档（rateProject 粉丝带；2026-09-27 裁定
 *     不再 unrated"等社区成长"——过与不过要有结论）。
 *     P1.11（C101，2026-10-18 用户裁定「web3_native_ip_early 仅限于账号」）：
 *     仅账号/社区语料（corpusType!=='tweet'）可采信；推文语料（挂链 URL 是一条
 *     推文，token 不是该账号的 IP——OK❌ 案）不采信，回落 abm 双条件评定
 *     （两题恒带已答，零额外调用；corpusType 缺省 null=放行，存量调用零影响）
 *   - project 评级（V2.0 第三步表，就高处理——认证记 details 不参与）：
 *     账号 0-299 mid / ≥300 high；社区 ≥100 且活跃 high / 其余 mid。
 *     P1.10 账号基本面门全删（2026-10-15 用户裁定，bunker 案 C70）：粉丝底线 <20、
 *     推文 <5、账号年龄 <30 天三道门 + P1.5 实度豁免全部删除——粉丝/成员数只定档
 *     不拦截；A 路径的核心价值=CA 匹配（performRulesValidation 保留）
 *     P1.14/C164（2026-10-22 用户裁定「原生项目币一定要看网站+叙事，没问题才能
 *     给过」）：project 分支加官网核验门——website_substantiates /
 *     no_website_non_infra 放行走粉丝带；website_shell_or_mismatch /
 *     website_unreachable / no_website_infra_claim → low 拦（配套裁定：①抓不到=拦
 *     fail-closed ②无官网仅基础设施/平台类宣称拦）。两项均为题面 choice 承载、
 *     代码端映射（题面改锚分不动——mapper 门是唯一拦截位）
 * - 输出 prestageDataToSave 与旧 prestageData 字段一一对应（存储契约不变），
 *   promptType 用于 prompt_type 列识别新旧格式
 */

import { JEV_PRESTAGE_QUESTIONS_VERSION } from './jev-prestage-questions.mjs';

const round2 = (x) => Math.round(x * 100) / 100;

/** abm 名称关联选项 → 中文标签（reason 模板用） */
const NAME_LINK_LABELS = {
  exact: '精确匹配',
  abbreviation: '缩写匹配',
  semantic: '语义关联',
  none: '无关联',
};

/**
 * P1.14/C164 项目币官网核验选项 → 中文标签（reason 模板用）。
 * pass 臂=website_substantiates / no_website_non_infra（走粉丝带）；
 * 拦臂=website_shell_or_mismatch / website_unreachable / no_website_infra_claim → low
 * （配套裁定：抓不到=拦 fail-closed；无官网仅基础设施/平台类宣称拦）
 */
const WEBSITE_GATE_LABELS = {
  website_substantiates: '官网核验通过（内容支撑产品宣称）',
  no_website_non_infra: '无官网但非基础设施类（产品载体不依赖网站）',
  website_shell_or_mismatch: '网站空壳/与宣告叙事不符',
  website_unreachable: '官网抓取失败（死链/超时/被拦——抓不到=拦）',
  no_website_infra_claim: '基础设施/平台类宣称但无官网（无站=无产品）',
};

/**
 * abm 双条件评定（addressVerified=false 路径与 C101 推文语料回落共用；
 * 输入仅为恒带两题的 answers，输出与旧内联块 bit 一致）
 * @returns {{rating: string, reasoning: string, details: Object, jevDetails: Object, pass: boolean}}
 */
function evaluateAbmAnswers(answers, { followers, members }) {
  const nameLink = answers.prestage_abm_name_link?.choice || 'none';
  const trafficChoice = answers.prestage_abm_web3_traffic?.choice || 'no_traffic';
  const trafficP = answers.prestage_abm_web3_traffic?.probabilities?.has_traffic ?? 0;

  const nameOk = nameLink !== 'none';
  const trafficOk = trafficP >= 0.5;
  const rating = (nameOk && trafficOk) ? 'mid' : 'low';

  const failed = [];
  if (!nameOk) failed.push('名称关联不成立');
  if (!trafficOk) failed.push('无30天内Web3流量事件');

  const reasoning = `名称关联:${NAME_LINK_LABELS[nameLink] || nameLink}｜Web3流量:${trafficOk ? `有(P=${round2(trafficP)})` : `无(P=${round2(trafficP)}，choice=${trafficChoice})`}｜${rating === 'mid' ? '两条件同时满足→mid（账号背景 meme 双证据成立）' : `不满足:${failed.join('、')}→low`}`;

  return {
    rating,
    reasoning,
    pass: true, // 对齐旧 abm 分支的 prestageData.pass=true（判定本身完成）
    details: {
      followers,
      members,
      accountMatchDetails: `${NAME_LINK_LABELS[nameLink] || nameLink}（Jev choice=${nameLink}）`,
      web3Interaction: trafficOk ? '有近期Web3流量事件' : `无近期Web3流量事件（P=${round2(trafficP)}）`,
    },
    jevDetails: { nameLink, trafficChoice, trafficP },
  };
}

/**
 * project / web3ip 评级（纯确定性，V2.0 评级表下沉；high 档就高处理：
 * 旧表 high 只写 300-2999 且"认证/蓝V优先"无量化规则 → ≥300 一律 high，
 * 认证状态记入 details 不参与计算——评级可由 followers/members 复算验证）
 * P1.10 账号基本面门全删（2026-10-15 用户裁定，bunker 案 C70，0x2ec1e08c…7777
 * flap 21 分钟毕业）：交易者不会因为项目方粉丝少/账号新/推文少而拒绝一个项目
 * ——粉丝底线 <20、推文 <5、账号年龄 <30 天三道门与 P1.5 实度豁免全删。实证：
 * 近 7 天底线拦截 168 票其中 16 票毕业（9.5%，判别力接近随机）；发币后 5 秒的
 * userInfo 快照（30 天缓存）对「当天新号发币」场景系统性失真（bunker 发币时 2 粉
 * 4 推、10 小时后 94 粉 17 推）。粉丝/成员数只定档：账号 0-299 mid / ≥300 high，
 * 社区恒 mid（P1.12 删 prestage_community_activity 题后回落——原 ≥100∧活跃 high
 * 双条件不因删题白拿 high），均不拦截（baselineMet 恒 true）。A 路径的
 * 核心价值 = CA 匹配，账号信用由 performRulesValidation 的地址验证+nameMatch
 * 承担（质量门保留：粉≥500+推≥20 等仅作为 abm 分析的准入构成机制，不拦截）。
 * @param {Object} data - fullAccountOrCommunityData
 * @param {Object} [opts] - { ratingLabel='项目币评级'（reason 前缀，web3ip 传 '账号基本面评级'） }
 * @returns {{rating: string, baselineMet: boolean, reason: string}}
 */
export function rateProject(data, opts = {}) {
  const { ratingLabel = '项目币评级' } = opts;
  const isAccount = data.type === 'account';
  const count = isAccount
    ? (data.followers_count || 0)
    : (data.members_count || 0);
  const metric = isAccount ? '粉丝' : '成员';

  // 账号 0-299 mid / ≥300 high；社区恒 mid（P1.12 社区活跃题删除，高档条件随之
  // 退役——原 ≥100∧活跃 high 双条件不因删题白拿 high，收紧方向）。粉丝带只定档
  // 不拦截（P1.10）
  const rating = isAccount
    ? (count >= 300 ? 'high' : 'mid')
    : 'mid';

  return {
    rating,
    baselineMet: true,
    reason: `${ratingLabel}：${metric}${count} → ${rating}（粉丝带只定档不拦截）`,
  };
}

/**
 * prestage answers → 判定结果
 * @param {Object} answers - JevClient 返回的 answers
 * @param {Object} context
 * @param {Object} context.fullAccountOrCommunityData - 账号/社区完整数据
 * @param {boolean} context.addressVerified - 规则验证地址命中结果
 * @param {Object|null} [context.rulesResult] - performRulesValidation 结果
 * @param {string|null} [context.corpusType] - 语料 URL 形状（fetchResults.twitterInfo.type：
 *   'account'/'community'/'tweet'；C101 推文语料 web3ip 不采信，缺省 null=放行）
 * @param {Object} context.callInfo - {model, questions, state, stateStats, usage, startedAt, finishedAt}
 * @returns {Object} { tokenType, rating, reasoning, baselineMet, prestageDataToSave, promptType, jevDetails }
 */
export function mapPrestageAnswers(answers, context) {
  const { fullAccountOrCommunityData, addressVerified, rulesResult, corpusType = null, callInfo } = context;
  const data = fullAccountOrCommunityData;
  const isAccount = data.type === 'account';
  const followers = isAccount ? (data.followers_count || 0) : null;
  const members = !isAccount ? (data.members_count || 0) : null;

  // 完整 prompt 落库：state（语料全文）+ questions（问题集全文），页面回放展示用
  const promptMeta = JSON.stringify({
    engine: 'jev',
    questionsVersion: JEV_PRESTAGE_QUESTIONS_VERSION,
    questionIds: Object.keys(callInfo.questions),
    stateStats: callInfo.stateStats,
    state: callInfo.state,
    questions: callInfo.questions,
  });
  const rawOutput = JSON.stringify({ answers, usage: callInfo.usage });
  const baseFields = {
    model: callInfo.model,
    prompt: promptMeta,
    raw_output: rawOutput,
    started_at: callInfo.startedAt,
    finished_at: callInfo.finishedAt,
    success: true,
    error: null,
  };

  // answers 里的概率（details 概率承载，供校准分析；P1.12 删社区活跃题；P1.14 加官网核验题）
  const jevProbabilities = {
    prestage_token_type: answers.prestage_token_type?.probabilities,
    prestage_abm_name_link: answers.prestage_abm_name_link?.probabilities,
    prestage_abm_web3_traffic: answers.prestage_abm_web3_traffic?.probabilities,
    prestage_website_check: answers.prestage_website_check?.probabilities,
  };

  let tokenType;
  let rating;
  let reasoning;
  let baselineMet = null;
  let pass;
  let details;
  let jevDetails;

  if (!addressVerified) {
    // ── 地址未命中：固定 account_based_meme 判定（V1.0 两条件）──────────
    tokenType = 'account_based_meme';
    const abm = evaluateAbmAnswers(answers, { followers, members });
    rating = abm.rating;
    reasoning = abm.reasoning;
    pass = abm.pass;
    details = abm.details;
    jevDetails = abm.jevDetails;
  } else {
    // ── 地址命中：token_type 二分（V2.0）────────────────────────────────
    tokenType = answers.prestage_token_type?.choice || 'project';

    if (tokenType === 'web3_native_ip_early' && corpusType === 'tweet') {
      // P1.11（C101，2026-10-18 用户裁定「web3_native_ip_early 仅限于账号」「这不是
      // 账号，这就是个推文」）：挂链语料是一条推文时 web3ip 不采信——「币本身即
      // 该账号的 IP」需要账号叙事承载，单条推文不构成（OK❌ 案：找角度推文宣告
      // 的 web3ip 0.96 → mid → 买 -12.75%）。回落 abm 双条件评定（两题恒带已答，
      // 零额外调用），addressVerified=true 事实保留在 parsed_output
      tokenType = 'account_based_meme';
      const abm = evaluateAbmAnswers(answers, { followers, members });
      rating = abm.rating;
      reasoning = `推文语料不采信web3ip（C101：web3_native_ip_early仅限账号语料，回落abm双条件）｜${abm.reasoning}`;
      pass = abm.pass;
      baselineMet = null;
      details = abm.details;
      jevDetails = { ...abm.jevDetails, web3ipRejectedCorpusType: 'tweet' };
    } else if (tokenType === 'web3_native_ip_early') {
      // 按账号基本面定档（2026-09-27 裁定：不再 unrated"等社区成长"——过与不过要有
      // 结论）。P1.10（C70）：账号基本面门全删，粉丝带只定档不拦截
      const rated = rateProject(data, { ratingLabel: '账号基本面评级' });
      rating = rated.rating;
      baselineMet = rated.baselineMet;
      reasoning = `Web3原生IP早期（币本身即IP：新称号/概念或社区meme，账号随币而生/社区后建）→ ${rated.reason}`;
      pass = true;
      details = { followers, members, projectReason: null, ipConcept: null };
      jevDetails = { tokenType, baselineMet: rated.baselineMet };
    } else {
      // project：评级数学全部代码端（V2.0 评级表；P1.10 账号信用门全删，粉丝带只定档；
      // P1.12 社区活跃题删除，社区臂回落恒 mid）
      const rated = rateProject(data);
      tokenType = 'project';
      rating = rated.rating;
      baselineMet = rated.baselineMet;
      pass = true; // 对齐旧 project 分支

      // P1.14/C164 项目币官网核验门（仅 project 分支消费；abm/web3ip 不消费）：
      // pass 臂走原粉丝带；拦臂三选 → low。choice 不在五选项内=答案形状异常 → 同拦
      // （fail-closed，reason 带原值可见）；answer 整体缺失 JevClient 已 throw
      // （→9→C84 无信号），不在此兜底。配置关闭路径=state 无 website_check 行 →
      // Jev 按 instructions 默认 no_website_non_infra → 门惯性放行（关=不拦）
      const wcChoice = answers.prestage_website_check?.choice;
      const wcPass = wcChoice === 'website_substantiates' || wcChoice === 'no_website_non_infra';
      if (!wcPass) {
        rating = 'low';
        reasoning = `项目币官网核验未过（${WEBSITE_GATE_LABELS[wcChoice] || `答案异常:${wcChoice}`}）→ low（C164）｜原粉丝带：${rated.reason}`;
      } else {
        reasoning = `${rated.reason}｜官网核验：${WEBSITE_GATE_LABELS[wcChoice]}`;
      }

      details = {
        followers,
        members,
        projectReason: null, // Jev 无文本生成，判定依据由 jev probabilities 承载
        ipConcept: null,
        websiteCheck: wcChoice, // P1.14：拦截/放行归因键（choice 原值）
        ...(isAccount ? { verified: data.verified || data.is_blue_verified || false } : {}),
      };
      jevDetails = { tokenType, baselineMet: rated.baselineMet, websiteCheck: wcChoice };
    }
  }

  const prestageDataToSave = {
    rating,
    pass,
    category: tokenType,
    ...baseFields,
    parsed_output: {
      tokenType,
      rating,
      reason: reasoning,
      baselineMet,
      details,
      rulesValidationPassed: true,
      addressVerified,
      nameMatch: addressVerified ? (rulesResult?.nameMatch ?? true) : null,
      jev: { probabilities: jevProbabilities },
    },
  };

  const promptType = `prestage-jev(${JEV_PRESTAGE_QUESTIONS_VERSION}/${tokenType})`;

  return {
    tokenType,
    rating,
    reasoning,
    baselineMet,
    prestageDataToSave,
    promptType,
    jevDetails,
  };
}
