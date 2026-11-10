/**
 * 衰减卡 v2 引擎（纯函数 + 一份可选的数值覆盖文件）
 *
 * 设计稿：D:\deepseek工作内容存放\衰减卡-设计稿.md
 *
 * score = "按日常速度还能活多少分钟"；tier 只改变漏电速度：
 *   daily    1 分 = 1 分钟
 *   long     1 分 = 30 分钟
 *   forever  不掉
 *
 * 数值可以在 ~/.dsh/surfcore/memory-engine.json 里覆盖（设置页写的就是它）。
 * 没这个文件 / 读不懂，就用下面的默认值——所以单独试算和测试仍然成立。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MINUTE = 60 * 1000;
export const CEL = 2_628_000; // 硬天花板：5 年（分钟）
export const INITIAL_CAP = 50_000; // 初始分上限（约 35 天）

export const BASE_CONFIG = {
  base: {
    'qq-group': 30, // 半小时
    'qq-owner': 4_320, // 三天
    'qq-self': 4_320,
    'pet-owner': 2_160,
    'pet-self': 2_160,
    'bili-video': 2_880, // 两天（带情绪 ×1.5 = 三天）
    'bili-dynamic': 2_880,
    manual: Infinity, // 手写 = 永久
  },

  mult: {
    owner: 1.5, // 你亲口说的
    replied: 1.25, // 我回过话
    emotion: 1.5, // 带情绪
    relation: 1.5, // 关于我和你的关系
    first: 1.5, // 第一次
    conflict: 1.5, // 冲突 / 道歉 / 和好
    promise: 1.5, // 承诺 / 约定
  },

  importance: {
    base: 20,
    owner: 25,
    self: 10, // 我自己说的话 / 我自己做的事
    direct: 15, // 直接对我说、@我
    emotionMax: 20,
    relation: 15,
    aboutMe: 10,
    first: 15,
    conflict: 12,
    promise: 10,
    groupIrrelevant: -15,
  },

  tiers: {
    daily: { rate: 1, recallCapPct: 0.5 },
    long: { rate: 1 / 30, recallCapPct: 1.0 },
    forever: { rate: 0, recallCapPct: 0 },
  },

  promote: {
    path1: { score: 12_000, importance: 60 }, // 进长期档
    path2: { score: 6_000, importance: 80 }, // 进长期档 + 赠送 90 天
    path3: { importance: 90 }, // 直接永久
    bonusDays: 90,
    longSlots: 30,
  },

  recall: {
    basePct: 0.2,
    singleCapPct: 0.3,
    floor: 120,
    cooldownMs: 6 * 60 * MINUTE,
    emotionBoost: 1.25,
    relationBoost: 1.25,
  },

  // “睡眠式提炼”：默认只出候选，不自动压（合并要判断，交给定时器会乱炖）
  consolidate: {
    auto: false, // true = 每天自动压；false = 只生成候选清单，等我手动处理
    windowHours: 2, // 同一段对话（相同会话 + 2 小时内）
    minGroup: 3, // 至少几条才值得压
    maxGroup: 4, // 一次最多压几条
    minScore: 1440, // 门槛：还剩不到一天的碎片不压（它们本来就快忘了）
    factor: 1.2, // 压出来的比最久的那条再久两成
    maxGroupsPerDay: 3, // 候选清单最多列几组
  },

  // 上限：最久能记多久、单条初始分最高多少
  caps: {
    maxScore: CEL, // 硬天花板 2,628,000 分 = 5 年
    initialCap: INITIAL_CAP, // 初始分封顶 50,000 分 ≈ 35 天
  },
};

/** 数值覆盖文件：设置页写这里，引擎启动时读。读不懂就当没有。 */
export const OVERRIDE_FILE = path.join(os.homedir(), '.dsh', 'surfcore', 'memory-engine.json');

