# 上传到 GitHub（手动上传指南）

> 目标仓库：**https://github.com/sheng456/work**
> 该仓库当前只有 1 个提交（`1769bf1` Initial commit）和 1 个 `README.md`，是空仓库状态。

---

## 1. 必须先知道的三个坑

### 坑 1：不要整目录拖拽

项目根目录下有 `node_modules/`（数千个文件）和 `packages/dsh-plugin/node_modules/`。
在 GitHub 网页上**直接把项目文件夹拖进去，会把这些依赖一起上传**，导致：

- 文件数远超浏览器单次上传上限（约 100 个/次）；
- 仓库被数万个第三方文件污染；
- 部分文件超过 25 MB 限制。

**`.gitignore` 只对 `git push` 生效，对网页拖拽上传无效。**

### 坑 2：`work` 仓库已有提交，直接 push 会被拒

`work` 里已有一个 Initial commit（README），与本项目的提交历史**没有共同祖先**。
用 git push 需要先合并历史，否则报 `non-fast-forward` / `unrelated histories`。

### 坑 3：Line ending

Windows 工作区的换行是 CRLF，而 Biome 格式化要求 LF。
本仓库已补 `.gitattributes`（`* text=auto eol=lf`）来统一，**请把它一起上传**，否则别人 checkout 后跑 `npm run lint` 会大面积失败。

---

## 2. 要上传的目录/文件（包含清单）

按 GitHub 上的目录结构，**根路径下需要有这些**：

```
# ── 根目录文件（共 12 个，已逐一核实存在）──
package.json
package-lock.json
tsconfig.json
tsconfig.build.json
vitest.config.ts
biome.json
README.md
LICENSE
SECURITY.md
AGENTS.md
.gitignore
.gitattributes        ← 本次新增，务必上传

# ── 根目录文件夹（共 8 个）──
.github/              → workflows/ci.yml
src/                  → 服务端与业务逻辑（server / application / browser / domain ...）
test/                 → vitest 测试
docs/                 → 设计文档与规格（含 superpowers/specs/）
extension/            → Chrome MV3 侧边栏（Vue 3 + Vite）
scripts/              → 本地启动脚本
skills/               → boss-conversation-watch/SKILL.md

# ── 插件子包 ──
packages/dsh-plugin/
  ├─ package.json
  ├─ pnpm-lock.yaml
  ├─ pnpm-workspace.yaml
  ├─ tsconfig.json
  ├─ tsdown.config.mjs
  ├─ cordis.patch.yml
  ├─ README.md        （若存在）
  ├─ scripts/         → 打包辅助脚本
  ├─ src/             → 插件服务端 + 客户端（含 tools.ts / skill.ts / resume-*.ts）
  └─ test/            → 插件测试（含 fixtures/）
```

## 3. 绝对不能上传的路径（排除清单）

```
node_modules/
packages/dsh-plugin/node_modules/
dist/
packages/dsh-plugin/lib/
coverage/
output/
tmp/
vendor/
graphify-out/
.env*                    ← 任何环境变量文件
*.sqlite / *.sqlite3     ← 本地事实库
*.sqlite3-shm / *.sqlite3-wal
*.log
.DS_Store
```

> 这些也正是 `.gitignore` 中已声明的规则。上传前请确认它们**没有**出现在上传列表里。

---

## 4. 两种手动上传方式

### 方式 A（推荐）：GitHub Desktop

它**自动遵守 `.gitignore`**，是手动操作里最省事、最不容易传错的方式。

1. 安装 GitHub Desktop，登录 `sheng456` 账号。
2. `File → Add local repository`，选择本机项目目录。
3. 它会提示「这不是一个 GitHub 仓库或需要发布」——
   由于该目录已经是 git 仓库且远程指向别处，建议：
   `Repository → Repository settings → Remote` 里把 **Primary remote repository** 改为
   `https://github.com/sheng456/work.git`；
   或者先 `Repository → Add remote` 添加名为 `work` 的远程，再推送到 `work`。
4. 在 Changes 面板确认**变更列表里没有 node_modules / dist**（有就说明 `.gitignore` 失效，先停下排查）。
5. 填写提交说明 → `Commit to main` → `Push origin`。

> 若被 `non-fast-forward` 拒绝：先 `Repository → Fetch origin`，
> 然后 `Branch → Merge into current branch` 选 `work/main`，处理 README 冲突（保留本项目 211 行的版本），再推送。

### 方式 B：GitHub 网页逐个上传

1. 打开 https://github.com/sheng456/work
2. `Add file → Upload files`
3. **一次只拖一个顶层文件夹或其子集**（单次约 100 个文件上限），按上面第 2 节顺序分批：
   先根目录的单个文件 → 再 `src/` → `test/` → `docs/` → `extension/` → `scripts/` →
   最后 `packages/dsh-plugin/` 下的各子目录。
4. 每批都填一个提交说明并 `Commit changes`。
5. 全部传完后，在仓库首页确认：
   - **看不到 `node_modules/`**
   - 根目录有 `.gitattributes`、`.gitignore`、LICENSE、README.md
   - `packages/dsh-plugin/src/tools.ts` 存在

> 注意：网页上传**无法删除目录**，所以一次传错（比如把 node_modules 传上去）很难清理，务必在第 3 步前核对。

---

## 5. 上传完成后的自检

| 检查项 | 期望 |
| --- | --- |
| 仓库根目录 | 有 `package.json` / `README.md` / `LICENSE` / `.gitignore` / `.gitattributes` |
| 是否混入依赖 | **不应**出现 `node_modules/` |
| 是否混入构建产物 | **不应**出现 `dist/` 或 `packages/dsh-plugin/lib/` |
| 是否混入本地数据 | **不应**出现 `*.sqlite3` 或 `.env` |
| 文件总数（受版本控制） | 约 **350+**（不含依赖与产物） |
| README 渲染 | 首页能显示 CI 徽章与 MIT 徽章 |

上传完成后，如果你的机器能直连 GitHub，也可以在本地用 git 校验：

```bash
git remote add work https://github.com/sheng456/work.git
git fetch work
git log --oneline work/main | head
git ls-tree -r --name-only work/main | grep -c node_modules   # 期望输出 0
```

---

## 6. 本项目已知的 CI 注意事项

- CI 在 `.github/workflows/ci.yml` 中把 DeepSeek Harness 钉在 `141eb6fe…` 这个提交上。
- 本项目的**客户端 UI** 是为**本机较新版本**的 harness 适配的，在钉定版本下可能无法通过 typecheck/build。
- 另外 6 个 `feishu-client` 测试依赖外部 `lark` CLI，若 CI 环境没有安装会失败。

如果 CI 变红，优先看这两类，而不是代码逻辑问题。
