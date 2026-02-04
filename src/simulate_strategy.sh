#!/bin/bash

DB_PATH="/Users/nobody1/Desktop/Codes/richer-js/trading.db"
EXP_ID="db041ca0-dd20-434f-a49d-142aa0cf3826"

echo "🔍 从数据库模拟真实交易收益"
echo ""
echo "📋 策略配置:"
echo "  初始资金: 100 BNB"
echo "  买入条件: age < 5 AND 50% <= earlyReturn < 150%"
echo "  每次买入: 4 卡 × 0.25 BNB = 1 BNB"
echo ""

# 获取所有有时序数据的代币数量
TOTAL_TOKENS=$(sqlite3 "$DB_PATH" "SELECT COUNT(DISTINCT token_address) FROM experiment_time_series_data WHERE experiment_id = '$EXP_ID';")
echo "📊 总代币数(有时序数据): $TOTAL_TOKENS"
echo ""

# 找出满足条件的代币并计算收益
# 这个SQL比较复杂，我们需要用子查询来找每个代币在age<5窗口内是否有满足条件的点

sqlite3 "$DB_PATH" << 'EOF'
.mode column
.headers on
.width 15 10 10 10 10 10 10

SELECT
    symbol,
    buy_return,
    buy_age,
    final_return,
    investment,
    final_value,
    profit
FROM (
    SELECT
        t.token_symbol as symbol,
        trigger_data.early_return as buy_return,
        trigger_data.age as buy_age,
        ROUND(((final_data.current_price - trigger_data.current_price) / trigger_data.current_price * 100), 2) as final_return,
        1.0 as investment,
        ROUND((1.0 / trigger_data.current_price * final_data.current_price), 4) as final_value,
        ROUND((1.0 / trigger_data.current_price * final_data.current_price - 1.0), 4) as profit
    FROM (
        -- 找出满足条件的代币和触发点
        SELECT DISTINCT
            ts1.token_address,
            ts1.token_symbol,
            json_extract(ts1.factor_values, '$.earlyReturn') as early_return,
            json_extract(ts1.factor_values, '$.age') as age,
            json_extract(ts1.factor_values, '$.currentPrice') as current_price,
            ts1.loop_count
        FROM experiment_time_series_data ts1
        WHERE ts1.experiment_id = 'db041ca0-dd20-434f-a49d-142aa0cf3826'
          AND json_extract(ts1.factor_values, '$.age') < 5
          AND json_extract(ts1.factor_values, '$.earlyReturn') >= 50
          AND json_extract(ts1.factor_values, '$.earlyReturn') < 150
          AND json_extract(ts1.factor_values, '$.currentPrice') > 0
        ORDER BY ts1.token_address, ts1.loop_count
    ) trigger_data
    JOIN (
        -- 获取每个代币的最后价格
        SELECT
            token_address,
            json_extract(factor_values, '$.currentPrice') as current_price
        FROM experiment_time_series_data
        WHERE experiment_id = 'db041ca0-dd20-434f-a49d-142aa0cf3826'
          AND json_extract(factor_values, '$.currentPrice') > 0
        ORDER BY token_address, loop_count DESC
    ) final_data ON trigger_data.token_address = final_data.token_address
    GROUP BY trigger_data.token_address
    HAVING MIN(final_data.current_price) > 0
) results
ORDER BY profit DESC;

SELECT
    COUNT(*) as total_trades,
    SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END) as profitable,
    SUM(CASE WHEN profit <= 0 THEN 1 ELSE 0 END) as loss,
    ROUND(SUM(profit), 2) as total_profit,
    ROUND(100 + SUM(profit), 2) as final_balance,
    ROUND(SUM(profit), 2) as roi_percent
FROM (
    -- 同样的查询，但用于统计
    SELECT
        t.token_symbol as symbol,
        ROUND((1.0 / json_extract(ts1.factor_values, '$.currentPrice') * (
            SELECT json_extract(factor_values, '$.currentPrice')
            FROM experiment_time_series_data
            WHERE experiment_id = 'db041ca0-dd20-434f-a49d-142aa0cf3826'
              AND token_address = ts1.token_address
              AND json_extract(factor_values, '$.currentPrice') > 0
            ORDER BY loop_count DESC LIMIT 1
        ) - 1.0), 4) as profit
    FROM experiment_time_series_data ts1
    WHERE ts1.experiment_id = 'db041ca0-dd20-434f-a49d-142aa0cf3826'
      AND json_extract(ts1.factor_values, '$.age') < 5
      AND json_extract(ts1.factor_values, '$.earlyReturn') >= 50
      AND json_extract(ts1.factor_values, '$.earlyReturn') < 150
      AND json_extract(ts1.factor_values, '$.currentPrice') > 0
    GROUP BY ts1.token_address
);
EOF

echo ""
echo "✅ 模拟完成"