const LIMITS = {
  baseMin: 1,
  baseMax: 50_000,
  thresholdMin: 100,
  thresholdMax: CEL,
  factorMin: 1,
  factorMax: 3,
};

const clampNumber = (value, min, max, digits = 2) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** digits;
  return Math.round(Math.min(max, Math.max(min, number)) * factor) / factor;
};

/** 一组标量的通用清洗：只认给定键，越界夹住，可选四舍五入位数。 */
function sanitizeScalars(rawGroup, spec) {
  const out = {};
  if (!rawGroup || typeof rawGroup !== 'object') return out;
  for (const [key, [min, max, digits = 2]] of Object.entries(spec)) {
    if (rawGroup[key] === undefined) continue;
    const value = clampNumber(rawGroup[key], min, max, digits);
    if (value === null) continue;
    out[key] = digits === 0 ? Math.round(value) : value;
  }
  return out;
}

/** 只接受已知的键，数值越界会被夹住——设置页乱填也不会把记忆弄坏。 */
export function sanitizeOverride(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;

  // 底分（分钟）
  if (raw.base && typeof raw.base === 'object') {
    out.base = {};
    for (const key of ['qq-owner', 'qq-self', 'pet-owner', 'pet-self', 'bili-video', 'bili-dynamic', 'qq-group']) {
      if (raw.base[key] === undefined) continue;
      const value = clampNumber(raw.base[key], LIMITS.baseMin, LIMITS.baseMax);
      if (value !== null) out.base[key] = value;
    }
  }

  // 加权倍率
  const mult = sanitizeScalars(raw.mult, {
    owner: [0.5, 5], replied: [0.5, 5], emotion: [0.5, 5], relation: [0.5, 5],
    first: [0.5, 5], conflict: [0.5, 5], promise: [0.5, 5],
  });
  if (Object.keys(mult).length) out.mult = mult;

  // 重要度各项（整数，-50~100）
  const importance = sanitizeScalars(raw.importance, {
    base: [0, 100, 0], owner: [0, 100, 0], self: [0, 100, 0], direct: [0, 100, 0],
    emotionMax: [0, 100, 0], relation: [0, 100, 0], aboutMe: [0, 100, 0],
    first: [0, 100, 0], conflict: [0, 100, 0], promise: [0, 100, 0], groupIrrelevant: [-50, 0, 0],
  });
  if (Object.keys(importance).length) out.importance = importance;

  // 升档：两条路 + 赠送 + 名额 + 永久线
  if (raw.promote && typeof raw.promote === 'object') {
    out.promote = {};
    for (const path of ['path1', 'path2']) {
      if (!raw.promote[path] || typeof raw.promote[path] !== 'object') continue;
      out.promote[path] = { ...BASE_CONFIG.promote[path] };
      const score = clampNumber(raw.promote[path].score, LIMITS.thresholdMin, LIMITS.thresholdMax);
      if (score !== null) out.promote[path].score = Math.round(score);
      const imp = clampNumber(raw.promote[path].importance, 1, 100);
      if (imp !== null) out.promote[path].importance = Math.round(imp);
    }
    if (raw.promote.path3 && typeof raw.promote.path3 === 'object') {
      out.promote.path3 = { ...BASE_CONFIG.promote.path3 };
      const imp = clampNumber(raw.promote.path3.importance, 1, 100);
      if (imp !== null) out.promote.path3.importance = Math.round(imp);
    }
    const bonus = clampNumber(raw.promote.bonusDays, 0, 3650);
    if (bonus !== null) out.promote.bonusDays = Math.round(bonus);
    const slots = clampNumber(raw.promote.longSlots, 1, 200);
    if (slots !== null) out.promote.longSlots = Math.round(slots);
  }

  // 想起：比例、保底、冷却（小时→毫秒）、情绪/关系加成
  if (raw.recall && typeof raw.recall === 'object') {
    out.recall = sanitizeScalars(raw.recall, {
      basePct: [0.01, 1], singleCapPct: [0.01, 1], floor: [1, 10000, 0],
      emotionBoost: [0.5, 3], relationBoost: [0.5, 3],
    });
    const hours = clampNumber(raw.recall.cooldownHours, 0, 168);
    if (hours !== null) out.recall.cooldownMs = Math.round(hours * 3600 * 1000);
    if (!Object.keys(out.recall).length) delete out.recall;
  }

  // 档位：每日流速、长期流速（分钟/分）、两档封顶
  if (raw.tiers && typeof raw.tiers === 'object') {
    out.tiers = {};
    if (raw.tiers.daily && typeof raw.tiers.daily === 'object') {
      const daily = sanitizeScalars(raw.tiers.daily, { rate: [0.01, 10, 6], recallCapPct: [0, 2, 2] });
      if (Object.keys(daily).length) out.tiers.daily = daily;
    }
    if (raw.tiers.long && typeof raw.tiers.long === 'object') {
      const long = sanitizeScalars(raw.tiers.long, { rate: [0.000001, 10, 6], recallCapPct: [0, 2, 2] });
      if (Object.keys(long).length) out.tiers.long = long;
    }
    if (!Object.keys(out.tiers).length) delete out.tiers;
  }

  // 上限：最久能记多久、单条初始分最高多少
  if (raw.caps && typeof raw.caps === 'object') {
    const caps = sanitizeScalars(raw.caps, {
      maxScore: [1000, 10_000_000, 0],
      initialCap: [100, 1_000_000, 0],
    });
    if (Object.keys(caps).length) out.caps = caps;
  }

  // 提炼
  if (raw.consolidate && typeof raw.consolidate === 'object') {
    out.consolidate = {};
    const factor = clampNumber(raw.consolidate.factor, LIMITS.factorMin, LIMITS.factorMax);
    if (factor !== null) out.consolidate.factor = factor;
    const minScore = clampNumber(raw.consolidate.minScore, 60, LIMITS.thresholdMax);
    if (minScore !== null) out.consolidate.minScore = Math.round(minScore);
    if (!Object.keys(out.consolidate).length) delete out.consolidate;
  }

  return out;
}

