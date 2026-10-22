/**
 * 手工交易命令队列 API（P0-C 实盘前置批，2026-10-13，迁移自 rich-js 精简版；
 * 2026-10-22 双支持批：live/virtual 均放行 + cards 按卡命令 + 停止卖出锁）
 *
 * 三端点：
 *   POST /api/experiment/:id/manual-trade    落命令行（status='pending'）
 *   GET  /api/experiment/:id/manual-trades   命令历史（新→旧 50 条）
 *   PUT  /api/experiment/:id/manual-sell-lock 停止卖出/恢复卖出（per-token 锁）
 *
 * 架构（DDL 注释同源）：web 进程绝不直接建 trader 交易——会与运行中引擎内存账本冲突
 * （手工卖出后引擎仍触发卖腿→链上0→计连败→熔断误伤）。命令由 web 落行，实验进程
 * 2s 轮询 CAS 消费（FourMemeWssTradingEngine._consumeManualTrades）；实验停机期命令
 * 滞留 pending（不执行不丢，>10min 被消费端置 expired）。
 *
 * ⚠️ manual_trade_requests 表 RLS service_role-only——全部 dbManager.getClient()（红线③）。
 */

const express = require('express');
const router = express.Router();

const { dbManager } = require('../../services/dbManager');

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const AMOUNT_BNB_HARD_CAP = 100; // 手滑防线：单笔手工买 ≤100 BNB（引擎侧还有链上余额门）

/**
 * POST /api/experiment/:id/manual-trade
 * body: { tokenAddress, direction: 'buy'|'sell', amountBnb?, sellPct?, cards? }
 * 买需 amountBnb/cards 二选一；卖需 sellPct/cards 二选一（两者都不给=缺省全清 1）。
 * cards（2026-10-22 双支持批）：按卡交易——buy=perCardBNB×N 计价记卡，sell=卖 N 张
 * （引擎钳制 ≤ 余卡）。cards 命令的另一参数列刻意落 NULL（语义载体分离）。
 * live/virtual 均放行；backtest 拒绝。token 必须在本实验 experiment_tokens 池内
 * （买的票先被引擎发现过；卖的票必然在池）。
 */
const CARDS_HARD_CAP = 1000; // 手滑防线：单命令卡数上限（UI 恒发 1，引擎按通用 N 设计）

