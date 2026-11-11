// 记忆引擎（memory-engine）· Host 半边
//
// 只做一件事：把 SurfCore 的记忆逻辑升级成 v2（分数引擎）。
// 流程：定位 → 校验 → 试运行 → 应用 / 回滚。给设置页提供四个接口。
//
// 安全边界：
//   · 只认已知版本（keys.json），对不上就拒绝；
//   · 写之前先解析配置、先备份；任何一步失败自动整体还原；
//   · 不碰 SurfCore 其他功能，只改记忆那三个文件和 engine 开关；
//   · 所有接口先过 ctx.connection.admit()，只接受已认证的 GUI 连接；
//   · 目标只能是 DSH 已安装的那份 SurfCore（路径由 profile 依赖推导）。

import fs from 'node:fs';
import path from 'node:path';
import { apply as applyPatch, canonicalRoot, locate, rollback, verify } from './lib/patcher.mjs';
import { BASE_CONFIG, OVERRIDE_FILE, sanitizeOverride } from './payload/src/decay-v2.js';

const PLAN_SVG = fs.readFileSync(new URL('./plan.svg', import.meta.url), 'utf8');

export const name = 'memory-engine';
export const inject = ['webServer']; // connection 按请求取（ctx.get），没注入也 fail-closed

export function apply(ctx, config) {
  const row = config ?? {};
  let lastRoot = String(row.root ?? '');
  let lastVerify = null;

  const webServer = ctx.get('webServer');
  if (!webServer) {
    console.log('[memory-engine] 没有 webServer，设置页不可用');
    return;
  }

  const json = (res, code, value) => {
    res.statusCode = code;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(value));
  };

  /**
   * 宿主认证：只让带有效浏览器/API 凭据的请求进来。
   * 失败一律关闭（没有 connection 服务时也拒绝），不做“没认证就放行”的降级。
   */
  const admit = (req, res) => {
    const connection = ctx.get('connection');
    if (!connection || typeof connection.admit !== 'function') {
      json(res, 503, { ok: false, error: '宿主认证不可用（缺少 connection 服务）' });
      return false;
    }
    let admission;
    try {
      admission = connection.admit({ headers: req.headers });
    } catch {
      json(res, 403, { ok: false, error: '认证失败' });
      return false;
    }
    if (!admission || typeof admission !== 'object' || 'rejection' in admission) {
      const code = Number(admission?.rejection) || 401;
      json(res, code, { ok: false, error: '未通过宿主认证' });
      return false;
    }
    return true;
  };


  /** 统一注册：所有路由先过宿主认证，再进业务处理。 */
  const register = (route) => webServer.register({
    ...route,
    handler: async (req, res) => {
      if (!admit(req, res)) return;
      try {
        await route.handler(req, res);
      } catch (error) {
        try { json(res, 500, { ok: false, error: String(error?.message ?? error) }); } catch {}
      }
    },
  });

  const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new Error('请求体太大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });

  let lastVerifyAt = 0;

  const statusPayload = () => ({
    ok: true,
    root: lastRoot,
    verified: Boolean(lastVerify?.ok),
    verifiedAt: lastVerifyAt,
    status: lastVerify?.status ?? 'none',
    engine: lastVerify?.engine ?? '',
    alreadyPatched: Boolean(lastVerify?.alreadyPatched),
    checks: lastVerify?.checks ?? [],
    version: lastVerify?.keys?.version ?? '',
  });

  ctx.effect(() => register({
    kind: 'exact',
    path: '/api/memory-engine/status',
    handler: (_req, res) => json(res, 200, statusPayload()),
  }));

  ctx.effect(() => register({
    kind: 'exact',
    path: '/api/memory-engine/locate',
    handler: async (req, res) => {
      try {
        const body = await readBody(req);
        const found = locate({ explicit: body?.path ?? '' });
        if (!found.ok) return json(res, 200, { ok: false, error: found.error });
        lastRoot = found.root;
        lastVerify = null;
        return json(res, 200, { ok: true, ...found });
      } catch (error) {
        return json(res, 500, { ok: false, error: String(error?.message ?? error) });
      }
    },
  }));

  ctx.effect(() => register({
    kind: 'exact',
    path: '/api/memory-engine/verify',
    handler: async (_req, res) => {
      if (!lastRoot) return json(res, 200, { ok: false, error: '还没定位到 SurfCore' });
      try {
        lastVerify = verify(lastRoot);
        lastVerifyAt = Date.now();
        return json(res, 200, statusPayload());
      } catch (error) {
        return json(res, 500, { ok: false, error: String(error?.message ?? error) });
      }
    },
  }));

  ctx.effect(() => register({
    kind: 'exact',
    path: '/api/memory-engine/apply',
    handler: async (req, res) => {
      if (!lastRoot) return json(res, 200, { ok: false, error: '还没定位到 SurfCore' });
      if (!lastVerify?.ok) return json(res, 200, { ok: false, error: '还没通过校验' });
      try {
        const body = await readBody(req);
        // apply 内部会再校验一次：页面上的“已校验”是旧的也不会写坏
        const result = applyPatch(lastRoot, { dryRun: body?.dryRun === true });
        lastVerify = verify(lastRoot);
        lastVerifyAt = Date.now();
        return json(res, 200, { ...result, verify: statusPayload() });
      } catch (error) {
        return json(res, 500, { ok: false, error: String(error?.message ?? error) });
      }
    },
  }));

  ctx.effect(() => register({
    kind: 'exact',
    path: '/api/memory-engine/rollback',
    handler: async (_req, res) => {
      if (!lastRoot) return json(res, 200, { ok: false, error: '还没定位到 SurfCore' });
      if (!lastVerify?.ok) return json(res, 200, { ok: false, error: '还没通过校验，先点“校验”' });
      try {
        // 回滚前再查一次：校验之后文件被改过（变成不认识的指纹）就不动，避免冲掉别人的改动
        const current = verify(lastRoot);
        if (current.states && Object.values(current.states).some((state) => state === 'unknown')) {
          lastVerify = current;
          lastVerifyAt = Date.now();
          return json(res, 200, { ok: false, error: '文件在校验之后被改过，先重新点一次“校验”确认', verify: statusPayload() });
        }
        const result = rollback(lastRoot);
        lastVerify = verify(lastRoot);
        lastVerifyAt = Date.now();
        return json(res, 200, { ...result, verify: statusPayload() });
      } catch (error) {
        return json(res, 500, { ok: false, error: String(error?.message ?? error) });
      }
    },
  }));

  ctx.effect(() => register({
    kind: 'exact',
    path: '/api/memory-engine/plan.svg',
    handler: (_req, res) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'image/svg+xml; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(PLAN_SVG);
    },
  }));

  const numericBase = Object.fromEntries(
    Object.entries(BASE_CONFIG.base).filter(([, value]) => Number.isFinite(value)),
  );

  ctx.effect(() => register({
    kind: 'exact',
    path: '/api/memory-engine/tuning',
    handler: async (req, res) => {
      if (req.method === 'GET') {
        let current = {};
        try { current = JSON.parse(fs.readFileSync(OVERRIDE_FILE, 'utf8').replace(/^\uFEFF/, '')); } catch {}
        return json(res, 200, {
          ok: true,
          defaults: {
            base: numericBase,
            mult: BASE_CONFIG.mult,
            importance: BASE_CONFIG.importance,
            promote: BASE_CONFIG.promote,
            recall: { ...BASE_CONFIG.recall, cooldownHours: BASE_CONFIG.recall.cooldownMs / 3_600_000 },
            tiers: BASE_CONFIG.tiers,
            caps: BASE_CONFIG.caps,
            consolidate: BASE_CONFIG.consolidate,
          },
          current,
          file: OVERRIDE_FILE,
        });
      }
      try {
        const body = await readBody(req);
        if (!lastVerify?.ok) return json(res, 200, { ok: false, error: '还没通过校验，先点“校验”' });
        if (body?.reset === true) {
          try { fs.unlinkSync(OVERRIDE_FILE); } catch {}
          return json(res, 200, { ok: true, reset: true, file: OVERRIDE_FILE, next: '重启 DSH 后生效' });
        }
        const cleaned = sanitizeOverride(body?.values ?? body);
        fs.mkdirSync(path.dirname(OVERRIDE_FILE), { recursive: true });
        fs.writeFileSync(OVERRIDE_FILE, `${JSON.stringify(cleaned, null, 2)}\n`, 'utf8');
        return json(res, 200, { ok: true, saved: cleaned, file: OVERRIDE_FILE, next: '重启 DSH 后生效' });
      } catch (error) {
        return json(res, 500, { ok: false, error: String(error?.message ?? error) });
      }
    },
  }));

  console.log('[memory-engine] 已挂上 6 个接口（status/locate/verify/apply/rollback/tuning）');
}



