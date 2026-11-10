# SurfCore 版权与许可声明

本插件包含对 [SurfCore](https://github.com/Mieksido/surfcore) 的修改文件。SurfCore 采用 MIT 许可，原版权声明如下：

```
MIT License

Copyright (c) 2026 Derpyu520 and qq-bridge / QSH contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 修改文件清单

| 文件 | 改动 |
| --- | --- |
| `payload/src/decay-v2.js` | **新增**：分数寿命引擎（档位、升档、被想起加分、回忆捞回、提炼合并、数值覆盖文件读取） |
| `payload/src/memory-card.js` | 修改：入库盖章、结算、注入渲染、提炼候选、捞回入口接入新引擎 |
| `payload/plugins/surfcore/lib/memory-card.js` | 修改：对外快照增加档位 / 剩余时间字段 |

这些修改同样以 MIT 许可发布，并保留上述版权声明。原始文件来自 SurfCore v0.8.8。
