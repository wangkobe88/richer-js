#!/usr/bin/env bash
# daily 例行调度入口（crontab 调用，182）。
#
# 迁自 pumpfun-wss-trader（2026-09-27）。crontab 行（Asia/Shanghai，182 系统时区即北京时间）：
#   30 6,22 * * * /home/ubuntu/richer-js/scripts/daily-model-update/cron-run-daily.sh
#
# - 强制 NODE_OPTIONS=--max-old-space-size=12288：step3 token 分类 / step4 钱包画像拉全史
#   ticks 内存可达数 GB；run-daily.js 的子步骤经 execSync 继承父进程环境变量，
#   在此设一次即覆盖全链路（子进程命令里也显式带同值，双保险）。
# - flock -n 防并发：上一轮 daily 仍在跑（跨触发点）则本次静默跳过。
#   ★锁名独立于母版（/tmp/daily-model.lock）——182 同机两仓库并行，不能互挤。
# - 日期戳日志 logs/daily-cron-YYYYMMDD-HHMM.log，避免单文件无限增长。
# - REPO 从脚本位置自推导（不硬编码路径），cd 后再跑——dbManager 的 dotenv './config/.env'
#   相对 CWD 解析，异目录起跑会取不到 env（lib/db.js 顶层绝对路径加载是第一道保险）。
# run-daily.js 起首已 gitSync()（git pull --rebase），wrapper 不重复拉码。
set -uo pipefail
PATH=/usr/local/bin:/usr/bin:/bin

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
NODE=/usr/local/bin/node   # 182 同机母版（pumpfun-wss-trader）cron 实证路径
LOCK=/tmp/richer-daily.lock

mkdir -p "$REPO/logs"
LOG="$REPO/logs/daily-cron-$(date +%Y%m%d-%H%M).log"

(
  flock -n 200 || { echo "[cron-run-daily] $(date -Is) 另一轮 daily 仍在运行（flock 冲突），跳过本次"; exit 0; }
  echo "[cron-run-daily] trigger $(date -Is)"
  cd "$REPO"
  exec env NODE_OPTIONS=--max-old-space-size=12288 "$NODE" scripts/daily-model-update/run-daily.js
) 200>"$LOCK" >"$LOG" 2>&1
