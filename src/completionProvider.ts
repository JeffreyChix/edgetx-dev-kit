import * as vscode from "vscode";

export class CompletionProvider implements vscode.CompletionItemProvider {
  constructor() {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] {
    const linePrefix = document
      .lineAt(position)
      .text.slice(0, position.character);

    if (!linePrefix.trimStart().startsWith("!")) {
      return [];
    }

    const snippets: { trigger: string; type: ScriptType; label: string }[] = [
      { trigger: "!w", type: "widget", label: "Widget Script" },
      { trigger: "!t", type: "telemetry", label: "Telemetry Script" },
      { trigger: "!o", type: "oneTime", label: "One Time Script" },
      { trigger: "!f", type: "function", label: "Function Script" },
      { trigger: "!m", type: "mix", label: "Mix Script" },
    ];

    return snippets.map(({ trigger, type, label }) => {
      const item = new vscode.CompletionItem(
        trigger,
        vscode.CompletionItemKind.Snippet,
      );
      item.label = trigger;
      item.detail = label;
      item.documentation = `Generate an EdgeTX ${label}`;
      item.filterText = trigger;
      item.insertText = "";

      const command = `edgetx.new${type.charAt(0).toUpperCase()}${type.slice(1)}`;

      item.command = {
        command,
        title: "Generate Script",
      };

      return item;
    });
  }
}
