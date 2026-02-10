import * as vscode from "vscode";
import { listAllScripts, type ScriptItem } from "./scriptManager";

const GLOBAL_LABEL = "Global Scripts";
const PROJECT_LABEL = "Project Scripts";

/** Tree node: group (global/project) or single script */
export type ScriptsTreeNode = ScriptFolderNode | ScriptFileNode;

export class ScriptFolderNode {
  constructor(
    public readonly scope: "global" | "project",
    public readonly label: string
  ) {}
}

export class ScriptFileNode {
  constructor(public readonly script: ScriptItem) {}
  get path(): string {
    return this.script.path;
  }
  get label(): string {
    return this.script.label;
  }
}

export class ScriptsTreeDataProvider
  implements vscode.TreeDataProvider<ScriptsTreeNode>, vscode.Disposable
{
  private _onDidChangeTreeData = new vscode.EventEmitter<ScriptsTreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  getTreeItem(element: ScriptsTreeNode): vscode.TreeItem {
    if (element instanceof ScriptFolderNode) {
      return new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Expanded
      );
    }
    const fileNode = element as ScriptFileNode;
    const item = new vscode.TreeItem(
      fileNode.label,
      vscode.TreeItemCollapsibleState.None
    );
    item.description = fileNode.script.scope === "global" ? "Global" : "Project";
    item.resourceUri = vscode.Uri.file(fileNode.script.path);
    item.contextValue = "script";
    item.command = {
      command: "gitlabPipelines.openScript",
      title: "Open Script",
      arguments: [fileNode.script.path],
    };
    return item;
  }

  getChildren(element?: ScriptsTreeNode): ScriptsTreeNode[] {
    const all = listAllScripts();
    const globalScripts = all.filter((s) => s.scope === "global");
    const projectScripts = all.filter((s) => s.scope === "project");

    if (!element) {
      const nodes: ScriptsTreeNode[] = [];
      if (globalScripts.length > 0) {
        nodes.push(new ScriptFolderNode("global", GLOBAL_LABEL));
      }
      if (projectScripts.length > 0) {
        nodes.push(new ScriptFolderNode("project", PROJECT_LABEL));
      }
      return nodes;
    }

    if (element instanceof ScriptFolderNode) {
      const list = element.scope === "global" ? globalScripts : projectScripts;
      return list.map((s) => new ScriptFileNode(s));
    }

    return [];
  }
}
