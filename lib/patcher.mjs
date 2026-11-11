/**
 * 记忆引擎补丁器（内核，无 UI）
 *
 * 职责：
 *   locate  —— 找 SurfCore 在哪
 *   verify  —— 版本、文件、锚点、写权限、当前状态
 *   apply   —— 备份 → 写文件 → 改配置（支持 dryRun：只检查不写）
 *   rollback—— 从备份还原
 *
 * 设计原则：
 *   · 只认已知版本（keys.json 里的 version）；对不上就拒绝，绝不硬改。
 *   · 原始文件哈希对不上（用户改过/版本不同）也拒绝。
 *   · 写之前先 dryRun 全量检查；写之前备份。
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PAYLOAD = path.join(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '..', 'payload');
const KEYS_FILE = path.join(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '..', 'keys.json');

const sha256 = (buffer) => createHash('sha256')
  .update(String(buffer).replace(/\r\n/g, '\n'), 'utf8')
  .digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const exists = (file) => fs.existsSync(file);

export function loadKeys() {
  return readJson(KEYS_FILE);
}

/** SurfCore 可能在哪：显式路径 → DSH profile 的依赖链接 → 默认插件目录。 */
export function locateCandidates(explicit) {
  const list = [];
  if (explicit) list.push({ source: '手动指定', root: path.resolve(explicit) });

  const profilePkg = path.join(os.homedir(), '.dsh', 'profiles', 'desktop', 'package.json');
  if (exists(profilePkg)) {
    try {
      const pkg = readJson(profilePkg);
      const dep = pkg?.dependencies?.surfcore;
      if (typeof dep === 'string' && dep.startsWith('link:')) {
        list.push({ source: 'DSH profile 依赖', root: path.resolve(dep.slice(5)) });
      }
    } catch {}
  }

  list.push({ source: '默认插件目录', root: path.join(os.homedir(), '.dsh', 'plugins', 'surfcore') });
  return list;
}

/** 是不是 SurfCore 仓库根：同时有 src/memory-card.js 和 plugins/surfcore/lib/memory-card.js。 */
function looksLikeRepo(dir) {
  return exists(path.join(dir, 'src', 'memory-card.js'))
    && exists(path.join(dir, 'plugins', 'surfcore', 'lib', 'memory-card.js'));
}