function readOverride() {
  try {
    return sanitizeOverride(JSON.parse(fs.readFileSync(OVERRIDE_FILE, 'utf8').replace(/^\uFEFF/, '')));
  } catch {
    return {};
  }
}

function mergeConfig(base, patch) {
  const out = { ...base };
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = { ...(base[key] ?? {}), ...value };
      // promote 有两层（path1/path2），需要再合一次
      if (base[key] && typeof base[key] === 'object') {
        for (const inner of Object.keys(value)) {
          const child = value[inner];
          if (child && typeof child === 'object' && base[key][inner] && typeof base[key][inner] === 'object') {
            out[key][inner] = { ...base[key][inner], ...child };
          }
        }
      }
    } else {
      out[key] = value;
    }
  }
  return out;
}

export const CONFIG = mergeConfig(BASE_CONFIG, readOverride());

const EMOTION_WORDS = [
  '开心', '高兴', '难过', '生气', '委屈', '哭', '笑', '喜欢', '讨厌',
  '害怕', '抱歉', '对不起', '担心', '想念', '感动', '烦', '累', '谢',
];
const RELATION_WORDS = ['生日', '暗号', '约定', '鲸鱼', '名字', '称呼', '见面', '相遇'];
const CONFLICT_WORDS = ['抱歉', '对不起', '吵架', '生气', '难过', '哭', '和好', '原谅'];
const PROMISE_WORDS = ['说好', '答应', '以后', '下次', '保证'];
const ABOUT_ME_WORDS = ['我是', '我想', '我的', '我来', '我自己'];
// 粘贴 / 转述别人的话：里面的情绪和关系词不算在这条消息自己的分量上
const QUOTE_MARKERS = ['复制', '转发', '他说', '她说', '以下是', '原文', '贴一段', '贴过来'];

