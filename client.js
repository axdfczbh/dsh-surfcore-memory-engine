window.__ModuleLoader__.load({
  id: 'dsh-surfcore-memory-engine',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const api = async (path, body) => {
      const res = await fetch(`/api/memory-engine/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        cache: 'no-store',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return res.json().catch(() => ({}));
    };

    const box = { border: '1px solid rgba(127,127,127,.28)', borderRadius: 10, padding: '12px 14px', marginBottom: 12 };
    const rowStyle = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8 };
    const btn = (primary, disabled) => ({
      padding: '6px 14px', borderRadius: 8, fontSize: 13,
      cursor: disabled ? 'not-allowed' : 'pointer',
      border: primary ? '1px solid transparent' : '1px solid rgba(127,127,127,.4)',
      background: primary ? '#3b6fe0' : 'transparent',
      color: primary ? '#fff' : 'inherit',
      opacity: disabled ? 0.5 : 1,
    });
    const input = {
      padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(127,127,127,.4)',
      background: 'transparent', color: 'inherit', minWidth: 260, fontSize: 13,
    };
    const numInput = { ...input, minWidth: 96, width: 96 };
    const banner = {
      applied: { text: '✓ 已更新完成 · v2 正在运行', border: '#3f8f4f', bg: 'rgba(63,143,79,.12)' },
      half: { text: '⚠ 文件已更新，但引擎开关没打开', border: '#c08a2e', bg: 'rgba(192,138,46,.12)' },
      outdated: { text: '旧版补丁 · 可以升级到新版引擎', border: '#3b6fe0', bg: 'rgba(59,111,224,.10)' },
      ready: { text: '校验通过，可以应用', border: '#3b6fe0', bg: 'rgba(59,111,224,.10)' },
      blocked: { text: '有项目没通过，不能应用', border: '#c0504d', bg: 'rgba(192,80,77,.12)' },
    };

    const DAY = 1440;
    const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

    function SettingsPage() {
      const [root, setRoot] = React.useState('');
      const [version, setVersion] = React.useState('');
      const [checks, setChecks] = React.useState([]);
      const [status, setStatus] = React.useState('none');
      const [verifiedAt, setVerifiedAt] = React.useState(0);
      const [manual, setManual] = React.useState('');
      const [showManual, setShowManual] = React.useState(false);
      const [busy, setBusy] = React.useState(false);
      const [msg, setMsg] = React.useState(null);
      const [showPlan, setShowPlan] = React.useState(false);
      const [form, setForm] = React.useState(null);
      const [tuneMsg, setTuneMsg] = React.useState(null);
      const [tuneBusy, setTuneBusy] = React.useState(false);

      const verified = ['ready', 'applied', 'half', 'outdated'].includes(status);
      const canRollback = ['applied', 'half', 'outdated'].includes(status) && !busy;
      const canApply = (status === 'ready' || status === 'half' || status === 'outdated') && !busy;

      const applyVerifyData = (data) => {
        setChecks(Array.isArray(data?.checks) ? data.checks : []);
        const next = data?.status ?? 'none';
        setStatus(next);
        if (data?.verifiedAt) setVerifiedAt(Number(data.verifiedAt));
        if (['ready', 'applied', 'half', 'outdated'].includes(next)) void loadTuning();
      };

      const run = async (label, fn) => {
        setBusy(true);
        setMsg(null);
        try {
          const data = await fn();
          if (data?.ok === false) setMsg({ kind: 'error', text: `${label}：${data?.error ?? '失败'}` });
          return data;
        } catch (error) {
          setMsg({ kind: 'error', text: `${label}失败：${error?.message ?? error}` });
          return null;
        } finally {
          setBusy(false);
        }
      };

      const doLocate = (path) => run('定位', async () => {
        const data = await api('locate', { path: path ?? '' });
        if (data?.ok) {
          setRoot(data.root ?? '');
          setVersion(data.version ?? '');
          setChecks([]);
          setStatus('none');
          setVerifiedAt(0);
          setForm(null);
          if (!path) setManual(data.root ?? '');
        } else {
          setShowManual(true);
        }
        return data;
      });

      const doVerify = () => run('校验', async () => {
        const data = await api('verify');
        if (data?.ok !== false) applyVerifyData(data);
        return data;
      });

      const doVerifySilent = async () => {
        const data = await api('verify');
        if (data?.ok !== false) applyVerifyData(data);
      };

      const doApply = () => {
        const label = status === 'half' ? '启用 v2' : '应用';
        if (!window.confirm(status === 'half'
          ? '文件已经是新版了，只差把引擎开关打开。现在启用 v2 吗？'
          : '要把记忆引擎换成 v2 吗？会先自动备份，应用后需要重启 DSH。')) return Promise.resolve(null);
        return run(label, async () => {
          const data = await api('apply', {});
          if (data?.ok) {
            setMsg({ kind: 'ok', text: `${data.onlyConfig ? '已把开关切到 v2' : '已应用'}。下一步：${data.next ?? '重启 DSH'}` });
            await doVerifySilent();
          }
          return data;
        });
      };

      const doRollback = () => {
        if (!window.confirm('要回滚到旧版记忆逻辑吗？回滚后需要重启 DSH。')) return Promise.resolve(null);
        return run('回滚', async () => {
          const data = await api('rollback');
          if (data?.ok) {
            setMsg({ kind: 'ok', text: `已回滚。下一步：${data.next ?? '重启 DSH'}` });
            await doVerifySilent();
          }
          return data;
        });
      };

      const loadTuning = async () => {
        try {
          const data = await api('tuning');
          if (data?.ok === false) return;
          const d = data.defaults ?? {};
          const c = data.current ?? {};
          const base = { ...(d.base ?? {}), ...(c.base ?? {}) };
          const promote = { ...(d.promote ?? {}), ...(c.promote ?? {}) };
          const recall = { ...(d.recall ?? {}), ...(c.recall ?? {}) };
          const tiers = {
            daily: { ...(d.tiers?.daily ?? {}), ...(c.tiers?.daily ?? {}) },
            long: { ...(d.tiers?.long ?? {}), ...(c.tiers?.long ?? {}) },
          };
          const caps = { ...(d.caps ?? {}), ...(c.caps ?? {}) };
          const mult = { ...(d.mult ?? {}), ...(c.mult ?? {}) };
          const importance = { ...(d.importance ?? {}), ...(c.importance ?? {}) };
          const consolidate = { ...(d.consolidate ?? {}), ...(c.consolidate ?? {}) };
          const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
          const toDays = (score, fallback) => round2(num(score, fallback * DAY) / DAY);
          const cooldownHours = c.recall?.cooldownMs ? c.recall.cooldownMs / 3_600_000 : num(d.recall?.cooldownHours, 6);
          setForm({
            qqOwnerDays: toDays(base['qq-owner'], 3),
            qqSelfDays: toDays(base['qq-self'], 3),
            petOwnerDays: toDays(base['pet-owner'], 1.5),
            petSelfDays: toDays(base['pet-self'], 1.5),
            biliVideoDays: toDays(base['bili-video'], 2),
            biliDynamicDays: toDays(base['bili-dynamic'], 2),
            groupHours: round2(num(base['qq-group'], 30) / 60),
            dailyMinutes: round2(1 / num(tiers.daily?.rate, 1)),
            longMinutes: round2(1 / num(tiers.long?.rate, 1 / 30)),
            initialCapDays: toDays(caps.initialCap, 50_000 / DAY),
            maxScoreYears: round2(num(caps.maxScore, 2_628_000) / DAY / 365),
            path1Days: toDays(promote.path1?.score, 12000 / DAY),
            path1Imp: num(promote.path1?.importance, 60),
            path2Days: toDays(promote.path2?.score, 6000 / DAY),
            path2Imp: num(promote.path2?.importance, 80),
            bonusDays: num(promote.bonusDays, 90),
            permImp: num(promote.path3?.importance, 90),
            longSlots: num(promote.longSlots, 30),
            mult: {
              owner: num(mult.owner, 1.5), replied: num(mult.replied, 1.25),
              emotion: num(mult.emotion, 1.5), relation: num(mult.relation, 1.5),
              first: num(mult.first, 1.5), conflict: num(mult.conflict, 1.5),
              promise: num(mult.promise, 1.5),
            },
            capDaily: 1 + num(tiers.daily?.recallCapPct, 0.5),
            capLong: 1 + num(tiers.long?.recallCapPct, 1.0),
            recall: {
              basePct: round2(num(recall.basePct, 0.2) * 100),
              singleCapPct: round2(num(recall.singleCapPct, 0.3) * 100),
              floorMin: num(recall.floor, 120),
              cooldownHours: round2(cooldownHours),
              emotionBoost: num(recall.emotionBoost, 1.25),
              relationBoost: num(recall.relationBoost, 1.25),
            },
            importance: {
              base: num(importance.base, 20), owner: num(importance.owner, 25),
              self: num(importance.self, 10), direct: num(importance.direct, 15),
              emotionMax: num(importance.emotionMax, 20), relation: num(importance.relation, 15),
              aboutMe: num(importance.aboutMe, 10), first: num(importance.first, 15),
              conflict: num(importance.conflict, 12), promise: num(importance.promise, 10),
              groupIrrelevant: num(importance.groupIrrelevant, -15),
            },
            factor: num(consolidate.factor, 1.2),
          });
        } catch {}
      };

      const set = (patch) => setForm((current) => ({ ...(current ?? {}), ...patch }));
      const setNested = (group, patch) => setForm((current) => ({ ...(current ?? {}), [group]: { ...(current?.[group] ?? {}), ...patch } }));

      const saveTuning = async () => {
        if (!form) return;
        setTuneBusy(true);
        setTuneMsg(null);
        try {
          const values = {
            base: {
              'qq-owner': Math.round(form.qqOwnerDays * DAY),
              'qq-self': Math.round(form.qqSelfDays * DAY),
              'pet-owner': Math.round(form.petOwnerDays * DAY),
              'pet-self': Math.round(form.petSelfDays * DAY),
              'bili-video': Math.round(form.biliVideoDays * DAY),
              'bili-dynamic': Math.round(form.biliDynamicDays * DAY),
              'qq-group': Math.round(form.groupHours * 60),
            },
            mult: form.mult,
            importance: form.importance,
            promote: {
              path1: { score: Math.round(form.path1Days * DAY), importance: Math.round(form.path1Imp) },
              path2: { score: Math.round(form.path2Days * DAY), importance: Math.round(form.path2Imp) },
              path3: { importance: Math.round(form.permImp) },
              bonusDays: Math.round(form.bonusDays),
              longSlots: Math.round(form.longSlots),
            },
            recall: {
              basePct: form.recall.basePct / 100,
              singleCapPct: form.recall.singleCapPct / 100,
              floor: Math.round(form.recall.floorMin),
              cooldownHours: Number(form.recall.cooldownHours),
              emotionBoost: Number(form.recall.emotionBoost),
              relationBoost: Number(form.recall.relationBoost),
            },
            tiers: {
              daily: { rate: 1 / Math.max(0.1, Number(form.dailyMinutes)), recallCapPct: Math.max(0, form.capDaily - 1) },
              long: { rate: 1 / Math.max(0.1, Number(form.longMinutes)), recallCapPct: Math.max(0, form.capLong - 1) },
            },
            caps: {
              initialCap: Math.round(form.initialCapDays * DAY),
              maxScore: Math.round(form.maxScoreYears * 365 * DAY),
            },
            consolidate: { factor: Number(form.factor) },
          };
          const data = await api('tuning', { values });
          setTuneMsg(data?.ok === false ? `保存失败：${data.error}` : '已保存。重启 DSH 后生效。');
        } catch (error) {
          setTuneMsg(`保存失败：${error?.message ?? error}`);
        } finally {
          setTuneBusy(false);
        }
      };

      const resetTuning = async () => {
        setTuneBusy(true);
        setTuneMsg(null);
        try {
          const data = await api('tuning', { reset: true });
          setTuneMsg(data?.ok === false ? `恢复失败：${data.error}` : '已恢复默认值。重启 DSH 后生效。');
          await loadTuning();
        } catch (error) {
          setTuneMsg(`恢复失败：${error?.message ?? error}`);
        } finally {
          setTuneBusy(false);
        }
      };

      React.useEffect(() => { void doLocate(''); }, []);

      const num = (label, value, onChange, unit, step) => h('div', {
        style: { display: 'flex', alignItems: 'center', gap: 6, marginRight: 14, marginTop: 6 },
      },
      h('span', { style: { fontSize: 12, opacity: 0.75, minWidth: 108 } }, label),
      h('input', {
        type: 'number', style: numInput, value: value ?? '',
        step: step ?? '0.1', min: '0',
        onChange: (e) => onChange(Number(e.target.value)),
      }),
      unit ? h('span', { style: { fontSize: 11, opacity: 0.55 } }, unit) : null);

      const section = (title, open, ...children) => h('details', { open, style: { marginTop: 8 } },
        h('summary', { style: { cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: 0.9 } }, title),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', marginTop: 2 } }, ...children));

      const bannerInfo = banner[status] ?? null;
      const applyLabel = status === 'half' ? '启用 v2' : (status === 'applied' ? '已完成' : '应用');

      return h('div', null,
        showPlan ? h('div', {
          style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
          onClick: () => setShowPlan(false),
        },
        h('img', {
          src: '/api/memory-engine/plan.svg', alt: '记忆逻辑方案图',
          style: { maxWidth: '100%', maxHeight: '100%', borderRadius: 12, boxShadow: '0 12px 48px rgba(0,0,0,.6)' },
        })) : null,

        h('div', { style: { fontSize: 15, fontWeight: 600, marginBottom: 4 } }, '记忆引擎'),
        h('div', { style: { opacity: 0.7, fontSize: 13, marginBottom: 8 } },
          '把 SurfCore 的记忆逻辑升级成“分数引擎”。只改记忆那部分，不碰其他功能。'),
        h('button', { style: { ...btn(false, false), marginBottom: 10 }, onClick: () => setShowPlan(true) }, '查看方案图'),

        bannerInfo ? h('div', { style: { ...box, borderColor: bannerInfo.border, background: bannerInfo.bg, fontWeight: 600 } }, bannerInfo.text) : null,

        h('div', { style: box },
          h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, '第 1 步 · 找到 SurfCore'),
          h('div', null, root ? `位置：${root}${version ? `（v${version}）` : ''}` : '还没定位。'),
          h('div', { style: rowStyle },
            h('button', { style: btn(!root, busy), disabled: busy, onClick: () => void doLocate('') }, '自动定位'),
            h('button', { style: btn(false, busy), disabled: busy, onClick: () => setShowManual((v) => !v) }, showManual ? '收起手动' : '手动指定'),
          ),
          showManual ? h('div', { style: rowStyle },
            h('input', { style: input, placeholder: 'SurfCore 根目录（有 src/memory-card.js 的那层）', value: manual, onChange: (e) => setManual(e.target.value) }),
            h('button', { style: btn(false, busy), disabled: busy, onClick: () => void doLocate(manual) }, '用这个路径'),
          ) : null,
        ),

        h('div', { style: box },
          h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, '第 2 步 · 校验'),
          h('div', { style: rowStyle },
            h('button', { style: btn(false, busy || !root), disabled: busy || !root, onClick: () => void doVerify() }, '校验'),
          ),
          checks.length ? h('div', { style: { marginTop: 10, fontSize: 13 } },
            checks.map((check, index) => h('div', { key: index, style: { margin: '3px 0' } },
              `${check.ok ? '✓' : '✗'} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`)),
          ) : null,
          status === 'blocked' ? h('div', { style: { marginTop: 8, fontSize: 13, color: '#e0a24a' } },
            '版本不对的话，去 SurfCore 发布页换成对应版本再试。') : null,
        ),

        h('div', { style: box },
          h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, '第 3 步 · 应用 / 回滚'),
          h('div', { style: rowStyle },
            h('button', { style: btn(true, !canApply), disabled: !canApply, onClick: () => void doApply() }, applyLabel),
            h('button', { style: btn(false, !canRollback), disabled: !canRollback, onClick: () => void doRollback() }, '回滚'),
          ),
          h('div', { style: { marginTop: 8, fontSize: 12, opacity: 0.7 } },
            !verified ? '应用和回滚都要先通过“校验”；文件改过之后也要重新校验。'
              : (status === 'applied' ? '这台机器已经是新版，不需要再应用；需要退回旧版可以点回滚。'
                : '应用前会自动备份；应用后需要重启 DSH 才生效。')),
          verifiedAt ? h('div', { style: { marginTop: 4, fontSize: 12, opacity: 0.5 } },
            `上次校验：${new Date(verifiedAt).toLocaleTimeString('zh-CN', { hour12: false })}`) : null,
        ),

        h('div', { style: box },
          h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, '数值（可选）'),
          h('div', { style: { fontSize: 12, opacity: 0.65 } }, '不填就用默认值。改完保存，重启 DSH 后生效。'),
          !verified ? h('div', { style: { fontSize: 13, opacity: 0.6, marginTop: 8 } }, '先点上面的“校验”，通过后才能调数值。')
            : (!form ? h('div', { style: { fontSize: 13, opacity: 0.6, marginTop: 8 } }, '正在读取数值…') : h('div', null,
              section('底分（按来源）', true,
                num('私聊 · 主人', form.qqOwnerDays, (v) => set({ qqOwnerDays: v }), '天', '0.5'),
                num('私聊 · 我自己', form.qqSelfDays, (v) => set({ qqSelfDays: v }), '天', '0.5'),
                num('桌宠 · 主人', form.petOwnerDays, (v) => set({ petOwnerDays: v }), '天', '0.5'),
                num('桌宠 · 我自己', form.petSelfDays, (v) => set({ petSelfDays: v }), '天', '0.5'),
                num('B站 · 视频', form.biliVideoDays, (v) => set({ biliVideoDays: v }), '天', '0.5'),
                num('B站 · 动态', form.biliDynamicDays, (v) => set({ biliDynamicDays: v }), '天', '0.5'),
                num('群聊', form.groupHours, (v) => set({ groupHours: v }), '小时', '0.5'),
              ),
              section('流速 · 上限', false,
                num('日常档流速', form.dailyMinutes, (v) => set({ dailyMinutes: v }), '1 分 = ? 分钟', '1'),
                num('长期档流速', form.longMinutes, (v) => set({ longMinutes: v }), '1 分 = ? 分钟', '1'),
                num('初始分封顶', form.initialCapDays, (v) => set({ initialCapDays: v }), '天', '1'),
                num('最久时长上限', form.maxScoreYears, (v) => set({ maxScoreYears: v }), '年', '0.5'),
              ),
              section('升档门槛 · 赠送 · 名额', false,
                num('门槛一（分数）', form.path1Days, (v) => set({ path1Days: v }), '天', '0.5'),
                num('门槛一（重要度）', form.path1Imp, (v) => set({ path1Imp: v }), '分', '1'),
                num('门槛二（分数）', form.path2Days, (v) => set({ path2Days: v }), '天', '0.5'),
                num('门槛二（重要度）', form.path2Imp, (v) => set({ path2Imp: v }), '分', '1'),
                num('赠送额度', form.bonusDays, (v) => set({ bonusDays: v }), '天', '1'),
                num('永久线（重要度）', form.permImp, (v) => set({ permImp: v }), '分', '1'),
                num('长期档名额', form.longSlots, (v) => set({ longSlots: v }), '条', '1'),
              ),
              section('加权倍率', false,
                num('你亲口说的', form.mult.owner, (v) => setNested('mult', { owner: v }), '×', '0.05'),
                num('我回过话', form.mult.replied, (v) => setNested('mult', { replied: v }), '×', '0.05'),
                num('带情绪', form.mult.emotion, (v) => setNested('mult', { emotion: v }), '×', '0.05'),
                num('关于我们', form.mult.relation, (v) => setNested('mult', { relation: v }), '×', '0.05'),
                num('第一次', form.mult.first, (v) => setNested('mult', { first: v }), '×', '0.05'),
                num('冲突 / 和好', form.mult.conflict, (v) => setNested('mult', { conflict: v }), '×', '0.05'),
                num('承诺 / 约定', form.mult.promise, (v) => setNested('mult', { promise: v }), '×', '0.05'),
              ),
              section('封顶倍率 · 加分', false,
                num('日常档封顶', form.capDaily, (v) => set({ capDaily: v }), '倍', '0.1'),
                num('长期档封顶', form.capLong, (v) => set({ capLong: v }), '倍', '0.1'),
                num('单次基础加分', form.recall.basePct, (v) => setNested('recall', { basePct: v }), '%', '1'),
                num('单次上限', form.recall.singleCapPct, (v) => setNested('recall', { singleCapPct: v }), '%', '1'),
                num('保底', form.recall.floorMin, (v) => setNested('recall', { floorMin: v }), '分钟', '10'),
                num('冷却', form.recall.cooldownHours, (v) => setNested('recall', { cooldownHours: v }), '小时', '1'),
                num('情绪加成', form.recall.emotionBoost, (v) => setNested('recall', { emotionBoost: v }), '×', '0.05'),
                num('关系加成', form.recall.relationBoost, (v) => setNested('recall', { relationBoost: v }), '×', '0.05'),
              ),
              section('重要度各项', false,
                num('底', form.importance.base, (v) => setNested('importance', { base: v }), '分', '1'),
                num('你说的', form.importance.owner, (v) => setNested('importance', { owner: v }), '分', '1'),
                num('我自己的话', form.importance.self, (v) => setNested('importance', { self: v }), '分', '1'),
                num('直接对我说', form.importance.direct, (v) => setNested('importance', { direct: v }), '分', '1'),
                num('情绪上限', form.importance.emotionMax, (v) => setNested('importance', { emotionMax: v }), '分', '1'),
                num('关于我们', form.importance.relation, (v) => setNested('importance', { relation: v }), '分', '1'),
                num('关于我自己', form.importance.aboutMe, (v) => setNested('importance', { aboutMe: v }), '分', '1'),
                num('第一次', form.importance.first, (v) => setNested('importance', { first: v }), '分', '1'),
                num('冲突 / 和好', form.importance.conflict, (v) => setNested('importance', { conflict: v }), '分', '1'),
                num('承诺 / 约定', form.importance.promise, (v) => setNested('importance', { promise: v }), '分', '1'),
                num('群聊无关', form.importance.groupIrrelevant, (v) => setNested('importance', { groupIrrelevant: v }), '分', '1'),
              ),
              section('提炼', false,
                num('提炼加成', form.factor, (v) => set({ factor: v }), '×', '0.1'),
              ),
            )),
          h('div', { style: rowStyle },
            h('button', { style: btn(false, !verified || tuneBusy || !form), disabled: !verified || tuneBusy || !form, onClick: () => void saveTuning() }, '保存数值'),
            h('button', { style: btn(false, !verified || tuneBusy), disabled: !verified || tuneBusy, onClick: () => void resetTuning() }, '恢复默认'),
          ),
          tuneMsg ? h('div', { style: { marginTop: 8, fontSize: 13 } }, tuneMsg) : null,
        ),

        msg ? h('div', { style: { ...box, borderColor: msg.kind === 'error' ? '#c0504d' : '#4a8f4a' } }, msg.text) : null,
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: 'memory-engine', order: 70, label: '记忆引擎' },
            SettingsPage,
          ),
        );
      },
    };
  },
});

