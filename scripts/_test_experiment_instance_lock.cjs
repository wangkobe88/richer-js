#!/usr/bin/env node
/**
 * 实验单实例锁单测（2026-10-18 双跑事故防线）——零 DB 零网络。
 * 覆盖：抢锁/释放循环、活持有者拒启（cmdline 匹配）、死 pid stale 自愈、
 * pid 复用（cmdline 不匹配）放行、损坏锁清理、锁拒启不动状态（源码口径：
 * main.js catch 区分 EXPERIMENT_LOCK_HELD 不置 failed）、两入口接线存在。
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const {
  acquireExperimentLock,
  releaseExperimentLock,
  lockDeniedMessage,
  lockFilePath,
} = require(path.join(ROOT, 'src/trading-engine/core/experiment-instance-lock'));

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL*** ${name}${detail ? ' | ' + detail : ''}`); }
}

const TEST_TAG = 'test-instlock';
function freshId(label) {
  const id = `${TEST_TAG}-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  // 清残留（幂等）
  try { fs.unlinkSync(lockFilePath(id)); } catch (e) {}
  return id;
}

function spawnHolder(id, extraArg) {
  // cmdline 含实验 id 的活进程（hold 6s 后自杀，测试无需清理也自愈）
  const child = spawn(process.execPath, [
    '-e', `setTimeout(() => process.exit(0), 6000)`, extraArg || id,
  ], { stdio: 'ignore', detached: false });
  return child;
}

(async () => {
  // A1 抢锁成功 → 释放 → 再抢成功（幂等循环）
  {
    const id = freshId('a1');
    const r1 = acquireExperimentLock(id);
    check('A1 抢锁成功', r1.ok === true);
    releaseExperimentLock(id);
    const r2 = acquireExperimentLock(id);
    check('A1 释放后再抢成功', r2.ok === true);
    releaseExperimentLock(id);
  }

  // A2 活持有者拒启：锁文件指向活进程且 cmdline 含实验 id
  {
    const id = freshId('a2');
    const holder = spawnHolder(id);
    await new Promise(res => holder.on('spawn', res));
    fs.writeFileSync(lockFilePath(id), JSON.stringify({
      pid: holder.pid, cmd: 'stale-record', acquiredAt: new Date().toISOString(),
    }), { flag: 'w' });
    const r = acquireExperimentLock(id);
    check('A2 活持有者拒启', r.ok === false && r.reason === 'held', JSON.stringify(r));
    check('A2 holderPid 正确', r.holderPid === holder.pid);
    check('A2 holderCmd 含实验 id', typeof r.holderCmd === 'string' && r.holderCmd.includes(id), r.holderCmd);
    // 拒启文案含 kill 指引
    const msg = (() => { try { return lockDeniedMessage(r); } catch (e) { return ''; } })();
    check('A2 拒启文案含 kill 指引', msg.includes(`kill ${holder.pid}`), msg.slice(0, 80));
    holder.kill();
    releaseExperimentLock(id);
  }

  // A3 死 pid = stale 自愈放行
  {
    const id = freshId('a3');
    fs.writeFileSync(lockFilePath(id), JSON.stringify({
      pid: 4194303, cmd: 'dead', acquiredAt: new Date().toISOString(),
    }), { flag: 'w' });
    const r = acquireExperimentLock(id);
    check('A3 死 pid stale 放行', r.ok === true, JSON.stringify(r));
    releaseExperimentLock(id);
  }

  // A4 pid 复用：锁指向活进程但 cmdline 不含实验 id → 覆盖放行
  {
    const id = freshId('a4');
    const other = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 6000)', 'unrelated-process-arg'], { stdio: 'ignore' });
    await new Promise(res => other.on('spawn', res));
    fs.writeFileSync(lockFilePath(id), JSON.stringify({
      pid: other.pid, cmd: 'old-holder-record', acquiredAt: new Date().toISOString(),
    }), { flag: 'w' });
    const r = acquireExperimentLock(id);
    check('A4 pid 复用（cmdline 不匹配）放行', r.ok === true, JSON.stringify(r));
    other.kill();
    releaseExperimentLock(id);
  }

  // A5 损坏锁（非 JSON）→ 清理放行
  {
    const id = freshId('a5');
    fs.writeFileSync(lockFilePath(id), 'not-json-garbage', { flag: 'w' });
    const r = acquireExperimentLock(id);
    check('A5 损坏锁清理放行', r.ok === true, JSON.stringify(r));
    releaseExperimentLock(id);
  }

  // A6 无效入参 throw
  {
    let threw = false;
    try { acquireExperimentLock(''); } catch (e) { threw = true; }
    check('A6 空 id throw', threw);
  }

  // B1 源码接线：main.js startByExperimentId 开头抢锁 + catch 区分锁错误不置 failed
  {
    const mainSrc = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    check('B1 main.js 接线 acquire', mainSrc.includes('acquireExperimentLock(experimentId)'));
    const lockFirst = mainSrc.indexOf('acquireExperimentLock(experimentId)');
    const loadFirst = mainSrc.indexOf('// 1. 加载实验配置');
    check('B1 main.js 锁先于实验加载', lockFirst > -1 && loadFirst > -1 && lockFirst < loadFirst);
    check('B1 main.js 锁错误不置 failed', /EXPERIMENT_LOCK_HELD[\s\S]{0,400}?process\.exit\(1\)/.test(mainSrc)
      && !/EXPERIMENT_LOCK_HELD[\s\S]{0,200}?updateStatus/.test(mainSrc));
    check('B1 main.js stop 释放锁', /stop\(\)[\s\S]{0,600}?releaseExperimentLock\(this\.experimentId\)/.test(mainSrc));
  }

  // B2 源码接线：run-engine.js 同款
  {
    const reSrc = fs.readFileSync(path.join(ROOT, 'src/run-engine.js'), 'utf8');
    check('B2 run-engine 接线 acquire', reSrc.includes('acquireExperimentLock(experimentId)'));
    check('B2 run-engine 锁拒启直接退出', reSrc.includes('lockDeniedMessage(lock)'));
    check('B2 run-engine 优雅停释放', /gracefulShutdown[\s\S]{0,800}?releaseExperimentLock\(experimentId\)/.test(reSrc));
  }

  // C1 端到端：真 start-experiment 撞活持有者拒启。锁在实验 load 之前——假 id +
  // 活持有者即拒，绝不触 DB（若防线失效会走到 load 假 id 报「实验不存在」，
  // 输出不含 PID 可被 C1 第二断言抓出）
  {
    const id = freshId('c1');
    const holder = spawnHolder(id);
    await new Promise(res => holder.on('spawn', res));
    // 手工写锁文件指向 holder（holder 自身不抢锁——模拟真实场景：旧实验进程持锁在跑）
    fs.writeFileSync(lockFilePath(id), JSON.stringify({
      pid: holder.pid, cmd: 'recorded-at-acquire', acquiredAt: new Date().toISOString(),
    }), { flag: 'w' });
    // 走真实 main.js CLI 入口（--force 也拦——防双跑是硬防线）
    const cli = spawn(process.execPath, [path.join(ROOT, 'main.js'), 'start-experiment', '-e', id, '--force'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: ROOT,
    });
    let out = '';
    cli.stdout.on('data', d => out += d);
    cli.stderr.on('data', d => out += d);
    const code = await new Promise(res => cli.on('close', res));
    check('C1 CLI --force 撞活持有者退出非零', code !== 0, `code=${code}`);
    check('C1 CLI 报错含 PID', out.includes(String(holder.pid)), out.slice(-300));
    holder.kill();
    releaseExperimentLock(id);
  }

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILED'}: ${pass} pass / ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