function hits(text, words) {
  const s = String(text ?? '');
  return words.some((word) => s.includes(word));
}

export function detectEmotion(text) {
  const s = String(text ?? '');
  let score = 0;
  for (const word of EMOTION_WORDS) if (s.includes(word)) score += 4;
  return Math.min(20, score);
}

/** 从一条记录里抽特征。迁移和入库共用这一份。 */
export function features(record = {}) {
  const text = `${record.title ?? ''} ${record.text ?? ''}`;
  const tags = Array.isArray(record.tags) ? record.tags : [];
  const source = String(record.source ?? '');
  const isOwner = source === 'qq-owner' || source === 'pet-owner' || tags.includes('owner');
  const isSelf = record.isSelf === true;
  const reply = String(record.botReply ?? '').trim();
  const quoted = hits(text, QUOTE_MARKERS);
  return {
    source,
    isOwner,
    isSelf,
    quoted,
    replied: reply.length >= 20,
    direct: isOwner || record.direct === true || tags.includes('direct'),
    // 转述别人的话时，情绪、“关于我们”和“关于我自己”都不算：
    // 那段文字不是我的经历，是别人说的（2026-11-10 用户反馈：“我给你复制一段”被抬成高重要度）
    emotion: quoted ? 0 : Math.max(Number(record.emotional) || 0, detectEmotion(text)),
    relation: quoted ? false : (hits(text, RELATION_WORDS) || tags.includes('mutual')),
    // 只有真正标记过 firstMet 的才算“第一次”；isInitial 是“最初三十天”，不是同一个概念
    first: record.firstMet === true,
    conflict: quoted ? false : (record.kind === 'conflict' || hits(text, CONFLICT_WORDS)),
    promise: quoted ? false : (record.kind === 'promise' || hits(text, PROMISE_WORDS)),
    aboutMe: isSelf || (!quoted && hits(text, ABOUT_ME_WORDS)),
    groupOnly: source === 'qq-group' && !isOwner,
    manual: record.manual === true || source === 'manual',
    pinned: record.pinned === true,
  };
}

export function initialScore(record, config = CONFIG) {
  const f = features(record);
  if (f.manual || f.pinned) return { score: Infinity, factors: ['手写/置顶 → 永久'] };

  const base = config.base[f.source] ?? config.base['qq-group'];
  if (!Number.isFinite(base)) return { score: Infinity, factors: ['来源标为永久'] };

  const factors = [];
  let score = base;
  const apply = (on, key, label) => {
    if (!on) return;
    score *= config.mult[key];
    factors.push(label);
  };
  apply(f.isOwner, 'owner', '你亲口说的');
  apply(f.replied, 'replied', '我回过话');
  apply(f.emotion > 0, 'emotion', '带情绪');
  apply(f.relation, 'relation', '关于我和你的关系');
  apply(f.first, 'first', '第一次');
  apply(f.conflict, 'conflict', '冲突/和好');
  apply(f.promise, 'promise', '承诺');

  score = Math.min(Math.round(score), config.caps?.initialCap ?? INITIAL_CAP);
  return { score, factors };
}

export function importanceOf(record, config = CONFIG) {
  const f = features(record);
  if (f.manual || f.pinned) return { score: 100, parts: ['手写/置顶'] };

  const c = config.importance;
  const parts = [`底 ${c.base}`];
  let score = c.base;
  const add = (on, value, label) => {
    if (!on) return;
    score += value;
    parts.push(`${label} +${value}`);
  };
  add(f.isOwner, c.owner, '你说的');
  add(f.isSelf && !f.isOwner, c.self, '我自己的话');
  add(f.direct, c.direct, '直接对我说');
  if (f.emotion > 0) {
    score += f.emotion;
    parts.push(`情绪 +${f.emotion}`);
  }
  add(f.relation, c.relation, '关于我们');
  add(f.aboutMe, c.aboutMe, '关于我自己');
  add(f.first, c.first, '第一次');
  add(f.conflict, c.conflict, '冲突/和好');
  add(f.promise, c.promise, '承诺');
  if (f.groupOnly) {
    score += c.groupIrrelevant;
    parts.push(`群聊无关 ${c.groupIrrelevant}`);
  }
  return { score: Math.max(0, Math.min(100, Math.round(score))), parts };
}

