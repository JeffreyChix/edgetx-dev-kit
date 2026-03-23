import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

import { ProfileManager } from "./profileManager";
import { SUPPORTED_RADIOS } from "./utils/supportedRadios";
import { VersionManager } from "./versionManager";
import { findVersionEntry } from "./utils/general";

export class ScriptWizard {
  constructor(
    private context: vscode.ExtensionContext,
    private profileManager: ProfileManager,
    private versionManager: VersionManager,
  ) {}

  private async formatDocument() {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await vscode.commands.executeCommand("editor.action.formatDocument");
  }

  async generateScript(scriptType: ScriptType) {
    const activeEditor = vscode.window.activeTextEditor;
    const content = this.generateCode(scriptType);

    if (activeEditor && activeEditor.document.languageId === "lua") {
      const fullRange = new vscode.Range(
        activeEditor.document.positionAt(0),
        activeEditor.document.positionAt(
          activeEditor.document.getText().length,
        ),
      );
      await activeEditor.edit((edit) => edit.replace(fullRange, content));
    } else {
      const doc = await vscode.workspace.openTextDocument({
        language: "lua",
        content,
      });
      await vscode.window.showTextDocument(doc);
    }
    await this.formatDocument();
  }

  private generateCode(scriptType: ScriptType): string {
    const profile = this.profileManager.getProfile();
    if (!profile) {
      return "";
    }
    const scriptTypes = this.versionManager.getScriptTypes(profile.version);

    const def = scriptTypes?.[scriptType];
    if (!def) {
      return "";
    }

    const entry =
      def.versions.find(findVersionEntry(profile.version)) ??
      def.versions[def.versions.length - 1];

    const typeName = `${scriptType.charAt(0).toUpperCase()}${scriptType.slice(1)}Script`;
    const annotation = def.generic
      ? `${typeName}<${def.generic.sample}>`
      : typeName;
    const scriptName = `${scriptType}Script`;

    let source = `---@type ${annotation}\n`;
    source += `local ${scriptName}\n\n`;

    for (const [name, field] of Object.entries(entry.fields)) {
      const isFunction = field.signature.startsWith("fun");
      const isString = field.signature === "string";

      if (isFunction) {
        const { formatted, returnType } = this.parseSignature(field.signature);
        const description = field.description.replace(/(\n|<br>)/g, "\n--- ");

        source += `${scriptName}.${name} = ${formatted}\n`;
        source += `--- ${description}\n`;

        if (returnType) {
          const returnSample = field.returnSample
            ? this.parseLuaTable(field.returnSample)
            : "";
          source += `\nreturn ${returnSample}\n`;
        }

        source += "\nend\n";
      } else {
        const value = isString ? '""' : "{ }";
        source += `${scriptName}.${name} = ${value}\n`;
      }

      source += "\n";
    }

    source += `\nreturn ${scriptName}`;
    return source;
  }

  private parseLuaTable(str: string): string {
    const inner = str.match(/\{(.+?)\}/)?.[1];
    if (!inner) {
      return "";
    }

    const fields = inner.split(";").map((f) => {
      const [name, type] = f.split(":").map((s) => s.trim());
      const defaultValue = type === "number" || type === "integer" ? "0" : '""';
      return `${name} = ${defaultValue}`;
    });

    return `{${fields.join(", ")}}`;
  }

  private parseSignature(signature: string): {
    formatted: string;
    returnType: string | null;
  } {
    const returnType = signature.match(/\):\s*(\w+)/)?.[1] ?? null;
    const formatted = signature
      .replace(/^fun/, "function")
      .replace(/:\s*\w+/g, "")
      .replace(/\?/g, "")
      .replace(/\).*$/, ")");
    return { formatted, returnType };
  }

  async open() {
    const profile = this.profileManager.getProfile();

    if (!profile) {
      vscode.window.showErrorMessage(
        "EdgeTX: Set a radio profile first (EdgeTX: Set Radio Profile)",
      );
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "edgetxScriptWizard",
      "EdgeTX Script Wizard",
      vscode.ViewColumn.Beside,
      { enableScripts: true },
    );

    const radio = SUPPORTED_RADIOS.find((r) => r.id === profile!.radio);
    panel.webview.html = getWizardHtml(this.context, profile, radio!.name);

    panel.webview.onDidReceiveMessage(
      async (msg) => {
        if (msg.command === "generate") {
          const { scriptType, config } = msg;

          const code = this.generateCode(scriptType);

          const workspacePath =
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (!workspacePath) {
            const doc = await vscode.workspace.openTextDocument({
              language: "lua",
              content: code,
            });

            await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
          } else {
            const fileName = `${config.name ?? `${scriptType}_script`}.lua`;
            const filePath = path.join(workspacePath, fileName);
            fs.writeFileSync(filePath, code);
            const doc = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
            vscode.window.showInformationMessage(`Generated ${fileName}`);
          }
          await this.formatDocument();

          panel.dispose();
        }
      },
      undefined,
      this.context.subscriptions,
    );
  }
}

function getWizardHtml(
  context: vscode.ExtensionContext,
  profile: EdgeTXProfile,
  radioName: string,
): string {
  const templatePath = path.join(
    context.extensionPath,
    "webview",
    "script-wizard-panel.html",
  );

  let html = fs.readFileSync(templatePath, "utf8");

  html = html.replace("<!--RADIO_NAME-->", radioName);
  html = html.replace("<!--PROFILE_VERSION-->", profile.version);

  const profileDisplayInfo = `${profile.display === "color" ? "🎨 Color" : "⬛ Non-color"} ${profile.screenWidth}×${profile.screenHeight}`;
  html = html.replace("<!--PROFILE_DISPLAY_INFO-->", profileDisplayInfo);

  return html;
}
