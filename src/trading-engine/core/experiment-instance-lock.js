/**
 * 实验级单实例锁（2026-10-18 双跑事故防线：v21 1018 两次复发——--force 只绕过
 * DB status 校验，不检测同实验活进程，旧进程未 kill 就重启=双进程双跑）。
 *
 * 机制：本机锁文件 'wx' 独占创建（原子，并发抢锁只有一个胜者）→ 撞锁时读持有者
 * pid 判活性 + cmdline 匹配实验 id（防 pid 复用误判）→ 真持有者拒启 fail-fast；
 * 死 pid / pid 复用 / 损坏锁 = stale 自愈覆盖放行。
 *
 * 刻意不做「--force 自动杀旧进程」：优雅停需 30s+ flush（tickBuffer/eventWriter
 * 绝不丢行红线），自动杀会阻塞启动流程且超时进退两难；kill 留给操作者显式执行，
 * 本防线把「忘了 kill」从静默双跑变成显式报错。
 *
 * 锁为本机锁（tmpdir）：跨机重复启动防不了——实验只跑 182（红线 9），本机锁已
 * 覆盖真实风险。进程被 SIGKILL 残留锁由 stale 检测自愈（pid 死=放行）。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const LOCK_TAG = 'richer-js-exp';

function lockFilePath(experimentId) {
  return path.join(os.tmpdir(), `${LOCK_TAG}-${experimentId}.lock`);
}

/** pid 活性（signal 0 探测；EPERM=存在但无权限，也算活） */
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/** 读 pid 的完整命令行（linux /proc 优先，darwin/其他走 ps）；失败返回 null */
function readPidCmdline(pid) {
  try {
    const procPath = `/proc/${pid}/cmdline`;
    if (process.platform === 'linux' && fs.existsSync(procPath)) {
      return fs.readFileSync(procPath, 'utf8').split('\0').join(' ').trim();
    }
    return execSync(`ps -p ${pid} -o command=`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (e) {
    return null;
  }
}

/**
 * 抢实验锁。全同步（消除 check-then-write 竞态窗口）。
 * @returns {{ok: true, lockPath: string}}
 *   | {{ok: false, reason: 'held'|'unknown-alive', holderPid: number, holderCmd: string|null, lockPath: string}}
 *   held=实验已有活进程（cmdline 含实验 id）；unknown-alive=pid 活但 cmdline 不可读
 *   （fail-closed 拒启，提示手动核实——宁可拒启不可双跑）。
 */
function acquireExperimentLock(experimentId) {
  if (!experimentId || typeof experimentId !== 'string') {
    throw new Error(`acquireExperimentLock: experimentId 无效: ${experimentId}`);
  }
  const lockPath = lockFilePath(experimentId);
  const payload = JSON.stringify({
    pid: process.pid,
    cmd: process.argv.join(' '),
    acquiredAt: new Date().toISOString(),
  });

  // 最多 3 轮：首轮抢锁，撞锁后清 stale 重抢（正常 1-2 轮内收敛）
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.writeFileSync(lockPath, payload, { flag: 'wx' });
      return { ok: true, lockPath };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }

    let holder = null;
    try {
      holder = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    } catch (parseErr) {
      holder = null; // 损坏锁 → 清理重抢
    }
    if (!holder || !Number.isInteger(holder.pid) || holder.pid <= 0) {
      try { fs.unlinkSync(lockPath); } catch (unlinkErr) { /* 重试循环兜底 */ }
      continue;
    }

    if (!isPidAlive(holder.pid)) {
      // 持有者已死（正常退出漏释放/SIGKILL 残留）→ stale，清掉重抢
      try { fs.unlinkSync(lockPath); } catch (unlinkErr) { /* 重试循环兜底 */ }
      continue;
    }

    const holderCmd = readPidCmdline(holder.pid);
    if (holderCmd === null) {
      // 活进程但读不到 cmdline：无法排除是持有者，fail-closed 拒启
      return { ok: false, reason: 'unknown-alive', holderPid: holder.pid, holderCmd: null, lockPath };
    }
    if (holderCmd.includes(experimentId)) {
      // 真持有者：同实验活进程在跑 → 拒启
      return { ok: false, reason: 'held', holderPid: holder.pid, holderCmd, lockPath };
    }
    // pid 活但 cmdline 与本实验无关 = pid 复用 → stale 覆盖
    try { fs.unlinkSync(lockPath); } catch (unlinkErr) { /* 重试循环兜底 */ }
  }

  // 3 轮未收敛（极端：并发清理互相踩）→ 保守拒启
  return { ok: false, reason: 'unknown-alive', holderPid: -1, holderCmd: null, lockPath };
}

/** 释放实验锁（幂等；ENOENT 静默） */
function releaseExperimentLock(experimentId) {
  if (!experimentId || typeof experimentId !== 'string') return;
  try {
    fs.unlinkSync(lockFilePath(experimentId));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

/**
 * 拒启错误的统一文案（两入口共用）——给出可操作指引，防操作者盲改 DB。
 */
function lockDeniedMessage(result) {
  const { reason, holderPid, holderCmd } = result;
  if (reason === 'held') {
    return [
      `实验已有活进程在跑（PID ${holderPid}），拒绝启动——防双进程双跑（双记账/双卖/nonce 冲突）。`,
      `持有者命令行: ${holderCmd}`,
      `请先优雅停止旧进程（SIGTERM 等 flush 完成，勿 SIGKILL 防丢行）:`,
      `  kill ${holderPid}`,
      `确认退出后再启动。若确认无进程在跑而锁残留（机器重启等），删除锁文件:`,
      `  rm ${result.lockPath}`,
    ].join('\n');
  }
  return [
    `锁文件被 PID ${holderPid} 占用且无法核验其命令行（fail-closed 拒启）。`,
    `请手动核实该进程: ps -p ${holderPid} -o command=`,
    `与本实验无关时删除锁文件后重启: rm ${result.lockPath}`,
  ].join('\n');
}

module.exports = {
  acquireExperimentLock,
  releaseExperimentLock,
  lockDeniedMessage,
  lockFilePath,
};
