#!/usr/bin/env node
/**
 * Logger console 复读同目标禁用 零 DB 零网络单测
 *
 * 事故现场（2026-10-16 蓝蛙案侧线）：182 启动命令
 * `nohup node main.js start-experiment … > logs/experiment-<id>-<date>.log`
 * 把 stdout 重定向到与 Logger WriteStream 相同的文件——console 复读走 shell 打开的
 * truncate 继承 fd（独立偏移、非 append），与 WriteStream 原子 append 互相踩踏，
 * 实验长名日志文件里 trader 现场/引擎行随机被覆盖丢失。修复：
 * `_consoleEchoDisabledFor` 比对 fd1/fd2 与目标文件 dev+ino，同文件跳过复读。
 *
 *   1. fd1 与目标文件同 inode → 跳过 console 复读（文件仍有行——WriteStream 真写）
 *   2. fd2（stderr）同 inode → 同样跳过（ERROR/WARN 走 console.error）
 *   3. 不同 inode → console 复读照常（每行 INFO→log / WARN→warn / ERROR→error）
 *   4. 目标文件 statSync 失败（不可达）→ 保守 false 保留复读
 *   5. fd fstatSync 失败（fd 已关等）→ 保守保留复读
 *   6. per-path 缓存：同路径二次判定不再 statSync（打桩计数验证）
 *   7. 无打桩真实回退：普通终端环境（fd=pipe/tty）下复读行为与修复前 bit 一致
 *
 * 打桩：fs.fstatSync/fs.statSync 选择性覆盖（模块内引用同一 fs 对象——Logger
 * 闭包持有的就是 require('fs')）；console.log/warn/error 收集器。真实临时目录
 * + 真实 WriteStream 落盘（验证文件侧行数不受复读开关影响）。
 *
 * 运行：node scripts/_test_logger_console_same_file.cjs
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let passed = 0;
function ok(cond, label, detail) {
  if (!cond) throw new Error(`FAIL: ${label}${detail ? ` | ${detail}` : ''}`);
  passed++;
  console.log(`  ✅ ${label}`);
}

/** console 三通道收集器（打桩期间收集，结束后恢复） */
function captureConsole(fn) {
  const lines = { log: [], warn: [], error: [] };
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...a) => lines.log.push(a.join(' '));
  console.warn = (...a) => lines.warn.push(a.join(' '));
  console.error = (...a) => lines.error.push(a.join(' '));
  try {
    fn();
  } finally {
    console.log = orig.log; console.warn = orig.warn; console.error = orig.error;
  }
  return lines;
}

/** 等 WriteStream 落盘（write() 异步，readFileSync 前轮询等行出现） */
async function waitForLine(file, str, timeoutMs = 2000) {
  const t0 = Date.now();
  for (;;) {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(str)) return;
    if (Date.now() - t0 > timeoutMs) throw new Error(`等文件行超时: ${str}`);
    await new Promise((res) => setTimeout(res, 10));
  }
}

const liveLoggers = [];
function mkLogger(dir) {
  const Logger = require(path.join(ROOT, 'src/services/logger'));
  const l = new Logger({ dir, experimentId: 'exp-log-test' });
  liveLoggers.push(l);
  return l;
}