router.post('/experiment/:id/manual-trade', async (req, res) => {
    try {
        const experimentId = req.params.id;
        const { tokenAddress, direction, amountBnb, sellPct, cards } = req.body || {};

        if (!ADDR_RE.test(String(tokenAddress || ''))) {
            return res.status(400).json({ success: false, error: 'tokenAddress 必须是 EVM 地址（0x + 40 hex）' });
        }
        if (direction !== 'buy' && direction !== 'sell') {
            return res.status(400).json({ success: false, error: "direction 必须是 'buy' 或 'sell'" });
        }

        let cardsNum = null;
        if (cards !== undefined && cards !== null) {
            if (!Number.isInteger(cards) || cards < 1 || cards > CARDS_HARD_CAP) {
                return res.status(400).json({ success: false, error: `cards 必须是 [1, ${CARDS_HARD_CAP}] 整数（按卡张数）` });
            }
            cardsNum = cards;
        }

        let amountBnbNum = null;
        let sellPctNum = 1;
        if (direction === 'buy') {
            if (cardsNum != null && amountBnb != null) {
                return res.status(400).json({ success: false, error: '买入 amountBnb 与 cards 二选一（cards=按卡计价，amountBnb=显式金额）' });
            }
            if (cardsNum == null) {
                amountBnbNum = Number(amountBnb);
                if (!(amountBnbNum > 0)) {
                    return res.status(400).json({ success: false, error: '买入必填 amountBnb 或 cards（BNB 金额 >0 或按卡张数）' });
                }
                if (amountBnbNum > AMOUNT_BNB_HARD_CAP) {
                    return res.status(400).json({ success: false, error: `amountBnb 超过硬上限 ${AMOUNT_BNB_HARD_CAP} BNB（手滑防线）` });
                }
            }
        } else if (cardsNum != null && sellPct !== undefined && sellPct !== null) {
            return res.status(400).json({ success: false, error: '卖出 sellPct 与 cards 二选一（cards=按卡张数，sellPct=余仓比例）' });
        } else if (sellPct !== undefined && sellPct !== null) {
            sellPctNum = Number(sellPct);
            if (!(sellPctNum > 0 && sellPctNum <= 1)) {
                return res.status(400).json({ success: false, error: 'sellPct 必须在 (0, 1]（余仓比例）' });
            }
        }
        // cards 命令：语义载体分离——另一参数列落 NULL（cards 买 amount_bnb=NULL / cards 卖 sell_pct=NULL）
        if (cardsNum != null) {
            if (direction === 'buy') amountBnbNum = null;
            else sellPctNum = null;
        }

        const client = dbManager.getClient();
        // ⚠️ 列名=experiment_name（experiments 表无 name 列——2026-10-22 事故：
        // 写 'name' PGRST204 → 误报「实验不存在」POST 全挂；单测反证断言见 _test_manual_trade_queue T11.10）
        const { data: exp, error: expErr } = await client
            .from('experiments')
            .select('id, experiment_name, trading_mode, status')
            .eq('id', experimentId)
            .single();
        if (expErr || !exp) {
            return res.status(404).json({ success: false, error: '实验不存在' });
        }
        if (exp.trading_mode === 'backtest') {
            // 2026-10-22 双支持批：virtual 放开（实验进程同消费队列，虚拟记账执行）；
            // backtest 无常驻进程，命令将永久滞留，保持拒绝
            return res.status(400).json({ success: false, error: `手工交易不支持 backtest 实验（当前 ${exp.trading_mode}）——无实验进程消费者，命令将永久滞留` });
        }

        // token 归属校验：不在本实验池内的票拒绝（引擎侧消费还有 FA 价格/持仓双门）
        const { count: tokenCount, error: tokErr } = await client
            .from('experiment_tokens')
            .select('id', { count: 'exact', head: true })
            .eq('experiment_id', experimentId)
            .eq('token_address', tokenAddress);
        if (tokErr) throw tokErr;
        if (!tokenCount) {
            return res.status(400).json({ success: false, error: 'token 不在本实验代币池（引擎未发现过该票），拒绝落命令' });
        }

        const row = {
            experiment_id: experimentId,
            token_address: tokenAddress,
            direction,
            amount_bnb: direction === 'buy' ? amountBnbNum : null,
            sell_pct: direction === 'sell' ? sellPctNum : null,
            cards: cardsNum,
            status: 'pending',
        };
        const { data: inserted, error: insErr } = await client
            .from('manual_trade_requests')
            .insert(row)
            .select('id, status, requested_at, cards')
            .single();
        if (insErr) throw insErr;

        res.status(201).json({
            success: true,
            data: inserted,
            // 停机提示：命令会滞留 pending 直到实验进程启动并消费（DDL 设计语义）
            warning: exp.status === 'running' ? null
                : `实验当前状态 ${exp.status}（非 running）：命令将滞留 pending，实验启动后 10min 内消费或过期`,
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/experiment/:id/manual-trades
 * 命令历史（新→旧 50 条；页面轮询用）
 */
router.get('/experiment/:id/manual-trades', async (req, res) => {
    try {
        const { data, error } = await dbManager.getClient()
            .from('manual_trade_requests')
            .select('id, token_address, direction, amount_bnb, sell_pct, cards, status, requested_by, requested_at, executed_at, result, error')
            .eq('experiment_id', req.params.id)
            .order('requested_at', { ascending: false })
            .limit(50);
        if (error) throw error;
        res.json({ success: true, data: data || [] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PUT /api/experiment/:id/manual-sell-lock（2026-10-22 双支持批）
 * body: { tokenAddress, locked: boolean }
 * per-token 停止卖出锁：locked=true 拦引擎一切自动卖出（策略卖腿/止损/毕业卖；手动
 * 队列卖出不受限），false 恢复。引擎 2s 轮询刷新内存镜像生效。锁不自动解除（全清/加仓
 * 后残留无害，UI 🔒 徽章 + 恢复按钮保证可感知）。⚠️ experiment_tokens 写入同样
 * service key（红线③）。
 */
router.put('/experiment/:id/manual-sell-lock', async (req, res) => {
    try {
        const experimentId = req.params.id;
        const { tokenAddress, locked } = req.body || {};

        if (!ADDR_RE.test(String(tokenAddress || ''))) {
            return res.status(400).json({ success: false, error: 'tokenAddress 必须是 EVM 地址（0x + 40 hex）' });
        }
        if (typeof locked !== 'boolean') {
            return res.status(400).json({ success: false, error: 'locked 必须是 boolean（true=停止卖出 / false=恢复卖出）' });
        }

        const client = dbManager.getClient();
        const { count: tokenCount, error: tokErr } = await client
            .from('experiment_tokens')
            .select('id', { count: 'exact', head: true })
            .eq('experiment_id', experimentId)
            .eq('token_address', tokenAddress);
        if (tokErr) throw tokErr;
        if (!tokenCount) {
            return res.status(400).json({ success: false, error: 'token 不在本实验代币池，拒绝写锁' });
        }

        const { data: updated, error: upErr } = await client
            .from('experiment_tokens')
            .update({ manual_sell_locked: locked })
            .eq('experiment_id', experimentId)
            .eq('token_address', tokenAddress)
            .select('token_address, manual_sell_locked')
            .single();
        if (upErr) throw upErr;

        res.json({ success: true, data: updated });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
