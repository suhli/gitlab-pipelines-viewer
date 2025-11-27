import * as vscode from "vscode";
import axios from "axios";
import * as path from "path";
import * as fs from "fs";
import { isFinishedStatus } from "../constants";

export interface GitLabPipeline {
  id: number;
  status: string;
  ref: string;
  web_url: string;
  created_at: string;
}

export interface GitLabJob {
  id: number;
  name: string;
  stage: string;
  status: string;
  web_url: string;
  started_at?: string;
  finished_at?: string;
}

function getStatusIcon(status: string): vscode.ThemeIcon {
  const s = status.toLowerCase();

  // success = 绿色
  if (s === "success") {
    return new vscode.ThemeIcon(
      "circle-filled",
      new vscode.ThemeColor("charts.green") // VSCode 内置绿色
    );
  }

  // failed = 红色
  if (s === "failed") {
    return new vscode.ThemeIcon(
      "circle-filled",
      new vscode.ThemeColor("charts.red")
    );
  }

  // running = 蓝色
  if (s === "running") {
    return new vscode.ThemeIcon(
      "circle-filled",
      new vscode.ThemeColor("charts.blue")
    );
  }

  // pending = 黄色
  if (s === "pending") {
    return new vscode.ThemeIcon(
      "circle-filled",
      new vscode.ThemeColor("charts.yellow")
    );
  }

  // cancel / canceled / skipped = 灰色
  if (s === "cancel" || s === "canceled" || s === "skipped") {
    return new vscode.ThemeIcon(
      "circle-filled",
      new vscode.ThemeColor("disabledForeground") // 比较灰
    );
  }

  // 其他未知状态
  return new vscode.ThemeIcon("circle-outline");
}

export class GitLabPipelineItem extends vscode.TreeItem {
  constructor(public readonly pipeline: GitLabPipeline) {
    super(
      `#${pipeline.id} [${pipeline.status}]`,
      vscode.TreeItemCollapsibleState.Collapsed
    );

    this.description = `${pipeline.ref} · ${new Date(
      pipeline.created_at
    ).toLocaleString()}`;
    this.tooltip = this.pipeline.web_url;
    this.iconPath = getStatusIcon(pipeline.status);

    const s = pipeline.status.toLowerCase();
    if (isFinishedStatus(s)) {
      this.contextValue = "gitlabPipelineFinished";
    } else if (s === "running" || s === "pending") {
      this.contextValue = "gitlabPipelineRunning";
    } else {
      this.contextValue = "gitlabPipelineOther";
    }
  }
}

export class GitLabJobItem extends vscode.TreeItem {
  constructor(public readonly job: GitLabJob) {
    super(`${job.name} [${job.status}]`, vscode.TreeItemCollapsibleState.None);

    const time = job.finished_at ?? job.started_at ?? "";
    if (time) {
      this.description = `${job.stage} · ${new Date(time).toLocaleString()}`;
    } else {
      this.description = job.stage;
    }

    this.tooltip = this.job.web_url;
    this.iconPath = getStatusIcon(job.status);

    const s = job.status.toLowerCase();
    if (isFinishedStatus(s)) {
      this.contextValue = "gitlabJobFinished";
    } else if (s === "running" || s === "pending") {
      this.contextValue = "gitlabJobRunning";
    } else {
      this.contextValue = "gitlabJobOther";
    }

    this.command = {
      command: "gitlabPipelines.showJobLog",
      title: "Show Job Log",
      arguments: [this.job],
    };
  }
}

