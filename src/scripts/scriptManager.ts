import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

const SCRIPTS_DIR_NAME = "user-scripts";
const GLOBAL_DIR_NAME = "global";

/** Script export interface: user script must export run; optional confirmPrompt / inputPrompt */
export interface UserScriptExports {
  /** Entry point; ctx includes vscode, workspace path, confirm result, input values, etc. */
  run: (ctx: ScriptRunContext) => void | Promise<void>;
  /** Optional: confirmation prompt text before execution */
  confirmPrompt?: string;
  /** Optional: input prompt(s) before execution, single or array */
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
  /** If confirmPrompt exists, true after user clicks OK */
  confirmResult?: boolean;
  /** If inputPrompt exists, user input values in order */
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

/** Scripts root: AppData/gitlab-pipelines-viewer/user-scripts */
export function getScriptsRoot(): string {
  return path.join(getAppDataRoot(), "gitlab-pipelines-viewer", SCRIPTS_DIR_NAME);
}

export function getGlobalScriptsDir(): string {
  return path.join(getScriptsRoot(), GLOBAL_DIR_NAME);
}

function sanitizeProjectName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "default";
}

/** Project scripts dir for current workspace (undefined if no folder open) */
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

/** List .js files in the given scripts directory */
function listScriptsInDir(dir: string, scope: "global" | "project"): ScriptItem[] {
  const items: ScriptItem[] = [];
  if (!fs.existsSync(dir)) return items;
  const scopeLabel = scope === "global" ? "Global" : "Project";
  try {
    const files = fs.readdirSync(dir);
    for (const f of files) {
      if (f.endsWith(".js") && !f.startsWith(".")) {
        const name = path.basename(f, ".js");
        items.push({
          label: name,
          description: `${scopeLabel} script · ${path.join(dir, f)}`,
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

/** List all available scripts: global first, then project */
export function listAllScripts(): ScriptItem[] {
  const globalDir = getGlobalScriptsDir();
  const projectDir = getProjectScriptsDir();
  const globalItems = listScriptsInDir(globalDir, "global");
  const projectItems = projectDir ? listScriptsInDir(projectDir, "project") : [];
  return [...globalItems, ...projectItems];
}

/** Create script directory if needed and write default content; return created file path */
export async function createScript(
  scope: "global" | "project",
  scriptName: string
): Promise<string> {
  const sanitized = scriptName.replace(/[\\/:*?"<>|]/g, "_").trim();
  if (!sanitized) {
    throw new Error("Script name cannot be empty");
  }
  const fileName = sanitized.endsWith(".js") ? sanitized : `${sanitized}.js`;
  let dir: string;
  if (scope === "global") {
    dir = getGlobalScriptsDir();
  } else {
    const projectDir = getProjectScriptsDir();
    if (!projectDir) {
      throw new Error("Please open a workspace folder first to create a project-level script");
    }
    dir = projectDir;
  }
  ensureDir(dir);
  const filePath = path.join(dir, fileName);
  if (fs.existsSync(filePath)) {
    throw new Error(`Script already exists: ${filePath}`);
  }
  const template = getDefaultScriptTemplate();
  fs.writeFileSync(filePath, template, "utf8");
  return filePath;
}

function getDefaultScriptTemplate(): string {
  return `/**
 * Custom script - run via Ctrl+Shift+P -> "GitLab Pipelines: Run custom script"
 *
 * Optional exports:
 * - confirmPrompt: string  Confirmation dialog text before execution
 * - inputPrompt: { prompt, default?, password? } or array  Input dialog(s) before execution
 * - run(ctx): main logic
 *   ctx.vscode, ctx.workspaceRoot, ctx.workspaceName, ctx.scriptPath, ctx.scope
 *   ctx.confirmResult, ctx.inputValues (if confirm/input are used)
 */
module.exports = {
  // Example: confirm before execution
  // confirmPrompt: 'Are you sure you want to run this?',
  // Example: prompt for input
  // inputPrompt: { prompt: 'Enter branch name', default: 'main' },
  run: async (ctx) => {
    const vscode = ctx.vscode;
    await vscode.window.showInformationMessage('Script ran: ' + ctx.scriptPath);
  },
};
`;
}

/** Run user script: load, confirm/input if needed, then run */
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
    await vscode.window.showErrorMessage(`Failed to load script: ${msg}`);
    return;
  }

  if (typeof mod.run !== "function") {
    await vscode.window.showErrorMessage("Script does not export a run function");
    return;
  }

  if (mod.confirmPrompt) {
    const choice = await vscode.window.showWarningMessage(
      mod.confirmPrompt,
      { modal: true },
      "OK",
      "Cancel"
    );
    if (choice !== "OK") return;
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
      if (value === undefined) return; // user cancelled
      inputValues.push(value);
    }
    ctx.inputValues = inputValues;
  }

  try {
    await Promise.resolve(mod.run(ctx));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await vscode.window.showErrorMessage(`Script execution failed: ${msg}`);
  }
}
