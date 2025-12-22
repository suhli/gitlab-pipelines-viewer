import * as vscode from "vscode";
import {
  GitLabJob,
  GitLabJobItem,
  GitLabPipelineItem,
  GitLabPipelinesProvider,
} from "./providers/pipeline.provider";
import axios from "axios";
import AnsiToHtml from "ansi-to-html";
import { FINISHED_STATUSES } from "./constants";
const REFRESH_INTERVAL_MS = 10000;
function getJobLogHtml(message: string, bodyHtml: string): string {
  const infoBlock = message
    ? `<div class="message">${escapeHtml(message)}</div>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      background-color: #1e1e1e;
      color: #cccccc;
      font-family: Consolas, "Courier New", monospace;
      font-size: 12px;
      overflow: hidden; /* 外层不滚动 */
    }
    .container {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .toolbar {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 8px;
      background: #252526;
      border-bottom: 1px solid #333;
    }
    .toolbar-left {
      font-size: 11px;
      color: #cccccc;
      opacity: 0.8;
    }
    .toolbar-right button {
      background: transparent;
      border: none;
      color: #cccccc;
      cursor: pointer;
      padding: 2px 6px;
      margin-left: 4px;
    }
    .toolbar-right button:hover {
      background: #3a3d41;
    }
    .toolbar-right button span {
      margin-left: 2px;
      font-size: 11px;
    }
    .message-container {
      flex: 0 0 auto;
    }
    .message {
      margin: 4px 8px;
      color: #ffcc00;
    }
    .log-container {
      flex: 1 1 auto;
      overflow: auto;        /* 只让 log 区域滚动 */
      padding: 4px 8px 8px;
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="toolbar">
      <div class="toolbar-left">
        Job log
      </div>
      <div class="toolbar-right">
        <button id="btnRefresh" title="Refresh log">⟳<span>Refresh</span></button>
        <button id="btnOpenBrowser" title="Open in browser">↗<span>Browser</span></button>
      </div>
    </div>

    <div class="message-container">
      ${infoBlock}
    </div>

    <div class="log-container">
      <pre id="log-root">${bodyHtml}</pre>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const logContainer = document.querySelector('.log-container');
    function scrollToBottom() {
      if (!logContainer) return;
      // 用 requestAnimationFrame 确保 DOM 布局完成后再滚
      requestAnimationFrame(() => {
        logContainer.scrollTop = logContainer.scrollHeight;
      });
    }

    // 打开页面时自动滚到最底
    window.addEventListener('load', () => {
      scrollToBottom();
    });

    document.getElementById('btnRefresh')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });

    document.getElementById('btnOpenBrowser')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'openInBrowser' });
    });
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
export function activate(context: vscode.ExtensionContext) {
  const provider = new GitLabPipelinesProvider(context);

  const treeView = vscode.window.createTreeView("gitlabPipelinesView", {
    treeDataProvider: provider,
  });
  context.subscriptions.push(
    vscode.commands.registerCommand("gitlabPipelines.refresh", () =>
      provider.refresh()
    )
  );
  context.subscriptions.push(provider, treeView);

  treeView.onDidCollapseElement((e) => {
    const element = e.element;
    if (element instanceof GitLabPipelineItem) {
      provider.onPipelineCollapsed(element.pipeline.id);
    }
  });

  // ====== Job: Retry ======
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "gitlabPipelines.retryJob",
      async (item: GitLabJobItem) => {
        const job = item.job;
        const { baseUrl, token, projectId } = provider.getGitLabConfig();
        if (!baseUrl || !token) {
          vscode.window.showWarningMessage(
            "gitlabPipelines.gitlabBaseUrl / personalAccessToken 未配置"
          );
          return;
        }

        let projId = projectId;
        if (!projId) {
          projId = await provider.detectProjectIdPublic();
          if (!projId) {
            vscode.window.showErrorMessage(
              "Failed to determine GitLab Project ID."
            );
            return;
          }
        }

        const cleanBase = baseUrl.replace(/\/$/, "");
        const url = `${cleanBase}/api/v4/projects/${projId}/jobs/${job.id}/retry`;

        try {
          await axios.post(
            url,
            {},
            {
              headers: { "PRIVATE-TOKEN": token },
            }
          );
          vscode.window.showInformationMessage(
            `Retry job #${job.id} (${job.name}) success.`
          );
          provider.refresh();
        } catch (err: any) {
          vscode.window.showErrorMessage(
            `Retry job failed: ${err?.message ?? String(err)}`
          );
        }
      }
    )
  );

  // ====== Job: Cancel ======
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "gitlabPipelines.cancelJob",
      async (item: GitLabJobItem) => {
        const job = item.job;
        const { baseUrl, token, projectId } = provider.getGitLabConfig();
        if (!baseUrl || !token) {
          vscode.window.showWarningMessage(
            "gitlabPipelines.gitlabBaseUrl / personalAccessToken 未配置"
          );
          return;
        }

        let projId = projectId;
        if (!projId) {
          projId = await provider.detectProjectIdPublic();
          if (!projId) {
            vscode.window.showErrorMessage(
              "Failed to determine GitLab Project ID."
            );
            return;
          }
        }

        const cleanBase = baseUrl.replace(/\/$/, "");
        const url = `${cleanBase}/api/v4/projects/${projId}/jobs/${job.id}/cancel`;

        try {
          await axios.post(
            url,
            {},
            {
              headers: { "PRIVATE-TOKEN": token },
            }
          );
          vscode.window.showInformationMessage(
            `Cancel job #${job.id} (${job.name}) success.`
          );
          provider.refresh();
        } catch (err: any) {
          vscode.window.showErrorMessage(
            `Cancel job failed: ${err?.message ?? String(err)}`
          );
        }
      }
    )
  );

  // ====== Pipeline: Retry ======
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "gitlabPipelines.retryPipeline",
      async (item: GitLabPipelineItem) => {
        const pipeline = item.pipeline;
        const { baseUrl, token, projectId } = provider.getGitLabConfig();
        if (!baseUrl || !token) {
          vscode.window.showWarningMessage(
            "gitlabPipelines.gitlabBaseUrl / personalAccessToken 未配置"
          );
          return;
        }

        let projId = projectId;
        if (!projId) {
          projId = await provider.detectProjectIdPublic();
          if (!projId) {
            vscode.window.showErrorMessage(
              "Failed to determine GitLab Project ID."
            );
            return;
          }
        }

        const cleanBase = baseUrl.replace(/\/$/, "");
        const url = `${cleanBase}/api/v4/projects/${projId}/pipelines/${pipeline.id}/retry`;

        try {
          await axios.post(
            url,
            {},
            {
              headers: { "PRIVATE-TOKEN": token },
            }
          );
          vscode.window.showInformationMessage(
            `Retry pipeline #${pipeline.id} success.`
          );
          provider.refresh();
        } catch (err: any) {
          vscode.window.showErrorMessage(
            `Retry pipeline failed: ${err?.message ?? String(err)}`
          );
        }
      }
    )
  );

  // ====== Pipeline: Cancel ======
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "gitlabPipelines.cancelPipeline",
      async (item: GitLabPipelineItem) => {
        const pipeline = item.pipeline;
        const { baseUrl, token, projectId } = provider.getGitLabConfig();
        if (!baseUrl || !token) {
          vscode.window.showWarningMessage(
            "gitlabPipelines.gitlabBaseUrl / personalAccessToken 未配置"
          );
          return;
        }

        let projId = projectId;
        if (!projId) {
          projId = await provider.detectProjectIdPublic();
          if (!projId) {
            vscode.window.showErrorMessage(
              "Failed to determine GitLab Project ID."
            );
            return;
          }
        }

        const cleanBase = baseUrl.replace(/\/$/, "");
        const url = `${cleanBase}/api/v4/projects/${projId}/pipelines/${pipeline.id}/cancel`;

        try {
          await axios.post(
            url,
            {},
            {
              headers: { "PRIVATE-TOKEN": token },
            }
          );
          vscode.window.showInformationMessage(
            `Cancel pipeline #${pipeline.id} success.`
          );
          provider.refresh();
        } catch (err: any) {
          vscode.window.showErrorMessage(
            `Cancel pipeline failed: ${err?.message ?? String(err)}`
          );
        }
      }
    )
  );

  const jobPanels = new Map<
    number,
    { panel: vscode.WebviewPanel; timer: NodeJS.Timeout | undefined }
  >();
  //jobs panel
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "gitlabPipelines.showJobLog",
      async (job: GitLabJob) => {
        const { baseUrl, token, projectId } = provider.getGitLabConfig();
        if (!baseUrl || !token) {
          vscode.window.showWarningMessage(
            "gitlabPipelines.gitlabBaseUrl / personalAccessToken 未配置"
          );
          return;
        }

        const cleanBase = baseUrl.replace(/\/$/, "");

        // 已经有 panel 就直接聚焦，不重复创建
        const existing = jobPanels.get(job.id);
        if (existing) {
          existing.panel.reveal(vscode.ViewColumn.Active);
          return;
        }

        let projId = projectId;
        if (!projId) {
          projId = await provider.detectProjectIdPublic();
          if (!projId) {
            vscode.window.showErrorMessage(
              "Failed to determine GitLab Project ID."
            );
            return;
          }
        }

        const panel = vscode.window.createWebviewPanel(
          "gitlabJobLog",
          `Job #${job.id} · ${job.name} [${job.status}]`,
          vscode.ViewColumn.Active,
          { enableScripts: true, retainContextWhenHidden: true }
        );

        panel.webview.html = getJobLogHtml("Loading job log...", "");

        const converter = new AnsiToHtml({
          fg: "#cccccc",
          bg: "#1e1e1e",
          newline: true,
          escapeXML: true,
        });

        let currentStatus = job.status;
        let timer: NodeJS.Timeout | undefined;

        const fetchAndRender = async () => {
          try {
            const jobUrl = `${cleanBase}/api/v4/projects/${projId}/jobs/${job.id}`;
            const traceUrl = `${cleanBase}/api/v4/projects/${projId}/jobs/${job.id}/trace`;

            // 并行请求：job 信息 + log
            const [jobRes, traceRes] = await Promise.all([
              axios.get<GitLabJob>(jobUrl, {
                headers: { "PRIVATE-TOKEN": token },
              }),
              axios.get<string>(traceUrl, {
                headers: { "PRIVATE-TOKEN": token },
                responseType: "text",
              }),
            ]);

            const latestJob = jobRes.data;
            currentStatus = latestJob.status;

            const rawLog = traceRes.data || "(empty job log)";
            const body = converter.toHtml(rawLog);

            panel.title = `Job #${job.id} · ${job.name} [${currentStatus}]`;
            panel.webview.html = getJobLogHtml("", body);

            // 如果 job 已经终结，停止自动刷新并刷新一下 Tree
            if (FINISHED_STATUSES.has(currentStatus)) {
              if (timer) {
                clearInterval(timer);
                timer = undefined;
                const info = jobPanels.get(job.id);
                if (info) info.timer = undefined;
              }
              // 刷新一下 Tree，让 job 状态更新
              provider.refresh();
            }
          } catch (err: any) {
            panel.webview.html = getJobLogHtml(
              `Failed to load job log: ${err?.message ?? String(err)}`,
              ""
            );
          }
        };

        panel.webview.onDidReceiveMessage(async (msg) => {
          if (msg?.type === "refresh") {
            await vscode.window.withProgress(
              {
                location: vscode.ProgressLocation.Notification,
                title: `Refreshing job #${job.id}…`,
                cancellable: false,
              },
              async () => {
                await fetchAndRender(); // 你原来的刷新逻辑
              }
            );

            // await fetchAndRender();
          } else if (msg?.type === "openInBrowser") {
            // 直接打开 GitLab 的 job 页
            vscode.env.openExternal(vscode.Uri.parse(job.web_url));
          }
        });

        // 先拉一次
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Refreshing job #${job.id}…`,
            cancellable: false,
          },
          async () => {
            await fetchAndRender(); // 你原来的刷新逻辑
          }
        );

        // 只有“非终结状态”的 job 才开启自动刷新
        if (!FINISHED_STATUSES.has(currentStatus)) {
          timer = setInterval(fetchAndRender, REFRESH_INTERVAL_MS);
        }

        jobPanels.set(job.id, { panel, timer });

        // panel 关闭时清理 timer & map
        panel.onDidDispose(() => {
          const info = jobPanels.get(job.id);
          if (info?.timer) clearInterval(info.timer);
          jobPanels.delete(job.id);
        });
      }
    )
  );
}

export function deactivate() {}
