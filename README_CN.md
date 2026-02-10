# GitLab Pipelines Viewer

**中文** | [English](README.md)

---

一款轻量、快速、无冗余的 VS Code 扩展，用于**在资源管理器侧边栏内**查看和管理 GitLab CI 流水线。

本扩展面向需要以下能力的团队：

- 在侧边栏中查看最近流水线的简洁视图  
- 可展开的流水线 → 任务列表  
- 状态自动刷新  
- 一键重试 / 取消  
- 内联任务日志查看器，支持 ANSI 颜色 → HTML 渲染  
- 折叠时刷新 / 展开时刷新  
- 可选的任务 / 流水线状态变更通知  
- 无需自建后端、无需 GitLab App 注册，仅需 Personal Access Token 即可使用  

🚀 适合想要像 JetBrains IDE 那样在 VS Code 里使用「GitLab CI 面板」的开发者。

---

## ✨ 功能

### 📌 流水线列表视图
- 在**资源管理器**侧边栏中显示最新 GitLab 流水线  
- VS Code 打开期间自动刷新  
- 状态图标（成功、失败、运行中、已取消、已跳过、等待中等）  
- 点击展开流水线以查看任务列表  

### 📌 任务列表视图
- 显示流水线下的所有任务  
- 状态图标  
- 流水线运行期间自动刷新任务列表  
- 当所有任务进入终态后自动停止刷新  
- 折叠 → 清空任务缓存  
- 展开 → 重新加载最新任务列表  

### 📌 任务操作
每个任务行可显示内联图标：
- 🔁 **重试**
- ⏹ **取消/停止**
- 📄 **查看日志**

流水线同样支持上述操作。

### 📌 Webview 任务日志查看器
- 美观的 HTML 渲染  
- ANSI → HTML（完整彩色输出）  
- 运行中任务自动刷新  
- 内置工具栏：  
  - ⟳ 刷新  
  - ↗ 在浏览器中打开  
- 标题随任务状态实时更新  

### 📌 通知
在以下情况会收到 VS Code 通知：
- 流水线状态变更  
- 任务运行结束  
- 失败 / 成功 / 取消等消息  

所有通知逻辑均在扩展本地完成，无需远程服务。

### 📌 自定义脚本
- 资源管理器侧边栏中的 **Custom Scripts（自定义脚本）** 视图可列出你的 Node.js 脚本  
- **全局脚本**：存放在 `AppData/gitlab-pipelines-viewer/user-scripts/global`（对所有工作区生效）  
- **项目脚本**：按工作区存放在 `user-scripts/<工作区名>`  
- 命令：**New Global Node.js Script（新建全局 Node.js 脚本）**、**New Project Node.js Script（新建项目级 Node.js 脚本）**、**Run custom script（运行自定义脚本）**  
- 脚本需导出 `run(ctx)`；可选 `confirmPrompt`、`inputPrompt` 在执行前进行确认或输入  
- 可从命令面板（`Ctrl+Shift+P` →「GitLab Pipelines: Run custom script」）或脚本树中的「Run Script」运行  

---

## 🔧 环境要求

需要准备：
- GitLab 实例地址（如 `http://gitlab.mycompany.com`）  
- GitLab Personal Access Token  
  - 所需权限：  
    - `api` 或  
    - `read_api`  

扩展会从工作区的 `.git/config` **自动检测项目 ID**。

---

## 🛠 配置

打开 **设置 → 用户 / 工作区**，搜索 `GitLab Pipelines`。

### `gitlabPipelines.gitlabBaseUrl`
GitLab 实例根 URL。

**默认：** `https://gitlab.com`

### `gitlabPipelines.personalAccessToken`
你的 GitLab Personal Access Token（需开启 API 权限）。

---

## 📁 使用步骤

1. 在 VS Code 中打开一个 GitLab 项目  
2. 左侧资源管理器会出现 **GitLab Pipelines**  
3. 流水线会自动加载（根据 `.git/config` 检测）  
4. 展开某条流水线查看任务  
5. 点击任务可查看日志  
6. 使用内联图标重试或取消  
7. 日志在任务结束前会自动刷新  
8. 状态变化时会弹出通知  


---

## 🏗 开发

本扩展使用：
- **TypeScript**
- **esbuild**（打包，输出：`dist/extension.js`）
- **pnpm**
- **axios**（GitLab API）
- **ansi-to-html**（任务日志着色）

### 安装与构建
```bash
pnpm install
pnpm run compile
```

### 打包（vsce）
```bash
pnpm run package
```
会在项目根目录生成 `.vsix`（不捆绑外部依赖）。