export function tierRate(tier, config = CONFIG) {
  return (config.tiers[tier] ?? config.tiers.daily).rate;
}

/** 过了 elapsedMs 掉多少分。关机也照算。 */
export function decayedScore(score, tier, elapsedMs, config = CONFIG) {
  if (!Number.isFinite(score)) return score;
  const minutes = Math.max(0, elapsedMs) / MINUTE;
  return Math.max(0, score - minutes * tierRate(tier, config));
}

/** 剩余多少分钟。 */
export function remainingMinutes(score, tier, config = CONFIG) {
  if (tier === 'forever' || !Number.isFinite(score)) return Infinity;
  const rate = tierRate(tier, config) || 1;
  return Math.max(0, score) / rate;
}

export function promoteTier({ peakScore, importance, manual }, config = CONFIG) {
  if (manual) return 'forever';
  const p = config.promote;
  if (importance >= p.path3.importance) return 'forever';
  if (peakScore >= p.path1.score && importance >= p.path1.importance) return 'long';
  if (peakScore >= p.path2.score && importance >= p.path2.importance) return 'long';
  return null;
}

export function promotionBonusDays({ peakScore, importance }, config = CONFIG) {
  const p = config.promote;
  if (importance >= p.path3.importance) return 0;
  if (peakScore >= p.path2.score && importance >= p.path2.importance) return p.bonusDays;
  return 0;
}

/** 想起一次能加多少分。 */
export function recallGain(record, { now = Date.now(), config = CONFIG } = {}) {
  const f = features(record);
  const c = config.recall;
  const tier = record.tier ?? 'daily';
  if (tier === 'forever') return { gain: 0, rejected: 'permanent' };
  if (!Number.isFinite(record.initial)) return { gain: 0, rejected: 'permanent' };

  const last = Number(record.lastRecallAt) || 0;
  if (last && now - last < c.cooldownMs) {
    const left = Math.ceil((c.cooldownMs - (now - last)) / MINUTE);
    return { gain: 0, rejected: `cooldown:${left}` };
  }

  let factor = 1;
  if (f.emotion > 0) factor *= c.emotionBoost;
  if (f.relation) factor *= c.relationBoost;

  const raw = record.initial * c.basePct * factor;
  const gain = Math.min(record.initial * c.singleCapPct, Math.max(c.floor, raw));

  const capPct = (config.tiers[tier] ?? config.tiers.daily).recallCapPct;
  const capTotal = record.initial * (1 + capPct);
  const already = Number(record.totalGain) || 0;
  const room = capTotal - (record.initial + already);
  if (room <= 0) return { gain: 0, rejected: 'capped' };

  return { gain: Math.min(gain, room), rejected: null };
}

/** 分数 → 人话。 */
export function humanRemaining(score, tier = 'daily', config = CONFIG) {
  if (tier === 'forever' || !Number.isFinite(score)) return '永久';
  const minutes = remainingMinutes(score, tier, config);
  if (minutes <= 0) return '已遗忘';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = Math.floor(minutes % 60);
  if (days > 0) return `${days} 天${hours ? ` ${hours} 小时` : ''}`;
  if (hours > 0) return `${hours} 小时${mins ? ` ${mins} 分` : ''}`;
  return `${mins} 分钟`;
}

export const TIER_LABEL = { daily: '日常', long: '长期', forever: '永久' };

export function withConfig(patch = {}, base = CONFIG) {
  const out = { ...base };
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = { ...(base[key] ?? {}), ...value };
    } else {
      out[key] = value;
    }
  }
  return out;
}

