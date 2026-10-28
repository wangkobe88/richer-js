#!/usr/bin/env node

/**
 * GangBawTrader 单测（零 DB 零网络，2026-10-28 gang live 通道）
 *
 * 打桩 _runCli（不真 spawn CLI）/ _erc20 balanceOf / provider 回执三件，注入
 * docs/gang-cli-shapes.md 黄金 JSON 形状，锁死：
 *   A. CLI 黄金形状解析：setWallet 对拍（匹配/不匹配）/ _num 千分位逗号 strip
 *   B. V2 买分步循环：pad 探测缓存 → wrap-bnb → approve-quote → buy(execute
 *      BROADCASTED) → 实收=token balanceOf 差（千分位 expectTokens 解析）
 *   C. V2 1% 帽 preflightReject（expectRefund≠0 拒单，引擎侧不计买入熔断）
 *   D. L1 预成交校验（expectTokens < 期望×0.5 拒）
 *   E. V3 票分流：pad 探测错误指路 v3 → gang v3 buy --amount（无分步无 refund 臂）
 *   F. requestId 过期重试恰一次（expired→重跑 preview；二次 expired 上抛）
 *   G. 防双买反证（核心红线）：execute 进程层失败=状态未知 → unresolved 登记
 *      （错误含 requestId）+ 同 token 后续买/卖直接拒绝；回执超时同款；
 *      reverted=终态确定清 unresolved（后续可安全重试）
 *   H. 卖侧半自动通道：PENDING_CONFIRMATION → 告警 → tx-history 轮询 confirmed
 *      → WNB 余额差实收（卖出到账 WNB 非 native BNB）；确认超时 fail-closed
 *      （告警「勿再确认」防迟到确认双卖）
 *   I. 351802/351803 全局 fatal 告警分类 + 1h 去重
 *   J. 单飞行队列：并发买卖串行无交错
 *
 * 用法：node scripts/_test_gang_baw_trader.cjs
 */
'use strict';

const assert = require('assert');