/** 从任意位置往上找仓库根（DSH 的 plugins/surfcore 链接通常指向插件子目录，不是仓库根）。 */
export function resolveRepoRoot(dir) {
  // 目录联接（junction）不会让 path 自动跳盘：先解析成真实路径，再往上找。
  let start = path.resolve(dir);
  try { start = fs.realpathSync(start); } catch {}
  let current = start;
  for (let depth = 0; depth < 4; depth += 1) {
    if (looksLikeRepo(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return '';
}

/** 两个路径是否指向同一处（跟随 junction，Windows 下忽略大小写）。 */
function samePath(a, b) {
  try {
    const left = fs.realpathSync(a).toLowerCase();
    const right = fs.realpathSync(b).toLowerCase();
    return left === right;
  } catch {
    return false;
  }
}

/**
 * DSH 已安装的那份 SurfCore 仓库根 —— 唯一允许修改的目标。
 * 只从 DSH profile 依赖 / 默认插件目录推导，不接受调用方传入。
 */
export function canonicalRoot() {
  for (const candidate of locateCandidates('')) {
    const root = resolveRepoRoot(candidate.root);
    if (!root) continue;
    try {
      const pkg = readJson(path.join(root, 'package.json'));
      if (pkg?.name === 'surfcore') return root;
    } catch {}
  }
  return '';
}

/**
 * 定位：只返回 DSH 已安装的 SurfCore。
 * 手动指定时，路径必须和已安装的那份一致——否则等于允许改任意目录，那是我们要拒绝的。
 */
export function locate({ explicit } = {}) {
  const allowed = canonicalRoot();
  if (!allowed) {
    return { ok: false, error: '没找到 DSH 已安装的 SurfCore（检查 profile 依赖里的 surfcore）' };
  }

  if (explicit) {
    const root = resolveRepoRoot(explicit);
    if (!root) return { ok: false, error: `不是 SurfCore 仓库：${explicit}` };
    if (!samePath(root, allowed)) {
      return { ok: false, error: `只能修改 DSH 已安装的 SurfCore：${allowed}` };
    }
    try {
      const pkg = readJson(path.join(root, 'package.json'));
      return { ok: true, source: '手动指定', root, version: String(pkg.version ?? '') };
    } catch {
      return { ok: false, error: '读不到 package.json' };
    }
  }

  try {
    const pkg = readJson(path.join(allowed, 'package.json'));
    return { ok: true, source: 'DSH 已安装', root: allowed, version: String(pkg.version ?? '') };
  } catch {
    return { ok: false, error: '读不到 package.json' };
  }
}

/** 校验：返回逐项结果，任何一项（软项除外）失败都不允许应用。 */
export function verify(root) {
  const keys = loadKeys();
  const checks = [];
  // soft = 只展示、不拦截（比如“引擎开关”：文件还没打上去时它本来就该是 v1）
  const add = (name, ok, detail = '', soft = false) => checks.push({ name, ok, detail, soft });

  const pkgFile = path.join(root, 'package.json');
  let pkg = null;
  try { pkg = readJson(pkgFile); } catch {}
  add('识别为 SurfCore', pkg?.name === 'surfcore', pkg?.name ?? '读不到 package.json');
  add('版本已适配', String(pkg?.version ?? '') === keys.version, `当前 ${pkg?.version ?? '?'} / 支持 ${keys.version}`);

  // 只允许改 DSH 已安装的那份，防止被指向任意目录
  const allowedRoot = canonicalRoot();
  add(
    '目标路径是已安装的 SurfCore',
    Boolean(allowedRoot) && samePath(root, allowedRoot),
    allowedRoot || '找不到已安装的 SurfCore',
  );

  // 文件状态：原始 / 已是新版 / 旧版补丁（可升级）/ 未知
  const files = new Set([...Object.keys(keys.original), ...Object.keys(keys.patched)]);
  const states = {};
  for (const rel of files) {
    const file = path.join(root, rel);
    if (!exists(file)) {
      states[rel] = 'missing';
      add(`文件存在：${rel}`, false, '缺失');
      continue;
    }
    const hash = sha256(fs.readFileSync(file));
    const previous = Array.isArray(keys.previousPatched?.[rel]) ? keys.previousPatched[rel] : [];
    const state = hash === keys.original?.[rel] ? 'original'
      : (hash === keys.patched?.[rel] ? 'patched' : (previous.includes(hash) ? 'outdated' : 'unknown'));
    states[rel] = state;
    const detail = {
      original: '原始版本',
      patched: '已是新版',
      outdated: '旧版补丁（可以升级）',
      unknown: '内容和已知版本都对不上',
    }[state];
    add(`文件状态：${rel}`, state !== 'unknown', detail);
  }

  // 写权限：在 src 下试着建一个临时文件
  let writable = false;
  try {
    const probe = path.join(root, 'src', `.memlogic-probe-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    writable = true;
  } catch {}
  add('目录可写', writable, writable ? '' : '没有写入权限');

  const configFile = path.join(os.homedir(), '.dsh', 'surfcore', 'config.json');
  add('找到配置', exists(configFile), configFile);

  // 引擎开关：只展示，不拦截
  let engine = '';
  try {
    const config = exists(configFile) ? readJson(configFile) : {};
    engine = String(config?.memoryCard?.engine ?? '');
  } catch {}
  add('引擎开关', engine === 'v2', engine ? `engine = ${engine}` : 'engine 未设置', true);

  const hardOk = checks.filter((item) => item.soft !== true).every((item) => item.ok);
  const allPatched = files.size > 0 && [...files].every((rel) => states[rel] === 'patched');
  const anyOutdated = [...files].some((rel) => states[rel] === 'outdated');
  // 机器级状态：blocked / applied / half / outdated / ready
  const status = !hardOk ? 'blocked'
    : (allPatched ? (engine === 'v2' ? 'applied' : 'half') : (anyOutdated ? 'outdated' : 'ready'));
  return {
    ok: hardOk,
    status,
    engine,
    checks,
    states,
    unknown: Object.entries(states).filter(([, state]) => state === 'unknown').map(([rel]) => rel),
    alreadyPatched: allPatched,
    outdated: anyOutdated,
    configFile,
    keys,
  };
}

/** 应用（默认先 dryRun 校验，通过才写）。 */
export function apply(root, { dryRun = false, now = Date.now() } = {}) {
  const result = verify(root);
  if (!result.ok) return { ok: false, error: '校验没通过，没有改动任何文件', verify: result };

  if (result.alreadyPatched) {
    // 文件已经是新版：开关也开着 → 已完成；开关没开 → 只补开关
    if (result.engine === 'v2') return { ok: false, error: '已经完成，不需要再应用', verify: result };
    try {
      const config = exists(result.configFile) ? readJson(result.configFile) : {};
      config.memoryCard = config.memoryCard ?? {};
      config.memoryCard.engine = 'v2';
      fs.mkdirSync(path.dirname(result.configFile), { recursive: true });
      fs.writeFileSync(result.configFile, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
      return { ok: true, onlyConfig: true, configFile: result.configFile, next: '重启 DSH', verify: verify(root) };
    } catch (error) {
      return { ok: false, error: `写配置失败：${error?.message ?? error}`, verify: result };
    }
  }

  const plan = Object.keys(result.keys.patched).map((rel) => ({ rel, to: path.join(root, rel) }));
  if (dryRun) return { ok: true, dryRun: true, plan, verify: result };

  // 先解析配置：配置都不能读，就别动文件（避免“文件写了、配置没写”的半应用）。
  let config = null;
  try {
    config = exists(result.configFile) ? readJson(result.configFile) : {};
  } catch (error) {
    return { ok: false, error: `配置读不懂，未改动任何文件：${error?.message ?? error}` };
  }

  // 备份：当前所有相关文件（含旧版补丁的 decay-v2.js）+ 配置
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupDir = path.join(root, '.memlogic-backup', stamp);
  fs.mkdirSync(backupDir, { recursive: true });
  const backupRels = new Set([...Object.keys(result.keys.original), ...Object.keys(result.keys.patched)]);
  for (const rel of backupRels) {
    const file = path.join(root, rel);
    if (exists(file)) {
      const target = path.join(backupDir, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(file, target);
    }
  }
  if (exists(result.configFile)) {
    fs.mkdirSync(backupDir, { recursive: true });
    fs.copyFileSync(result.configFile, path.join(backupDir, 'surfcore-config.json'));
  }

  // 写文件 + 写配置：任何一步失败，整体还原
  const written = [];
  try {
    for (const rel of Object.keys(result.keys.patched)) {
      const from = path.join(PAYLOAD, rel);
      const to = path.join(root, rel);
      if (!exists(from)) throw new Error(`补丁包缺少 ${rel}`);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      written.push(rel);
    }
    config.memoryCard = config.memoryCard ?? {};
    config.memoryCard.engine = 'v2';
    fs.mkdirSync(path.dirname(result.configFile), { recursive: true });
    fs.writeFileSync(result.configFile, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  } catch (error) {
    // 还原已写的文件（备份里有就拷回，新增的删掉）
    for (const rel of written) {
      const backupFile = path.join(backupDir, rel);
      const target = path.join(root, rel);
      try {
        if (exists(backupFile)) fs.copyFileSync(backupFile, target);
        else fs.unlinkSync(target);
      } catch {}
    }
    return { ok: false, error: `应用失败，已还原：${error?.message ?? error}`, backupDir };
  }
  const configTouched = true;

  return {
    ok: true,
    backupDir,
    configFile: result.configFile,
    configTouched,
    files: plan.map((item) => item.rel),
    next: '重启 DSH，让插件重新加载新代码',
  };
}

/** 回滚：从备份还原，并删掉新增的 decay-v2.js。 */
export function rollback(root, { backupDir } = {}) {
  const base = path.join(root, '.memlogic-backup');
  let target = backupDir;
  if (!target) {
    if (!exists(base)) return { ok: false, error: '没有找到任何备份' };
    const dirs = fs.readdirSync(base).filter((name) => fs.statSync(path.join(base, name)).isDirectory()).sort();
    if (!dirs.length) return { ok: false, error: '备份目录是空的' };
    target = path.join(base, dirs[dirs.length - 1]);
  }

  const restored = [];
  // 备份里有什么就还原什么（含可能存在的旧版 decay-v2.js）
  for (const rel of ['src/memory-card.js', 'plugins/surfcore/lib/memory-card.js', 'src/decay-v2.js']) {
    const from = path.join(target, rel);
    if (!exists(from)) continue;
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.copyFileSync(from, path.join(root, rel));
    restored.push(rel);
  }

  const configBackup = path.join(target, 'surfcore-config.json');
  let configRestored = false;
  if (exists(configBackup)) {
    const configFile = path.join(os.homedir(), '.dsh', 'surfcore', 'config.json');
    fs.copyFileSync(configBackup, configFile);
    configRestored = true;
  } else {
    // 没有配置备份：至少把 engine 改回 v1
    const configFile = path.join(os.homedir(), '.dsh', 'surfcore', 'config.json');
    if (exists(configFile)) {
      const config = readJson(configFile);
      if (config.memoryCard) config.memoryCard.engine = 'v1';
      fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
      configRestored = true;
    }
  }

  // 新增的引擎文件：备份里没有，就删掉
  const engineFile = path.join(root, 'src', 'decay-v2.js');
  let engineRemoved = false;
  if (exists(engineFile) && !exists(path.join(target, 'src', 'decay-v2.js'))) {
    fs.unlinkSync(engineFile);
    engineRemoved = true;
  }

  return { ok: true, backupDir: target, restored, configRestored, engineRemoved, next: '重启 DSH' };
}