/** 当天日志文件路径（与 Logger.getLogFilePath 同式） */
function todayFile(dir) {
  const date = new Date().toISOString().split('T')[0];
  return path.join(dir, `experiment-exp-log-test-${date}.log`);
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-echo-'));
  const realFstat = fs.fstatSync;
  const realStat = fs.statSync;
  const st = { statCalls: 0 };
  // statSync 包装：计数（缓存臂用），异常臂按路径注入 throw
  let statThrowFor = null;
  fs.statSync = (...args) => {
    st.statCalls++;
    if (statThrowFor && args[0] === statThrowFor) throw new Error('ENOTEST');
    return realStat(...args);
  };

  try {
    const logFile = todayFile(dir);

    // 预写一行建文件，拿真实 inode 供 fstatSync 打桩冒充
    fs.writeFileSync(logFile, 'seed\n');
    const fileStat = realStat(logFile);
    const sameInode = { dev: fileStat.dev, ino: fileStat.ino };
    const otherInode = { dev: fileStat.dev, ino: fileStat.ino + 1 };

    // ============ 1. fd1 同 inode → 禁复读 ============
    console.log('\n[1] stdout（fd1）重定向到日志文件 → 跳过 console 复读');
    {
      const logger = mkLogger(dir);
      fs.fstatSync = (fd) => (fd === 1 ? sameInode : otherInode);
      const lines = captureConsole(() => {
        logger.info('exp-log-test', 'T1', '行A');
        logger.warn('exp-log-test', 'T1', '行B');
        logger.error('exp-log-test', 'T1', '行C');
      });
      await waitForLine(logFile, '行C');
      const fileContent = fs.readFileSync(logFile, 'utf8');
      ok(lines.log.length === 0 && lines.warn.length === 0 && lines.error.length === 0,
        'console 三通道零复读');
      ok(fileContent.includes('行A') && fileContent.includes('行B') && fileContent.includes('行C'),
        '文件侧行完整（WriteStream 真写不受开关影响）');
    }

    // ============ 2. fd2 同 inode → 禁复读 ============
    console.log('\n[2] stderr（fd2）重定向到日志文件 → 同样跳过');
    {
      fs.truncateSync(logFile);
      const logger = mkLogger(dir);
      fs.fstatSync = (fd) => (fd === 2 ? sameInode : otherInode);
      const lines = captureConsole(() => logger.error('exp-log-test', 'T2', '行D'));
      await waitForLine(logFile, '行D');
      ok(lines.error.length === 0, 'ERROR 零复读');
      ok(fs.readFileSync(logFile, 'utf8').includes('行D'), '文件侧有行');
    }

    // ============ 3. 不同 inode → 复读照常 ============
    console.log('\n[3] stdout 指向别处（正常终端/独立 nohup 文件）→ 复读照常');
    {
      const logger = mkLogger(dir);
      fs.fstatSync = () => otherInode;
      const lines = captureConsole(() => {
        logger.info('exp-log-test', 'T3', '行E');
        logger.warn('exp-log-test', 'T3', '行F');
        logger.error('exp-log-test', 'T3', '行G');
      });
      ok(lines.log.length === 1 && lines.log[0].includes('行E'), 'INFO→console.log');
      ok(lines.warn.length === 1 && lines.warn[0].includes('行F'), 'WARN→console.warn');
      ok(lines.error.length === 1 && lines.error[0].includes('行G'), 'ERROR→console.error');
    }

    // ============ 4. statSync 失败 → 保守保留复读 ============
    console.log('\n[4] 目标文件 stat 失败 → 保守复读（fail-open 保留旧行为）');
    {
      fs.truncateSync(logFile);
      const logger = mkLogger(dir);
      const missing = path.join(dir, 'experiment-miss-' + Date.now() + '.log');
      statThrowFor = missing; // 打桩 throw（真实场景=权限/NFS 抖动）
      fs.fstatSync = () => sameInode; // 即便 fd 匹配
      // 直接调用私有判定（missing 路径首见=缓存 miss → statSync throw → false）
      const disabled = logger._consoleEchoDisabledFor(missing);
      ok(disabled === false, 'stat 异常 → 不禁复读（保守保留复读）');
      statThrowFor = null;
    }

    // ============ 5. fstatSync 失败 → 保守保留复读 ============
    console.log('\n[5] fd fstat 失败（fd 已关等）→ 保守复读');
    {
      const logger = mkLogger(dir);
      fs.fstatSync = (fd) => { throw new Error('EBADF'); };
      const lines = captureConsole(() => logger.info('exp-log-test', 'T5', '行I'));
      ok(lines.log.length === 1, 'fstat 异常 → 复读保留');
      ok(logger._consoleEchoDisabledFor(logFile) === false, '判定返回 false（保守）');
    }

    // ============ 6. per-path 缓存 ============
    console.log('\n[6] per-path 缓存：二次判定零 statSync');
    {
      const logger = mkLogger(dir);
      fs.fstatSync = () => otherInode;
      logger._consoleEchoDisabledFor(path.join(dir, 'cached-file.log'));
      const before = st.statCalls;
      fs.writeFileSync(path.join(dir, 'cached-file.log'), 'x');
      logger._consoleEchoDisabledFor(path.join(dir, 'cached-file.log'));
      ok(st.statCalls === before + 0, `缓存命中不再 stat（calls ${before}→${st.statCalls}）`);
      // 新路径仍会 stat
      logger._consoleEchoDisabledFor(path.join(dir, 'cached-file-2.log'));
      ok(st.statCalls === before + 2 || st.statCalls > before, '新路径照常判定');
    }

    // ============ 7. 真实环境（无打桩 fstat）行为 ============
    console.log('\n[7] 真实环境回退：本进程 fd=pipe/tty 与临时文件必不同 → 复读照常');
    {
      fs.fstatSync = realFstat;
      const logger = mkLogger(dir);
      const lines = captureConsole(() => logger.info('exp-log-test', 'T7', '行J'));
      ok(lines.log.length === 1 && lines.log[0].includes('行J'), '本地跑测试复读照常（与修复前一致）');
    }
  } finally {
    fs.fstatSync = realFstat;
    fs.statSync = realStat;
    // 先冲刷并关闭各 WriteStream，再删目录（否则惰性写在 rmSync 后报 ENOENT 噪声）
    await Promise.all(liveLoggers.flatMap((l) =>
      [...l._streams.values()].map((s) => new Promise((res) => s.end(res)))));
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(`\n✅ 全部通过（${passed} 断言）`);
}

main().catch((err) => {
  console.error(`\n❌ ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
