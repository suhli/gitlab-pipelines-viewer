import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

const SCRIPTS_DIR_NAME = "user-scripts";
const GLOBAL_DIR_NAME = "global";

/** 脚本导出接口：用户脚本需 export run，可选 export confirmPrompt / inputPrompt */
export interface UserScriptExports {
  /** 执行入口，ctx 包含 vscode、工作区路径、确认结果、输入值等 */
  run: (ctx: ScriptRunContext) => void | Promise<void>;
  /** 可选：执行前二次确认的提示文案 */
  confirmPrompt?: string;
  /** 可选：执行前需要用户输入的项，单条或数组 */
  inputPrompt?:
    | { prompt: string; default?: string; password?: boolean }
    | Array<{ prompt: string; default?: string; password?: boolean }>;
}

export interface ScriptRunContext {
  vscode: typeof vscode;
  workspaceRoot: string | undefined;
  workspaceName: string | undefined;
  scriptPath: string;
  scope: "global" | "project";
  /** 若存在 confirmPrompt，用户点击确定后为 true */
  confirmResult?: boolean;
  /** 若存在 inputPrompt，按顺序对应的用户输入值 */
  inputValues?: string[];
}

export interface ScriptItem {
  label: string;
  description: string;
  path: string;
  scope: "global" | "project";
}

function getAppDataRoot(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (process.platform === "win32" && process.env.APPDATA) {
    return process.env.APPDATA;
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support");
  }
  return path.join(home, ".config");
}

/** 脚本根目录：AppData/gitlab-pipelines-viewer/user-scripts */
export function getScriptsRoot(): string {
  return path.join(getAppDataRoot(), "gitlab-pipelines-viewer", SCRIPTS_DIR_NAME);
}

export function getGlobalScriptsDir(): string {
  return path.join(getScriptsRoot(), GLOBAL_DIR_NAME);
}

function sanitizeProjectName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "default";
}

/** 当前工作区对应的项目脚本目录名（未打开文件夹则返回 undefined） */
export function getProjectScriptsDir(): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return undefined;
  const name = sanitizeProjectName(folder.name);
  return path.join(getScriptsRoot(), name);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** 列举全局脚本目录下的 .js 文件 */
function listScriptsInDir(dir: string, scope: "global" | "project"): ScriptItem[] {
  const items: ScriptItem[] = [];
  if (!fs.existsSync(dir)) return items;
  const scopeLabel = scope === "global" ? "全局" : "项目";
  try {
    const files = fs.readdirSync(dir);
    for (const f of files) {
      if (f.endsWith(".js") && !f.startsWith(".")) {
        const name = path.basename(f, ".js");
        items.push({
          label: name,
          description: `${scopeLabel}脚本 · ${path.join(dir, f)}`,
          path: path.join(dir, f),
          scope,
        });
      }
    }
  } catch {
    // ignore
  }
  return items;
}

/** 列举所有可用脚本：先全局，再项目 */
export function listAllScripts(): ScriptItem[] {
  const globalDir = getGlobalScriptsDir();
  const projectDir = getProjectScriptsDir();
  const globalItems = listScriptsInDir(globalDir, "global");
  const projectItems = projectDir ? listScriptsInDir(projectDir, "project") : [];
  return [...globalItems, ...projectItems];
}

/** 创建脚本文件所在目录并写入默认内容，返回创建的文件路径 */
export async function createScript(
  scope: "global" | "project",
  scriptName: string
): Promise<string> {
  const sanitized = scriptName.replace(/[\\/:*?"<>|]/g, "_").trim();
  if (!sanitized) {
    throw new Error("脚本名不能为空");
  }
  const fileName = sanitized.endsWith(".js") ? sanitized : `${sanitized}.js`;
  let dir: string;
  if (scope === "global") {
    dir = getGlobalScriptsDir();
  } else {
    const projectDir = getProjectScriptsDir();
    if (!projectDir) {
      throw new Error("请先打开一个工作区文件夹以创建项目级脚本");
    }
    dir = projectDir;
  }
  ensureDir(dir);
  const filePath = path.join(dir, fileName);
  if (fs.existsSync(filePath)) {
    throw new Error(`脚本已存在: ${filePath}`);
  }
  const template = getDefaultScriptTemplate();
  fs.writeFileSync(filePath, template, "utf8");
  return filePath;
}

function getDefaultScriptTemplate(): string {
  return `/**
 * 自定义脚本 - 可通过 Ctrl+Shift+P -> "GitLab Pipelines: Run custom script" 运行
 *
 * 可选导出：
 * - confirmPrompt: string  执行前弹出确认框的文案
 * - inputPrompt: { prompt, default?, password? } 或 数组  执行前弹出输入框
 * - run(ctx): 主逻辑
 *   ctx.vscode, ctx.workspaceRoot, ctx.workspaceName, ctx.scriptPath, ctx.scope
 *   ctx.confirmResult, ctx.inputValues (若配置了 confirm/input)
 */
module.exports = {
  // 示例：执行前二次确认
  // confirmPrompt: '确定要执行此操作吗？',
  // 示例：执行前要求输入
  // inputPrompt: { prompt: '请输入分支名', default: 'main' },
  run: async (ctx) => {
    const vscode = ctx.vscode;
    await vscode.window.showInformationMessage('脚本已运行: ' + ctx.scriptPath);
  },
};
`;
}

/** 执行用户脚本：加载、确认/输入、再执行 run */
export async function runScript(
  scriptPath: string,
  scope: "global" | "project"
): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name;
  const ctx: ScriptRunContext = {
    vscode,
    workspaceRoot,
    workspaceName,
    scriptPath,
    scope,
  };

  // 清除 require 缓存以便每次运行使用最新文件
  const fullPath = path.resolve(scriptPath);
  delete require.cache[fullPath];

  let mod: UserScriptExports;
  try {
    mod = require(fullPath) as UserScriptExports;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await vscode.window.showErrorMessage(`加载脚本失败: ${msg}`);
    return;
  }

  if (typeof mod.run !== "function") {
    await vscode.window.showErrorMessage("脚本未导出 run 函数");
    return;
  }

  if (mod.confirmPrompt) {
    const choice = await vscode.window.showWarningMessage(
      mod.confirmPrompt,
      { modal: true },
      "确定",
      "取消"
    );
    if (choice !== "确定") return;
    ctx.confirmResult = true;
  }

  const inputPrompt = mod.inputPrompt;
  if (inputPrompt) {
    const arr = Array.isArray(inputPrompt) ? inputPrompt : [inputPrompt];
    const inputValues: string[] = [];
    for (const item of arr) {
      const value = await vscode.window.showInputBox({
        prompt: item.prompt,
        value: item.default,
        password: item.password,
      });
      if (value === undefined) return; // 用户取消
      inputValues.push(value);
    }
    ctx.inputValues = inputValues;
  }

  try {
    await Promise.resolve(mod.run(ctx));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await vscode.window.showErrorMessage(`脚本执行失败: ${msg}`);
  }
}