type GitLabTreeItem = GitLabPipelineItem | GitLabJobItem;
export class GitLabPipelinesProvider
  implements vscode.TreeDataProvider<GitLabTreeItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    GitLabTreeItem | undefined | void
  > = new vscode.EventEmitter<GitLabTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<
    GitLabTreeItem | undefined | void
  > = this._onDidChangeTreeData.event;

  private projectId: number | null = null;
  private pipelineRefreshTimer: NodeJS.Timeout | undefined;
  private readonly PIPELINE_REFRESH_INTERVAL_MS = 10000;

  // 展开的 pipeline 下有未结束 job 时刷新 jobs
  private jobRefreshTimer: NodeJS.Timeout | undefined;
  private readonly JOB_REFRESH_INTERVAL_MS = 5000;
  private jobRefreshingPipelines = new Set<number>(); // 需要刷 jobs 的 pipeline id
  private jobCache = new Map<number, GitLabJobItem[]>(); // pipelineId -> jobs 缓存

  // 记录上一次的状态
  private pipelineStatusMap = new Map<number, string>(); // pipelineId -> lastStatus
  private jobStatusMap = new Map<number, string>(); // jobId -> lastStatus
  private jobPipelineMap = new Map<number, number>(); // jobId -> pipelineId

  constructor(private context: vscode.ExtensionContext) {}
  getGitLabConfig() {
    const config = vscode.workspace.getConfiguration("gitlabPipelines");
    const baseUrl = config.get<string>("gitlabBaseUrl") || "";
    const token = config.get<string>("personalAccessToken") || "";

    return {
      baseUrl,
      token,
      projectId: this.projectId,
    };
  }

  async detectProjectIdPublic(): Promise<number | null> {
    const config = vscode.workspace.getConfiguration("gitlabPipelines");
    const baseUrl = config.get<string>("gitlabBaseUrl") || "";
    const token = config.get<string>("personalAccessToken") || "";

    if (!baseUrl || !token) {
      return null;
    }

    this.projectId = await this.detectProjectId(baseUrl, token);
    return this.projectId;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: GitLabTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: GitLabTreeItem): Promise<GitLabTreeItem[]> {
    const config = vscode.workspace.getConfiguration("gitlabPipelines");
    const baseUrl = config.get<string>("gitlabBaseUrl") || "";
    const token = config.get<string>("personalAccessToken") || "";

    if (!baseUrl || !token) {
      vscode.window.showWarningMessage(
        "Please configure gitlabPipelines.gitlabBaseUrl and personalAccessToken."
      );
      return [];
    }

    if (!this.projectId) {
      this.projectId = await this.detectProjectId(baseUrl, token);
      if (!this.projectId) {
        vscode.window.showErrorMessage(
          "Failed to determine GitLab Project ID."
        );
        return [];
      }
    }

    // 根节点：pipelines，始终从 API 拉 & 启动 pipeline 定时器
    if (!element || element instanceof GitLabPipelineItem === false) {
      this.ensurePipelineTimer();
      return this.fetchPipelines(baseUrl, token, this.projectId);
    }

    // 子节点：pipeline 下面加载 jobs
    if (element instanceof GitLabPipelineItem) {
      const pipelineId = element.pipeline.id;

      // 如果这个 pipeline 当前不在“自动刷新列表”里并且已有缓存 → 直接用缓存（不再打 API）
      const cached = this.jobCache.get(pipelineId);
      if (!this.jobRefreshingPipelines.has(pipelineId) && cached) {
        return cached;
      }

      const items = await this.fetchJobs(
        baseUrl,
        token,
        this.projectId,
        pipelineId
      );

      // 更新缓存
      this.jobCache.set(pipelineId, items);
      return items;
    }

    return [];
  }

  private async fetchPipelines(
    baseUrl: string,
    token: string,
    projectId: number
  ): Promise<GitLabPipelineItem[]> {
    const cleanBase = baseUrl.replace(/\/$/, "");
    const url = `${cleanBase}/api/v4/projects/${projectId}/pipelines`;

    try {
      const res = await axios.get<GitLabPipeline[]>(url, {
        headers: {
          "PRIVATE-TOKEN": token,
        },
        params: {
          per_page: 20,
          order_by: "id",
          sort: "desc",
        },
      });

      const pipelines = res.data;
      // ✅ 检测状态变化并推送通知
      this.handlePipelineStatusChanges(pipelines);
      return pipelines.map((p) => new GitLabPipelineItem(p));
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to load pipelines: ${err}`);
      return [];
    }
  }

  private async fetchJobs(
    baseUrl: string,
    token: string,
    projectId: number,
    pipelineId: number
  ): Promise<GitLabJobItem[]> {
    const cleanBase = baseUrl.replace(/\/$/, "");
    const url = `${cleanBase}/api/v4/projects/${projectId}/pipelines/${pipelineId}/jobs`;

    try {
      const res = await axios.get<GitLabJob[]>(url, {
        headers: {
          "PRIVATE-TOKEN": token,
        },
      });

      const jobs = res.data;
      const hasUnfinished = jobs.some((j) => !isFinishedStatus(j.status));

      if (hasUnfinished) {
        // 这个 pipeline 有未完成 job → 加入自动刷新集合
        this.jobRefreshingPipelines.add(pipelineId);
        this.ensureJobTimer();
      } else {
        // 所有 job 都完成 → 不再为这个 pipeline 刷新 jobs
        this.jobRefreshingPipelines.delete(pipelineId);
      }

      for (const j of jobs) {
        this.jobPipelineMap.set(j.id, pipelineId);
      }
      // ✅ 检测 job 状态变化并推送通知
      this.handleJobStatusChanges(jobs, pipelineId);
      return jobs.map((j) => new GitLabJobItem(j));
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to load jobs: ${err}`);
      return [];
    }
  }

  /** 自动从 .git/config 推导 project id */
  private async detectProjectId(
    base: string,
    token: string
  ): Promise<number | null> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return null;

    const gitConfigPath = path.join(folder.uri.fsPath, ".git", "config");
    if (!fs.existsSync(gitConfigPath)) return null;

    const configContent = fs.readFileSync(gitConfigPath, "utf8");

    const match = configContent.match(/url\s*=\s*(.+)/);
    if (!match) return null;

    const remoteUrl = match[1].trim();

    const projectPath = this.extractProjectPath(remoteUrl);
    if (!projectPath) return null;

    try {
      const encoded = encodeURIComponent(projectPath);
      const apiUrl = `${base.replace(/\/$/, "")}/api/v4/projects/${encoded}`;

      const res = await axios.get(apiUrl, {
        headers: {
          "PRIVATE-TOKEN": token,
        },
      });

      return res.data.id;
    } catch (err) {
      vscode.window.showErrorMessage(
        `GitLab API project lookup failed: ${err}`
      );
      return null;
    }
  }

  /** 从 remote URL 解析出 group/project  */
  private extractProjectPath(remoteUrl: string): string | null {
    // 1. SSH: git@git.i.txcombo.com:group/subgroup/project.git
    //        或者其他类似 user@host:group/project(.git)
    const ssh = remoteUrl.match(/^[\w.-]+@[^:]+:(.+?)(?:\.git)?$/);
    if (ssh) {
      return ssh[1];
    }

    // 2. HTTP/HTTPS:
    //    http://git.i.txcombo.com/group/subgroup/project.git
    //    https://git.i.txcombo.com:8080/group/project.git
    //    https://user:token@git.i.txcombo.com/group/project.git
    const http = remoteUrl.match(
      /^https?:\/\/(?:[^@\/]+@)?[^\/:]+(?::\d+)?\/(.+?)(?:\.git)?$/
    );
    if (http) {
      return http[1];
    }

    return null;
  }

  private ensurePipelineTimer() {
    if (this.pipelineRefreshTimer) return;
    this.pipelineRefreshTimer = setInterval(() => {
      this.refresh(); // 触发根节点 & 已展开节点重算
    }, this.PIPELINE_REFRESH_INTERVAL_MS);
  }

  private ensureJobTimer() {
    if (this.jobRefreshTimer) return;
    this.jobRefreshTimer = setInterval(() => {
      // 没有需要刷的 pipeline 就啥也不干
      if (this.jobRefreshingPipelines.size === 0) {
        return;
      }
      this.refresh(); // 触发展开的 pipeline 重新 getChildren
    }, this.JOB_REFRESH_INTERVAL_MS);
  }

  onPipelineCollapsed(pipelineId: number) {
    // 清缓存
    this.jobCache.delete(pipelineId);
    this.jobRefreshingPipelines.delete(pipelineId);

    // 🔥 清 jobStatusMap + jobPipelineMap（只删除属于此 pipeline 的 job）
    for (const [jobId, pId] of this.jobPipelineMap.entries()) {
      if (pId === pipelineId) {
        this.jobPipelineMap.delete(jobId);
        this.jobStatusMap.delete(jobId);
      }
    }

    // 没 job 需要刷新了，关闭 timer
    if (this.jobRefreshingPipelines.size === 0 && this.jobRefreshTimer) {
      clearInterval(this.jobRefreshTimer);
      this.jobRefreshTimer = undefined;
    }
  }

  dispose() {
    if (this.pipelineRefreshTimer) {
      clearInterval(this.pipelineRefreshTimer);
      this.pipelineRefreshTimer = undefined;
    }
    if (this.jobRefreshTimer) {
      clearInterval(this.jobRefreshTimer);
      this.jobRefreshTimer = undefined;
    }
  }

  private handlePipelineStatusChanges(pipelines: GitLabPipeline[]) {
    for (const p of pipelines) {
      const prev = this.pipelineStatusMap.get(p.id);
      const curr = p.status;
      this.pipelineStatusMap.set(p.id, curr);

      // 第一次看到（没有 prev）就不提示，避免一打开就刷一堆
      if (!prev || prev === curr) continue;

      // 只在进入“结束状态”时提示，避免 running/pending 来回抖动
      if (!isFinishedStatus(curr)) continue;

      this.notifyPipelineStatusChange(p, prev);
    }
  }

  private notifyPipelineStatusChange(
    pipeline: GitLabPipeline,
    prevStatus: string
  ) {
    const curr = pipeline.status.toLowerCase();
    const msg = `Pipeline #${pipeline.id} ${prevStatus} → ${pipeline.status} (${pipeline.ref})`;

    if (curr === "success") {
      vscode.window.showInformationMessage(msg);
    } else if (curr === "failed") {
      vscode.window.showErrorMessage(msg);
    } else if (curr === "canceled" || curr === "cancelled") {
      vscode.window.showWarningMessage(msg);
    } else if (curr === "skipped" || curr === "manual") {
      vscode.window.showInformationMessage(msg);
    } else {
      vscode.window.showInformationMessage(msg);
    }
  }

  private handleJobStatusChanges(jobs: GitLabJob[], pipelineId: number) {
    for (const j of jobs) {
      const prev = this.jobStatusMap.get(j.id);
      const curr = j.status;
      this.jobStatusMap.set(j.id, curr);

      if (!prev || prev === curr) continue;

      // 一样，只在 job 进入结束状态时提示
      if (!isFinishedStatus(curr)) continue;

      this.notifyJobStatusChange(j, prev, pipelineId);
    }
  }

  private notifyJobStatusChange(
    job: GitLabJob,
    prevStatus: string,
    pipelineId: number
  ) {
    const curr = job.status.toLowerCase();
    const msg = `Job ${job.name} (#${job.id}, pipeline #${pipelineId}) ${prevStatus} → ${job.status}`;

    if (curr === "success") {
      vscode.window.showInformationMessage(msg);
    } else if (curr === "failed") {
      vscode.window.showErrorMessage(msg);
    } else if (curr === "canceled" || curr === "cancelled") {
      vscode.window.showWarningMessage(msg);
    } else if (curr === "skipped" || curr === "manual") {
      vscode.window.showInformationMessage(msg);
    } else {
      vscode.window.showInformationMessage(msg);
    }
  }
}
