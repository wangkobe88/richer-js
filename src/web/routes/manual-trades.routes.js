/**
 * 手工交易命令队列 API（P0-C 实盘前置批，2026-10-13，迁移自 rich-js 精简版）
 *
 * 两端点：
 *   POST /api/experiment/:id/manual-trade  落命令行（status='pending'）
 *   GET  /api/experiment/:id/manual-trades 命令历史（新→旧 50 条）
 *
 * 架构（DDL 注释同源）：web 进程绝不直接建 trader 交易——会与运行中引擎内存账本冲突
 * （手工卖出后引擎仍触发卖腿→链上0→计连败→熔断误伤）。命令由 web 落行，实验进程
 * 5s 轮询 CAS 消费（FourMemeWssTradingEngine._consumeManualTrades）；实验停机期命令
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
 * body: { tokenAddress, direction: 'buy'|'sell', amountBnb?, sellPct? }
 * 买必填 amountBnb；卖 sellPct ∈ (0,1] 缺省 1（全清）。token 必须在本实验
 * experiment_tokens 池内（买的票先被引擎发现过；卖的票必然在池）。
 */
router.post('/experiment/:id/manual-trade', async (req, res) => {
    try {
        const experimentId = req.params.id;
        const { tokenAddress, direction, amountBnb, sellPct } = req.body || {};

        if (!ADDR_RE.test(String(tokenAddress || ''))) {
            return res.status(400).json({ success: false, error: 'tokenAddress 必须是 EVM 地址（0x + 40 hex）' });
        }
        if (direction !== 'buy' && direction !== 'sell') {
            return res.status(400).json({ success: false, error: "direction 必须是 'buy' 或 'sell'" });
        }

        let amountBnbNum = null;
        let sellPctNum = 1;
        if (direction === 'buy') {
            amountBnbNum = Number(amountBnb);
            if (!(amountBnbNum > 0)) {
                return res.status(400).json({ success: false, error: '买入必填 amountBnb（BNB，>0）' });
            }
            if (amountBnbNum > AMOUNT_BNB_HARD_CAP) {
                return res.status(400).json({ success: false, error: `amountBnb 超过硬上限 ${AMOUNT_BNB_HARD_CAP} BNB（手滑防线）` });
            }
        } else if (sellPct !== undefined && sellPct !== null) {
            sellPctNum = Number(sellPct);
            if (!(sellPctNum > 0 && sellPctNum <= 1)) {
                return res.status(400).json({ success: false, error: 'sellPct 必须在 (0, 1]（余仓比例）' });
            }
        }

        const client = dbManager.getClient();
        const { data: exp, error: expErr } = await client
            .from('experiments')
            .select('id, name, trading_mode, status')
            .eq('id', experimentId)
            .single();
        if (expErr || !exp) {
            return res.status(404).json({ success: false, error: '实验不存在' });
        }
        if (exp.trading_mode !== 'live') {
            return res.status(400).json({ success: false, error: `手工交易仅限 live 实验（当前 ${exp.trading_mode}）——virtual/backtest 无实验进程消费者，命令将永久滞留` });
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
            status: 'pending',
        };
        const { data: inserted, error: insErr } = await client
            .from('manual_trade_requests')
            .insert(row)
            .select('id, status, requested_at')
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
            .select('id, token_address, direction, amount_bnb, sell_pct, status, requested_by, requested_at, executed_at, result, error')
            .eq('experiment_id', req.params.id)
            .order('requested_at', { ascending: false })
            .limit(50);
        if (error) throw error;
        res.json({ success: true, data: data || [] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
