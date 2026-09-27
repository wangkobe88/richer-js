# daily-model-update — Daily 例行画像更新（182）

迁自 pumpfun-wss-trader（2026-09-27）。cron 每日两次自动维护两级离线画像，供 TPA（TokenPositionAnalyzer）实时读侧消费：

```
step3  token 分类    最新 N 个 virtual 实验的全史 ticks 离线重分类 → token_profiles
                    （build-token-profiles.cjs 逐实验跑，upsert 幂等；N=STEP3_SCOPE_LIMIT||10）
step4  钱包画像     高频钱包（tick≥3，--days 14）离线全历史 profile → wallet_offline_profiles
                    （build-wallet-profiles.cjs；须在 step3 后——依赖 token_profiles 的
                     flash_crash_period/first_tick_time 算 bad_action 靶向率）
```

只迁这两步；母版 step1/2/5/6（轮换记录/回测对比/实验轮换/ML）按迁移裁定排除。

## 部署（182）

1. 建表：Supabase SQL Editor 执行 `scripts/sql/create-model-iteration-metrics.sql`（幂等）
2. `chmod +x scripts/daily-model-update/cron-run-daily.sh`
3. crontab（182 系统时区 Asia/Shanghai）：
   ```
   30 6,22 * * * /home/ubuntu/richer-js/scripts/daily-model-update/cron-run-daily.sh
   ```
4. 手动首跑（先于 cron 验证一遍）：
   ```
   cd /home/ubuntu/richer-js && NODE_OPTIONS=--max-old-space-size=12288 node scripts/daily-model-update/run-daily.js
   ```

## 断点续跑

- **step 级**：`run-daily.js` 每步前查 `metrics[stepKey].done === true` 才跳过。
  ★不是母版的「键存在即跳过」——step3 每实验增量写 metrics（done:false），键在中途就存在
- **实验级**（step3 内部）：每跑完一个实验立即落盘 `per_experiment`（tokens!=null 为已完），
  中途失败重跑时已完实验不重复拉全史 ticks
- **失败**：当前步 fail + exit(1)，下次 cron 触发 resumeOrStart 自动续跑（failed 也续）
- **僵尸**：running >24h（上次进程死了没 fail）→ fail + 新建新 iteration 从头跑

## 监控

页面 `/model-metrics`（纯只读，无手动触发——cron 专属）：每轮状态/当前步/step3·step4 核心数字/
进行中进度/详情 modal（完整 metrics JSON + error）。API：`/api/model-metrics`（status 过滤 + 分页）、
`/api/model-metrics/:id`。

## 维护要点

- **stdout 是协议**：step3/step4 靠 `lib/parse.js` 正则从子进程 stdout 提取指标。改
  build-token-profiles / build-wallet-profiles 的 console.log 文案必须同步 parse.js +
  `scripts/_test_daily_parse_summary.cjs` fixture（漂移后果：指标静默 null，页面显 —，不崩）
- 日志：`logs/daily-cron-YYYYMMDD-HHMM.log`（每触发一个文件）
- flock 锁 `/tmp/richer-daily.lock`（与 182 同机母版 pumpfun 的 `/tmp/daily-model.lock` 互相独立）
- step3 逐实验循环可能小时级（跨实验重复 token 重复拉）；间隔 15.5h + flock 不会叠跑，
  首跑后按实测可 `STEP3_SCOPE_LIMIT` 调小
