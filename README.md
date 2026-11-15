# Feature Hub

**Do the work with AI. Keep what works.**  
**用 AI 把事做完，把方法留下。**

## Why it matters

1. **模型会错** — 单步再准，步骤一多也容易整单失败  
2. **错了就贵** — 真正贵的不是一次调用，而是反复重做才交付出去  
3. **宜分步、可重试** — 切成 task，坏一段修一段，别整单推倒  
4. **人定标准** — 什么叫完成、什么方法值得留下，只能人来定，再沉淀回去  

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│ ① 流水线                                                      │
│    需求  ──►  task-n  ──►  交付                               │
└───────────────────────────┬─────────────────────────────────┘
                            │ 上下文 / 能力
┌───────────────────────────▼─────────────────────────────────┐
│ ② 支撑层                                                      │
│    领域知识  │  工具箱（skills / rules / scripts）  │  代码仓   │
└─────────────────────────────────────────────────────────────┘
```

| 仓库（建议） | 作用 |
| --- | --- |
| `feature-hub`（本仓） | 产品壳：Web UI + 本地 HTTP 服务 |
| `feature-hub-knowledge` | 领域知识物料 |
| `feature-hub-toolbox` | 工具箱物料 |

## Requirements

- **Python 3.10+**（仅标准库，无需 pip 依赖）
- macOS / Linux（启动脚本为 bash；Windows 可自行用 `python3 server/hub_server.py`）
- 可选：已安装 [Cursor](https://cursor.com) CLI（设置 → Shell Command: Install `cursor` in PATH），用于「用 Cursor 打开」

## Quick start

```bash
git clone <this-repo> feature-hub
cd feature-hub

# 1) 生成本机配置（不要提交 hub.config.json）
cp hub.config.example.json hub.config.json

# 2) 编辑路径：workspace 必须已存在；archive 可先建空目录
#    推荐与物料仓对齐，例如：
#      knowledge → ~/feature-hub-knowledge
#      tools     → ~/feature-hub-toolbox
#    knowledge / tools 目录可稍后创建或 clone 物料仓后再挂
mkdir -p ~/workspace ~/feature-hub-archive

# 3) 启动（默认 http://127.0.0.1:9527 ）
./start-feature-hub.sh

# 4) 可选：重建任务索引
./build-feature-hub.sh
```

指定配置文件：

```bash
./start-feature-hub.sh /path/to/hub.config.json
```

### Demo workspace（可选）

仓库内附带最小示例任务目录，可把 `hub.config.json` 的 `workspace` 临时指到：

```text
examples/demo-workspace
```

其中包含一个示例 task，便于验证列表与阅读流程。

## Configuration

| 字段 | 说明 |
| --- | --- |
| `workspace` | 进行中的 task 根目录（**必须已存在**） |
| `archive` | 已完成 / 归档 task 目录 |
| `knowledge` | 领域知识根目录 |
| `tools` | 工具箱根目录 |
| `repoRoots` | 本地代码仓候选路径列表（可选） |
| `taskPattern` | task 目录名正则，默认 `^\d{2}-.+`（如 `01-接入支付`） |
| `host` / `port` | 服务监听地址，默认 `127.0.0.1:9527` |

任务目录约定：`编号-名称`（两位数编号）。新建 task 会生成 `main.code-workspace`（含性能向预设 settings）。

也可在 Web **设置**里修改目录路径并保存。

## Security

- 默认只监听 **`127.0.0.1`（本机）**。服务**没有登录鉴权**，能按配置读写你指定的本地目录。
- **不要**把 `host` 改成 `0.0.0.0` 或暴露到公网 / 不可信局域网。
- `hub.config.json` 含本机路径，已加入 `.gitignore`；请使用 `hub.config.example.json` 作为模板分享。

## Usage tips

- 首页：筛选全部 / 进行中 / 已完成，新建 task，刷新索引  
- 任务根：编辑 Workspace folders、用 Cursor 打开（`cursor --classic`）  
- 阅读：Markdown 目录、代码/JSON 预览；顶栏语言切换（中/EN）  
- 「用 Cursor 打开」需要本机可找到 Cursor CLI；也可在配置中设 `cursorBin`

## Layout

```text
hub.config.example.json   # 配置模板
hub.config.json           # 本机配置（不提交）
server/                   # Python HTTP API + 静态资源服务
web/                      # 前端
examples/demo-workspace/  # 最小示例 workspace
```

## License

MIT — see [LICENSE](./LICENSE).
