# GitLab Pipelines Viewer

A lightweight, fast, no-bloat VS Code extension for viewing and managing GitLab CI pipelines **directly inside the Explorer sidebar**.

This extension is designed for teams who want:

- A simple sidebar view of recent pipelines  
- Expandable pipeline → jobs list  
- Auto-refreshing statuses  
- One-click retry / cancel  
- Inline job log viewer with ANSI color → HTML rendering  
- Refresh-on-collapse / refresh-on-expand  
- Optional notifications on job / pipeline state changes  
- Zero backend, zero GitLab App registration — works with just a Personal Access Token

🚀 Perfect for developers who want “GitLab CI panel” like JetBrains IDEs, but built in VS Code.

---

## ✨ Features

### 📌 Pipeline List View
- Shows the latest GitLab pipelines in the **Explorer** sidebar  
- Auto-refreshing while VS Code is open  
- Status icons (success, failed, running, canceled, skipped, pending, etc.)  
- Click to expand pipelines and reveal job list  

### 📌 Job List View
- Shows all jobs for a pipeline  
- Status icons  
- Auto-refresh while pipeline is running  
- Auto-stop refresh when all jobs reach a final state  
- Collapse → reset job cache  
- Expand → reload fresh job list  

### 📌 Job Actions
Each job row can show inline icons:
- 🔁 **Retry**
- ⏹ **Cancel/Stop**
- 📄 **View logs**

Same actions available for pipelines.

### 📌 Webview Job Log Viewer
- Pretty HTML rendering  
- ANSI → HTML (full color output)  
- Auto-refresh for running jobs  
- Toolbar inside webview:  
  - ⟳ Refresh  
  - ↗ Open in browser  
- Title updates live with job status  

### 📌 Notifications
Get VS Code notifications when:
- A pipeline changes state  
- A job finishes running  
- Fail / Success / Cancel messages  

All notification logic is local to the extension — no remote services needed.

---

## 🔧 Requirements

You need:
- A GitLab instance URL (like `http://gitlab.mycompany.com`)
- A GitLab Personal Access Token  
  - Required scopes:  
    - `api` or  
    - `read_api`

The extension **auto-detects project ID** from your workspace's `.git/config`.

---

## 🛠 Configuration

Open **Settings → User / Workspace** and search `GitLab Pipelines`.

### `gitlabPipelines.gitlabBaseUrl`
Your GitLab instance root URL.

**Default:** `https://gitlab.com`

### `gitlabPipelines.personalAccessToken`
Your GitLab Personal Access Token (API enabled).

---

## 📁 How to Use

1. Open a GitLab project in VS Code  
2. The left Explorer sidebar will show **GitLab Pipelines**  
3. Pipelines load automatically (detected by `.git/config`)  
4. Expand a pipeline to view jobs  
5. Click a job to see logs  
6. Use inline icons to retry or cancel  
7. Logs auto-refresh until job finishes  
8. Notifications appear on status change  

---

## 🖥 Screenshots

> _(Insert your own screenshots later)_  
> - Pipelines panel  
> - Jobs list  
> - Job log webview  
> - Notifications  

---

## 🏗 Development

The extension uses:
- **TypeScript**
- **esbuild** (fast bundling)
- **pnpm**
- **axios**
- **ansi-to-html**

### Install deps
```bash
pnpm install
