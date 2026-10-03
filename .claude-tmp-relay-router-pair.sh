#!/bin/bash
# router 双门配对接力：W1 终态 → 自动 screen 起 W0 → W0 终态 → 退出通知
KEY=/Users/nobody1/Downloads/clawbot.pem
HOST=ubuntu@43.153.196.182
W1LOG=/home/ubuntu/richer-js/logs/experiment-c3f2513c.log
W0LOG=/home/ubuntu/richer-js/logs/experiment-74fec329.log
W0ID=74fec329-688d-4d4a-bff5-a2930121e1c1

sshc() { ssh -i "$KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=20 "$HOST" "$1"; }

echo "[relay] 等待 W1 (c3f2513c) 终态..."
while true; do
  out=$(sshc "grep -E '实验终态|FATAL' $W1LOG 2>/dev/null | tail -1" 2>/dev/null) || out=""
  if [ -n "$out" ]; then
    echo "=== W1 终态: $out"
    break
  fi
  sleep 120
done

echo "[relay] 启动 W0 (74fec329) 基线臂..."
sshc "screen -dmS exp-74fec329 bash -c 'cd /home/ubuntu/richer-js && node src/run-engine.js $W0ID >> $W0LOG 2>&1'"
sleep 8
sshc "ps -ef | grep '$W0ID' | grep -v grep | head -1" || echo "[relay][warn] W0 进程未见，需人工检查"

echo "[relay] 等待 W0 终态..."
while true; do
  out=$(sshc "grep -E '实验终态|FATAL' $W0LOG 2>/dev/null | tail -1" 2>/dev/null) || out=""
  if [ -n "$out" ]; then
    echo "=== W0 终态: $out"
    sshc "grep '回放完成' $W0LOG | tail -1"
    break
  fi
  sleep 120
done
echo "[relay] 两臂完成，可跑 compare-router-gate-pair"
