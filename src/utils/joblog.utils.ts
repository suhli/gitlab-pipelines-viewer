import * as vscode from "vscode";
const ansiRegex = /\x1b\[(\d+)m/g;

export function parseAnsi(text: string) {
  let plain = "";
  let decorations: Array<{ color: string; range: vscode.Range }> = [];

  let currentColor = undefined;
  let index = 0;

  for (const part of text.split(ansiRegex)) {
    if (!isNaN(Number(part))) {
      // ANSI code
      const code = Number(part);
      if (code === 0) currentColor = undefined;
      else if (code === 31) currentColor = "red";
      else if (code === 32) currentColor = "green";
      else if (code === 33) currentColor = "yellow";
      else if (code === 34) currentColor = "blue";
    } else {
      const from = plain.length;
      plain += part;
      const to = plain.length;

      if (currentColor)
        decorations.push({
          color: currentColor,
          range: new vscode.Range(
            new vscode.Position(0, from),
            new vscode.Position(0, to)
          ),
        });
    }
  }

  return { plain, decorations };
}


