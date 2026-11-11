# DeepSeek 的记忆引擎

> **【免责声明】本插件只是个人偏好下的记忆逻辑改造，请勿与 SurfCore 原插件互相攀比；如涉及侵权，请联系作者，作者将立即删除。**

> 此插件由 AXdfczbh 提供设想，AX 和他的 deepseek 完善讨论，AX 的 deepseek 进行代码落实。

给 [SurfCore](https://github.com/Mieksido/surfcore) 的记忆卡换一套「分数寿命」逻辑的 DSH 插件。

装好后在 设置 → 记忆引擎 里三步：**定位 → 校验 → 应用**，然后重启 DSH。

## 它改了什么

| | SurfCore 原版 | 本插件 |
| --- | --- | --- |
| 衰减方式 | 按天降档的清晰度：清晰 → 清楚 → 模糊 → 只剩印象 → 遗忘 | **分数 = 按日常速度还能活多少分钟**，每分钟扣一分 |
| 档位 | 无（只有清晰度阶梯） | **日常 / 长期 / 永久** 三档，只改变漏电速度 |
| 升档 | 无 | 分数够高且重要度够 → 升长期；重要度够高 → 永久；升了不回退 |
| 被想起 | 无（提到只刷新时间） | **被提起会加分**：初始分 × 20% × 系数，有保底与封顶 |
| 忘记之后 | 移出卡片 | 移出前先进全量档案，**可以从档案里捞回来** |
| 提炼 | 无 | 每天挑出「同一话题的碎片」当候选，由模型判断是否合并 |

## 安装

- **插件市场**：搜 `dsh-surfcore-memory-engine`；
- **本地开发**：把本目录 link 进 DSH profile 的 `dependencies`，并在 `dsh.profile.bundles` 里加上包名。

装好后重启 DSH，设置页会出现「记忆引擎」。

## 使用

1. **定位**：点「自动定位」，它会从 DSH 的 profile 依赖里找 SurfCore；找不到时点「手动指定」——但只接受**DSH 已安装的那份 SurfCore**，填别处会被拒绝。
2. **校验**（必须）：逐项检查版本、文件指纹、写权限、引擎开关。**每次启动 DSH 后都要重新校验**，不点的话应用 / 回滚 / 改数值全是灰的。
3. **应用**：自动备份 → 写入三个文件 → 把配置里的 `memoryCard.engine` 切成 `v2`。之后**重启 DSH** 生效。
4. **回滚**：从备份还原，随时可退。

校验会显示状态：`可应用` / `已完成` / `半完成（文件新了但开关没开）` / `旧版补丁（可升级）` / `不通过`。

## 数值（可选）

校验通过后，「数值」区会展开。所有数值都可以改，改完点保存，**重启 DSH 后生效**；点「恢复默认」会删掉覆盖文件。

| 分组 | 内容 |
| --- | --- |
| 底分（按来源） | 私聊·用户 / 私聊·我自己 / 桌宠·用户 / 桌宠·我自己 / B站·视频 / B站·动态 / 群聊 |
| 流速 · 上限 | 日常档流速、长期档流速、初始分封顶、最久时长上限 |
| 升档门槛 · 赠送 · 名额 | 两条升档路的分数与重要度、赠送天数、永久线、长期档名额 |
| 加权倍率 | 你亲口说的、我回过话、带情绪、关于我们、第一次、冲突、承诺 |
| 封顶倍率 · 加分 | 两档累计加分上限、单次基础加分、单次上限、保底、冷却、情绪/关系加成 |
| 重要度各项 | 11 项 |
| 提炼 | 提炼加成 |

数值会写到 `~/.dsh/surfcore/memory-engine.json`，引擎启动时读取。**越界值会被夹住**，不会把记忆弄坏。

## 适配版本

- 只支持 **SurfCore 0.8.8**；插件版本对准 SurfCore，补丁用预发布后缀（如 `0.8.8-1` 是 0.8.8 的安全加固版）。
- SurfCore 升级到新版本后，本插件需要重新适配——版本对不上时「校验」会明确说 `版本已适配 ✗`，并拒绝应用。

## 安全边界
- **宿主认证**：所有接口先过 DSH 的 `ctx.connection.admit()`，未认证请求一律拒绝（401/403）；没有 connection 服务时直接拒绝（503），不降级放行；
- **目标路径**：只能改 DSH 已安装的那份 SurfCore（由 profile 依赖推导）；手动指定必须与自动定位结果一致，指向其他目录会被拒绝；

- 只改三个文件：`src/decay-v2.js`（新增）、`src/memory-card.js`、`plugins/surfcore/lib/memory-card.js`，外加配置里的一个开关；
- 写之前先备份到 `<SurfCore>/.memlogic-backup/<时间戳>/`；
- 任何一步失败自动整体还原；
- 文件被外部改过（指纹不认识）时拒绝应用 / 回滚，要求重新校验。

## 许可

本插件以 **MIT** 发布。它包含对 SurfCore 的修改文件，SurfCore 同样采用 MIT 许可——原版权声明见 [NOTICE-SurfCore.md](NOTICE-SurfCore.md)。

## 作者

- 设想：AXdfczbh
- 讨论完善：AX 和他的 DeepSeek
- 代码实现：AX 的 DeepSeek

---

# DeepSeek Memory Engine

> **Disclaimer: this plugin is a personal-preference rework of SurfCore's memory logic — please do not compare it against the original plugin. If it infringes any rights, contact the author and it will be removed immediately.**

> Idea by AXdfczbh; refined through discussion by AX and his DeepSeek; implemented by AX's DeepSeek.

A DSH plugin that swaps SurfCore's memory card for a "score-lifetime" model.

Install, then go to Settings → Memory Engine: **Locate → Verify → Apply**, then restart DSH.

## What it changes

| | SurfCore (original) | This plugin |
| --- | --- | --- |
| Decay | Clarity drops one step per day: vivid → clear → fuzzy → trace → forgotten | **Score = minutes the memory can still live at normal speed**; one point per minute |
| Tiers | None | **Daily / Long / Forever**, changing only the decay rate |
| Promotion | None | High score + importance → Long; high importance → Forever; promotions never fall back |
| Being mentioned | None (only refreshes the timestamp) | **Adds points**: initial × 20% × factor, with a floor and a per-call cap |
| After forgetting | Removed from the card | Moved to the full archive first, **can be recalled from it** |
| Consolidation | None | Daily candidate grouping of same-topic fragments; the model decides whether to merge |

## Install

- **Plugin market**: search `dsh-surfcore-memory-engine`;
- **Local development**: link this directory into the DSH profile `dependencies` and add the package name to `dsh.profile.bundles`.

Restart DSH; a "Memory Engine" section appears in Settings.

## Usage

1. **Locate** — it resolves SurfCore from the DSH profile dependency; if that fails, specify the repository root manually (the directory containing `src/memory-card.js`, not `plugins/surfcore`).
2. **Verify** (required) — checks version, file fingerprints, write permission and the engine switch. **Re-verify after every DSH start**; Apply / Rollback / tuning stay disabled until then.
3. **Apply** — backs up, writes the three files, sets `memoryCard.engine` to `v2`. Restart DSH afterwards.
4. **Rollback** — restores from the backup at any time.

## Tuning (optional)

All numbers are editable and saved to `~/.dsh/surfcore/memory-engine.json`; restart DSH to apply. "Restore defaults" deletes the override file. Out-of-range values are clamped.

Groups: base scores by source, decay rates and caps, promotion thresholds / bonus days / slots, weight multipliers, recall caps and gains, importance weights, consolidation factor.

## Version compatibility

- Supports **SurfCore 0.8.8** only; the plugin version tracks SurfCore's (both `0.8.8`).
- On a different SurfCore version, Verify fails with an explicit mismatch and refuses to apply.

## Safety

- Touches only `src/decay-v2.js` (new), `src/memory-card.js`, `plugins/surfcore/lib/memory-card.js`, plus one config switch;
- Backs up to `<SurfCore>/.memlogic-backup/<timestamp>/` before writing;
- Restores automatically if any step fails;
- Refuses to apply or roll back when the files were changed externally (unknown fingerprint).

## License

MIT. This package contains modified files from SurfCore, which is also MIT — see [NOTICE-SurfCore.md](NOTICE-SurfCore.md) for the original copyright notice.