let passed = 0, failed = 0;
function ok(name, cond, detail = '') {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}${detail ? ` | ${detail}` : ''}`); }
}

const ADDR = '0xfc84d51c15acbddcc5381fdd389cb9c99dce4abd';
const TOKEN = '0x1111111111111111111111111111111111111111';
const TOKEN2 = '0x2222222222222222222222222222222222222222';
const TX1 = '0xabc1111111111111111111111111111111111111111111111111111111111111';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

/** 构造打桩 trader：handlers = [(bin,args)=>out|throw] 按序消费（记录全部调用） */
function makeTrader(cliScript, { approvalTimeoutMs = 80, approvalPollMs = 5 } = {}) {
    const GangBawTrader = require('../src/trading-engine/traders/implementations/GangBawTrader');
    const t = new GangBawTrader({
        address: ADDR,
        gangCli: { approvalTimeoutMs, approvalPollMs, spawnTimeoutMs: 5000 },
        network: { name: 'BSC', chainId: 56, rpcUrl: 'http://127.0.0.1:1/' },
    });
    t.setLogger(silentLogger, 'test-exp');
    t.calls = [];
    t.alerts = [];
    let idx = 0;
    t._runCli = async (bin, args) => {
        const key = `${bin} ${args.join(' ')}`;
        t.calls.push(key);
        const fn = cliScript[idx++];
        if (!fn) throw new Error(`未预期的第 ${idx} 次 CLI 调用: ${key}`);
        const out = typeof fn === 'function' ? fn(bin, args) : fn;
        if (out instanceof Error) throw out;
        return out;
    };
    t.setAlertHook((title, body) => t.alerts.push({ title, body }));
    t.wallet = { address: ADDR }; // setWallet 本体在 A 用例单测；其余用例直接预置（打桩环境不重复对拍）
    return t;
}

/** ERC20 balanceOf 打桩：balances = Map('token:addr'|'wbnb:addr' → bigint)，差值可精确断言 */
function stubBalances(t, init) {
    const state = new Map(init || []);
    t._erc20 = (addr) => ({ balanceOf: async (who) => state.get(`${addr}:${who}`) || 0n });
    return state;
}

/** provider 打桩（回执三件） */
function stubProvider(t, { receipt = { status: 1, gasUsed: 21000n, gasPrice: 1000000000n } } = {}) {
    t.provider = {
        getTransactionReceipt: async () => receipt,
        waitForTransaction: async () => receipt,
        getBalance: async () => 0n,
    };
}

async function setWalletOk(t) {
    await t.setWallet(undefined);
    return t.wallet;
}// 便利构造（黄金形状，见 docs/gang-cli-shapes.md）
const padProbeV2 = { success: true, step: 'buy', requestId: 'req_pad', expectTokens: '1000000', expectRefund: 0 };
const broadcast = { success: true, status: 'BROADCASTED', txHash: TX1 };

async function main() {
    const ethers = require('ethers');
    const AMT = ethers.parseEther('0.002');

    // ═══ A. CLI 黄金形状解析 ═══
    console.log('\n━━━ A. setWallet 对拍 / _num 千分位 ━━━');
    {
        const t = makeTrader([
            { address: ADDR }, // baw wallet address
        ]);
        const w = await setWalletOk(t);
        ok('setWallet(undefined) 对拍成功 wallet={address}（BAW 无私钥可设）',
            w && w.address === ADDR);
        ok('setWallet 调用序列=baw wallet address（对拍链上会话身份）',
            t.calls[0].startsWith('baw wallet address'));
    }
    {
        const t = makeTrader([{ address: '0x9999999999999999999999999999999999999999' }]);
        let msg = null;
        try { await t.setWallet(undefined); } catch (e) { msg = e.message; }
        ok('地址不匹配 throw fail-fast（本机 baw 会话属别的钱包）', /不匹配/.test(msg || ''), `实得 ${msg}`);
    }
    {
        // 182 实测黄金形状（2026-10-28）：data.addresses[] 多链列表，BSC 行
        // binanceChainId='56'——Step 0 档案漏记，实测形状补录（docs/gang-cli-shapes.md）
        const t = makeTrader([{
            success: true,
            data: { addresses: [
                { binanceChainId: '56', chainName: 'BSC', address: ADDR.toUpperCase() },
                { binanceChainId: '1', chainName: 'Ethereum', address: '0x1111111111111111111111111111111111111111' },
                { chainName: 'Solana', address: 'sol9Wm' },
            ] },
        }]);
        const w = await setWalletOk(t);
        ok('多链列表形状（182 实测黄金形状）：取 BSC 行（binanceChainId=56）大小写归一',
            w && w.address === ADDR);
    }
    {
        const t = makeTrader([{
            success: true,
            data: { addresses: [
                { binanceChainId: '1', chainName: 'Ethereum', address: ADDR },
            ] },
        }]);
        let msg = null;
        try { await t.setWallet(undefined); } catch (e) { msg = e.message; }
        ok('多链列表无 BSC 行 throw fail-fast（不兜底取首行——网络形状变了大声暴露）',
            /无 BSC 地址行/.test(msg || ''), `实得 ${msg}`);
    }
    {
        const t = makeTrader([]);
        ok('_num 千分位逗号 strip："1,890,146.27"→1890146.27',
            t._num('1,890,146.27') === 1890146.27);
        ok('_num 纯数字串兼容', t._num('5000000') === 5000000);
    }
    {
        // getNativeBalance 契约=BaseTrader.getBNBBalance（BNB 域字符串）——2026-10-28
        // 首跑事故反证：返 wei bigint 会让 cashBalance×1e18（portfolio_snapshots
        // numeric 溢出+买入现金门形同虚设），锁死 formatEther 域
        const t = makeTrader([]);
        stubProvider(t);
        t.provider.getBalance = async () => 742911873799331429n;
        const bal = await t.getNativeBalance();
        ok('getNativeBalance 返 BNB 域字符串（wei→formatEther，不返 bigint）',
            typeof bal === 'string' && bal === '0.742911873799331429', `实得 ${bal}`);
    }

    // ═══ B. V2 买分步循环 + 实收余额差 ═══
    console.log('\n━━━ B. V2 买分步循环（wrap→approve→buy→execute）━━━');
    {
        const t = makeTrader([
            padProbeV2,                                   // 1. pad 探测（buy --bnb 0.001 试探）→ success=v2
            { success: true, step: 'wrap-bnb', requestId: 'req_wrap' },
            broadcast,                                    //   execute wrap
            { success: true, step: 'approve-quote', requestId: 'req_appr' },
            broadcast,                                    //   execute approve
            { success: true, step: 'buy', requestId: 'req_buy', expectTokens: '1,890,146.27', expectRefund: 0 },
            () => {                                       //   execute buy：成交后 token 余额到账（余额差法实收源）
                state.set(`${TOKEN}:${ADDR}`,
                    (state.get(`${TOKEN}:${ADDR}`) || 0n) + ethers.parseUnits('1890146.27', 18));
                return broadcast;
            },
        ]);
        const state = stubBalances(t, [[`${TOKEN}:${ADDR}`, 1000000n]]);
        stubProvider(t);
        const res = await t.buyToken(TOKEN, AMT, { expectedTokenOut: 1800000 });
        ok('买成功（success=true）', res.success === true, JSON.stringify(res));
        ok('实收=token balanceOf 前后差（1,890,146.27 枚，千分位 preview 解析+wei 精确差）',
            res.actualAmountOut === 1890146.27, `实得 ${res.actualAmountOut}`);
        ok('protocol 标注 gang v2 Launchpad (BAW CLI)', /gang v2 Launchpad/.test(res.protocol || ''));
        ok('method=gang buy', res.method === 'gang buy');
        ok('pad 探测恰一次后缓存（第二轮 preview 不再试探）',
            t.calls.filter(c => c.includes('0.001')).length === 1);
        ok('分步序列：wrap-bnb→approve-quote 每步 execute 后重跑同命令',
            t.calls.some(c => c.includes('execute --request-id req_wrap')) &&
            t.calls.some(c => c.includes('execute --request-id req_appr')));
        ok('买执行步 V2 --bnb 金额串（无千分位）',
            t.calls.some(c => c.includes(`buy --token ${TOKEN} --bnb 0.002 --json`)));
        ok('成功后 unresolved 清空', !t._unresolved.has(TOKEN));
    }

    // ═══ C. V2 1% 帽 preflightReject ═══
    console.log('\n━━━ C. V2 1% 帽退款拒单 ━━━');
    {
        const t = makeTrader([
            { success: true, step: 'buy', requestId: 'r0', expectTokens: '1', expectRefund: 0 }, // pad 探测
            { success: true, step: 'buy', requestId: 'r1', expectTokens: '9000000', expectRefund: 0.0002 },
        ]);
        stubBalances(t, [[`${TOKEN2}:${ADDR}`, 0n]]);
        stubProvider(t);
        const res = await t.buyToken(TOKEN2, AMT, { expectedTokenOut: 10000000 });
        ok('expectRefund≠0 → success=false + preflightReject=true（引擎侧不计买入熔断）',
            res.success === false && res.preflightReject === true, JSON.stringify(res));
        ok('拒单文案含退款额（配额帽形状）', /退款/.test(res.error || ''));
    }

    // ═══ D. L1 预成交校验 ═══
    console.log('\n━━━ D. L1 校验（expectTokens < 期望×0.5）━━━');
    {
        const t = makeTrader([
            padProbeV2,
            { success: true, step: 'buy', requestId: 'r', expectTokens: '400000', expectRefund: 0 },
        ]);
        stubBalances(t);
        stubProvider(t);
        const res = await t.buyToken(TOKEN, AMT, { expectedTokenOut: 1000000 });
        ok('expectTokens 40 万 < 期望 100 万×0.5 → L1 拒',
            res.success === false && /L1 校验拒绝/.test(res.error || ''), JSON.stringify(res));
        ok('L1 拒不是 preflightReject（非帽形状）', !res.preflightReject);
    }

    // ═══ E. V3 票分流 ═══
    console.log('\n━━━ E. V3 票分流（gang v3 buy --amount）━━━');
    {
        const t = makeTrader([
            { success: false, error: 'token is on V3, use `gang v3 buy`' }, // pad 探测指路 v3
            { success: true, step: 'v3-buy', requestId: 'req_v3', expectTokens: '5000000' },
            () => {
                state.set(`${TOKEN}:${ADDR}`,
                    (state.get(`${TOKEN}:${ADDR}`) || 0n) + ethers.parseUnits('5000000', 18));
                return broadcast;
            },
        ]);
        const state = stubBalances(t, [[`${TOKEN}:${ADDR}`, 0n]]);
        stubProvider(t);
        const res = await t.buyToken(TOKEN, AMT, { expectedTokenOut: 4800000 });
        ok('V3 买成功', res.success === true, JSON.stringify(res));
        ok('method=gang v3 buy', res.method === 'gang v3 buy');
        ok('V3 命令=gang v3 buy --amount 0.002（直付无分步）',
            t.calls.some(c => c.startsWith('gang v3 buy') && c.includes('--amount 0.002')));
        ok('V3 实收余额差', res.actualAmountOut === 5000000, `实得 ${res.actualAmountOut}`);
        ok('pad 缓存 v3', t._padCache.get(TOKEN) === 'v3');
    }

    // ═══ F. requestId 过期重试恰一次 ═══
    console.log('\n━━━ F. expired 重试恰一次 ═══');
    {
        const t = makeTrader([
            padProbeV2,                                   // pad
            { success: true, step: 'buy', requestId: 'req_1', expectTokens: '1000000', expectRefund: 0 },
            { success: false, error: 'request expired (expired-preview)' }, // execute 过期
            { success: true, step: 'buy', requestId: 'req_2', expectTokens: '1000000', expectRefund: 0 },
            broadcast,
        ]);
        stubBalances(t, [[`${TOKEN}:${ADDR}`, 0n]]);
        stubProvider(t);
        const res = await t.buyToken(TOKEN, AMT, { expectedTokenOut: 900000 });
        ok('expired → 重跑 preview 恰一次后成功', res.success === true, JSON.stringify(res));
        ok('重试后用新 requestId（req_2）', t.calls.some(c => c.includes('--request-id req_2')));
    }
    {
        // 二次 expired：上抛不无限重试
        const t = makeTrader([
            padProbeV2,
            { success: true, step: 'buy', requestId: 'req_1', expectTokens: '1000000', expectRefund: 0 },
            { success: false, error: 'request expired' },
            { success: true, step: 'buy', requestId: 'req_2', expectTokens: '1000000', expectRefund: 0 },
            { success: false, error: 'request expired again' },
        ]);
        stubBalances(t);
        stubProvider(t);
        let threw = false;
        try { await t.buyToken(TOKEN, AMT, {}); } catch (e) { threw = /expired/.test(e.message); }
        ok('二次 expired 上抛（重试限恰一次，不无限）', threw);
    }

    // ═══ G. 防双买反证（核心红线）═══
    console.log('\n━━━ G. 防双买/双卖状态机 ═══');
    {
        // G1 execute 进程层失败=状态未知 → unresolved + 后续拒绝
        const t = makeTrader([
            padProbeV2,
            { success: true, step: 'buy', requestId: 'req_x', expectTokens: '1000000', expectRefund: 0 },
            new Error('CLI 崩溃: spawn ENOTFOUND'),      // execute 进程层 throw
        ]);
        stubBalances(t);
        stubProvider(t);
        let msg = null;
        try { await t.buyToken(TOKEN, AMT, {}); } catch (e) { msg = e.message; }
        ok('execute 进程层失败 throw 含 requestId（人工核查锚点）', /req_x/.test(msg || ''), `实得 ${msg}`);
        ok('unresolved 已登记（防重发锁）', t._unresolved.has(TOKEN));
        ok('防双发告警已发（Telegram 钩子）', t.alerts.some(a => /状态未定/.test(a.title)));
        let msg2 = null;
        try { await t.buyToken(TOKEN, AMT, {}); } catch (e) { msg2 = e.message; }
        ok('同 token 后续买直接拒绝（绝不自动重入）', /拒绝执行/.test(msg2 || ''), `实得 ${msg2}`);
        let msg3 = null;
        try { await t.sellToken(TOKEN, 1000000n, {}); } catch (e) { msg3 = e.message; }
        ok('同 token 后续卖也拒绝', /拒绝执行/.test(msg3 || ''), `实得 ${msg3}`);
        // spawn 序列反证：首次买后不再有任何 preview/execute（上面两次调用都在 _assertNoUnresolved 拒）
        const previewCount = t.calls.filter(c => c.includes('--token')).length;
        ok('拒绝后零新 CLI 调用（序列反证：无第二次 preview）', previewCount === 2, `calls=${t.calls.length}`);
    }
    {
        // G2 BROADCASTED 后回执超时 → unresolved（tx 已广播绝不重发）
        const t = makeTrader([
            padProbeV2,
            { success: true, step: 'buy', requestId: 'req_y', expectTokens: '1000000', expectRefund: 0 },
            broadcast,
        ]);
        stubBalances(t);
        t.provider = {
            getTransactionReceipt: async () => null,     // 回查也无
            waitForTransaction: async () => { throw new Error('timeout'); },
        };
        t.txWaitTimeoutMs = 30;
        let msg = null;
        try { await t.buyToken(TOKEN, AMT, {}); } catch (e) { msg = e.message; }
        ok('回执超时 throw 含 txHash + 防重发表述', /txHash=0xabc/.test(msg || '') && /绝不自动重发/.test(msg || ''), `实得 ${msg}`);
        ok('回执超时也登记 unresolved', t._unresolved.has(TOKEN));
    }
    {
        // G3 reverted=终态确定 → 清 unresolved（重试安全）
        const t = makeTrader([
            padProbeV2,
            { success: true, step: 'buy', requestId: 'req_z', expectTokens: '1000000', expectRefund: 0 },
            broadcast,
        ]);
        stubBalances(t);
        stubProvider(t, { receipt: { status: 0, gasUsed: 21000n, gasPrice: 1000000000n } });
        let msg = null;
        try { await t.buyToken(TOKEN, AMT, {}); } catch (e) { msg = e.message; }
        ok('reverted throw（资金未动）', /reverted/.test(msg || ''), `实得 ${msg}`);
        ok('reverted 清 unresolved（后续重试安全）', !t._unresolved.has(TOKEN));
    }

    // ═══ H. 卖侧半自动通道 ═══
    console.log('\n━━━ H. 卖 PENDING_CONFIRMATION → tx-history 轮询 → WNB 实收 ━━━');
    {
        const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
        const t = makeTrader([
            padProbeV2,
            { success: true, step: 'approve', requestId: 'req_ap' },  // 卖先 approve 分步
            broadcast,
            { success: true, requestId: 'req_sell', expectOut: '0.00195' }, // 卖 preview（无 step=直达）
            { success: true, status: 'PENDING_CONFIRMATION', orderId: 'ord_9' }, // execute 须 App 确认
            () => { // 第一轮轮询命中：confirmed 同时 WNB 到账（余额差法实收源）
                state.set(`${WBNB}:${ADDR}`, (state.get(`${WBNB}:${ADDR}`) || 0n) + ethers.parseEther('0.002'));
                return { data: { transactions: [{ status: 'confirmed', txHash: TX1,
                    confirmedAt: new Date().toISOString(),
                    instructions: { receive: [{ address: TOKEN }] } }] } };
            },
        ]);
        const state = stubBalances(t, [[`${WBNB}:${ADDR}`, ethers.parseEther('0.001')]]);
        stubProvider(t);
        const res = await t.sellToken(TOKEN, 1000000n, { expectedNativeOut: 0.0019 });
        ok('卖出成功（App 确认后）', res.success === true, JSON.stringify(res));
        ok('实收=WNB 余额差（卖出到账 WBNB 非 native BNB）',
            res.actualReceived === 0.002, `实得 ${res.actualReceived}`);
        ok('App 确认告警已发（人在环提醒）', t.alerts.some(a => /待 App 确认/.test(a.title) && /ord_9/.test(a.body)));
        ok('tx-history 轮询走 baw CLI（type=confirmed）',
            t.calls.some(c => c.includes('baw wallet tx-history') && c.includes('--type confirmed')));
        ok('卖 preview approve 分步先走', t.calls.some(c => c.includes('--request-id req_ap')));
        void state;
    }
    {
        // H2 确认超时 fail-closed（approvalTimeoutMs=80/pollMs=5 → ≤16 轮，20 个空响应足够）
        const t = makeTrader([
            padProbeV2,
            { success: true, requestId: 'req_sell', expectOut: '0.001' },
            { success: true, status: 'PENDING_CONFIRMATION', orderId: 'ord_t' },
            ...Array.from({ length: 20 }, () => ({ data: { transactions: [] } })),
        ]);
        stubBalances(t);
        stubProvider(t);
        let msg = null;
        try { await t.sellToken(TOKEN, 1000000n, {}); } catch (e) { msg = e.message; }
        ok('确认超时 throw（fail-closed）', /App 确认超时/.test(msg || ''), `实得 ${msg}`);
        ok('超时告警「勿再确认」防迟到确认双卖',
            t.alerts.some(a => /确认超时/.test(a.title) && /勿再确认/.test(a.body)));
    }

    // ═══ I. 351802/351803 fatal 告警分类 ═══
    console.log('\n━━━ I. 全局风控 fatal 告警 + 去重 ━━━');
    {
        const err = { success: false, error: 'code 351802: developer mode expired' };
        const t = makeTrader([padProbeV2, err, padProbeV2, err]);
        stubBalances(t);
        stubProvider(t);
        await t.buyToken(TOKEN, AMT, {});
        await t.buyToken(TOKEN, AMT, {});
        const devAlerts = t.alerts.filter(a => /351802/.test(a.title));
        ok('351802 触发 devMode 过期告警', devAlerts.length >= 1 && /Developer Mode/.test(devAlerts[0].body));
        ok('同码 1h 去重（两连败只告警一次）', devAlerts.length === 1, `实得 ${devAlerts.length}`);
    }
    {
        const t = makeTrader([padProbeV2, { success: false, error: 'code 351803: trade all tokens not enabled' }]);
        stubBalances(t);
        stubProvider(t);
        await t.buyToken(TOKEN, AMT, {});
        ok('351803 触发 Trade all tokens 告警',
            t.alerts.some(a => /351803/.test(a.title) && /Trade all tokens/.test(a.body)));
    }

    // ═══ J. 单飞行队列串行 ═══
    console.log('\n━━━ J. 单飞行队列（BAW 外部状态机保守串行）━━━');
    {
        const t = makeTrader([
            padProbeV2,                                    // TOKEN pad 探测
            { success: true, step: 'buy', requestId: 'req_a', expectTokens: '1000000', expectRefund: 0 },
            broadcast,
            { success: true, step: 'buy', requestId: 'req_pad', expectTokens: '1', expectRefund: 0 }, // TOKEN2 pad 探测
            { success: true, step: 'buy', requestId: 'req_b', expectTokens: '1000000', expectRefund: 0 },
            broadcast,
        ]);
        stubBalances(t);
        stubProvider(t);
        const p1 = t.buyToken(TOKEN, AMT, {});
        const p2 = t.buyToken(TOKEN2, AMT, {});
        const [r1, r2] = await Promise.all([p1, p2]);
        ok('并发两单都完成', r1.success && r2.success, JSON.stringify([r1, r2]));
        // 串行反证：TOKEN1 的全部调用（含 execute）在 TOKEN2 首个调用之前完成
        const lastT1 = t.calls.map(c => c.includes(TOKEN)).lastIndexOf(true);
        const firstT2 = t.calls.map(c => c.includes(TOKEN2)).indexOf(true);
        ok('两单 CLI 调用零交错（单飞行队列串行）', lastT1 < firstT2,
            `T1 末位 ${lastT1} vs T2 首位 ${firstT2}`);
    }

    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
