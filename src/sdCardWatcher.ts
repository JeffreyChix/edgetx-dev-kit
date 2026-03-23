import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

import { getEdgeTXConfig } from "./utils/general";
import { DiagnosticsProvider } from "./diagnosticsProvider";
import { ProfileManager } from "./profileManager";
import { EdgeTXStatusBar } from "./edgetxStatusBar";

const SCRIPT_DIRS: Record<string, string[]> = {
  widget: ["WIDGETS"],
  telemetry: ["SCRIPTS", "TELEMETRY"],
  function: ["SCRIPTS", "FUNCTIONS"],
  mix: ["SCRIPTS", "MIXES"],
  oneTime: ["SCRIPTS", "TOOLS"],
};

export class SDCardWatcher {
  private watcher?: vscode.FileSystemWatcher;

  constructor(
    private profileManager: ProfileManager,
    private statusBar: EdgeTXStatusBar,
    private diagnosticsProvider: DiagnosticsProvider,
  ) {}

  register(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (doc.languageId !== "lua") {
          return;
        }

        const autoDeployEnabled =
          getEdgeTXConfig().get<boolean>("autoDeployOnSave");
        if (!autoDeployEnabled) {
          return;
        }

        this.deploy(doc);
      }),
    );

    this.watchSdCard(context);
  }

  private watchSdCard(context: vscode.ExtensionContext) {
    const sdPath = getEdgeTXConfig().get<string>("sdCardPath");
    if (!sdPath) {
      return;
    }

    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(sdPath, "**"),
      true, // ignoreCreateEvents
      true, // ignoreChangeEvents
      false, // ignoreDeleteEvents — we care if files/folders disappear
    );

    this.watcher.onDidDelete(() => {
      if (!fs.existsSync(sdPath)) {
        vscode.window.showErrorMessage(`EdgeTX: SD card ejected`);
      }
    });

    context.subscriptions.push(this.watcher);

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("edgetx.sdCardPath")) {
          this.watcher?.dispose();
          this.watchSdCard(context);
        }
      }),
    );
  }

  async deploy(document: vscode.TextDocument) {
    const profile = this.profileManager.getProfile();

    if (!profile) {
      vscode.window.showErrorMessage(
        "EdgeTX: Set a radio profile first (EdgeTX: Set Radio Profile)",
      );
      return;
    }

    const sdPath = getEdgeTXConfig().get<string>("sdCardPath");

    if (!sdPath) {
      vscode.window
        .showWarningMessage(
          "EdgeTX: No SD card path configured.",
          "Open Settings",
        )
        .then((action) => {
          if (action === "Open Settings") {
            vscode.commands.executeCommand(
              "workbench.action.openSettings",
              "edgetx.sdCardPath",
            );
          }
        });
      return;
    }

    if (!fs.existsSync(sdPath)) {
      vscode.window.showErrorMessage(`EdgeTX: SD card not found`);
      return;
    }

    const { scriptKey } = this.diagnosticsProvider.detectScriptType(document);
    if (!scriptKey) {
      return;
    }

    const targetDir = this.getTargetDir(
      sdPath,
      scriptKey,
      document,
      profile.version,
    );
    if (!targetDir) {
      return;
    }

    if (this.hasBlockingDiagnostics(document)) {
      const action = await vscode.window.showWarningMessage(
        "EdgeTX: Script has errors. Deploy anyway?",
        "Deploy Anyway",
        "Cancel",
      );

      if (action !== "Deploy Anyway") {
        return;
      }
    }

    const fileName = path.basename(document.uri.fsPath);
    const targetPath = path.join(targetDir, fileName);

    try {
      this.statusBar.showAction("DEPLOYING_SCRIPT");
      fs.mkdirSync(targetDir, { recursive: true });
      fs.copyFileSync(document.uri.fsPath, targetPath);
      this.statusBar.refresh();
      vscode.window.showInformationMessage("EdgeTX: Script deployed ✔");
    } catch (err) {
      vscode.window.showErrorMessage(
        `EdgeTX: Failed to deploy — ${(err as Error).message}`,
      );
    }
  }

  private getTargetDir(
    sdPath: string,
    scriptType: string,
    document: vscode.TextDocument,
    profileVersion: string,
  ): string | null {
    const segments = SCRIPT_DIRS[scriptType];
    if (!segments) {
      return null;
    }

    if (scriptType === "widget") {
      const widgetName = this.getWidgetName(document, profileVersion);
      return path.join(sdPath, ...segments, widgetName);
    }

    return path.join(sdPath, ...segments);
  }

  private getWidgetName(
    document: vscode.TextDocument,
    profileVersion: string,
  ): string {
    const fallback = path.basename(document.uri.fsPath, ".lua");

    const ast = this.diagnosticsProvider.parseLuaSource(
      document.getText(),
      profileVersion,
    );

    const table = ast ? this.diagnosticsProvider.getScriptTable(ast) : null;

    if (!table) {
      return fallback;
    }

    for (const field of table.fields) {
      if (
        field.type === "TableKeyString" &&
        field.key.name === "name" &&
        field.value.type === "StringLiteral"
      ) {
        const value = this.diagnosticsProvider.stripQuotes(field.value.raw);

        // maintain widget name constraints (max 10 characters)
        return value.length === 0 || value.length > 10 ? fallback : value;
      }
    }

    return fallback;
  }

  private hasBlockingDiagnostics(document: vscode.TextDocument): boolean {
    this.diagnosticsProvider.update(document); // refresh diagnostics first

    const diagnostics = vscode.languages.getDiagnostics(document.uri);

    const errors = diagnostics.filter(
      (d) =>
        d.severity === vscode.DiagnosticSeverity.Error && d.source === "edgetx",
    );

    return errors.length > 0;
  }

  dispose() {
    this.watcher?.dispose();
  }
}
