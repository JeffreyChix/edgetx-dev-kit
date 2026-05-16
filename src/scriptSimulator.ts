import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

import { ProfileManager } from "./profileManager";
import { DiagnosticsProvider } from "./diagnosticsProvider";
import { SDCardWatcher } from "./sdCardWatcher";
import { SimulatorPanel } from "./simulatorPanel";
import { getEdgeTXConfig } from "./utils/general";
import type { ScriptContext } from "./simulatorHost";

export class ScriptSimulator {
  private watchDisposable: vscode.Disposable | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly profileManager: ProfileManager,
    private readonly diagnosticsProvider: DiagnosticsProvider,
    private readonly sdCardWatcher: SDCardWatcher,
  ) {}

  async run({ watch }: { watch: boolean }): Promise<void> {
    const profile = this.profileManager.getProfile();
    if (!profile) {
      vscode.window
        .showErrorMessage(
          "EdgeTX: Set a radio profile first before opening the simulator.",
          "Set Profile",
        )
        .then((action) => {
          if (action === "Set Profile") {
            vscode.commands.executeCommand("edgetx.setProfile");
          }
        });
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "lua") {
      SimulatorPanel.open(this.context, this.profileManager);
      return;
    }

    const { scriptKey } = this.diagnosticsProvider.detectScriptType(editor.document);
    if (scriptKey !== "widget" && scriptKey !== "telemetry") {
      SimulatorPanel.open(this.context, this.profileManager);
      return;
    }

    const sdCardPath = getEdgeTXConfig().get<string>("sdCardPath")?.trim();
    if (!sdCardPath || !fs.existsSync(sdCardPath)) {
      vscode.window
        .showErrorMessage(
          "EdgeTX: An SD card path is required to simulate scripts. Set it in settings.",
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

    const script = this.buildScriptContext(
      editor.document,
      profile,
      sdCardPath,
      scriptKey as "widget" | "telemetry",
    );
    if (!script) { return; }

    SimulatorPanel.simulateScript(this.context, this.profileManager, script);
    void this.checkReviewPrompt();

    this.watchDisposable?.dispose();
    this.watchDisposable = undefined;
    SimulatorPanel.setWatchMode(false);

    if (watch) {
      SimulatorPanel.setWatchMode(true);
      this.watchDisposable = vscode.workspace.onDidSaveTextDocument(
        async (saved) => {
          if (saved.uri.fsPath !== script.sourceFilePath) { return; }
          if (!SimulatorPanel.isOpen()) {
            this.watchDisposable?.dispose();
            this.watchDisposable = undefined;
            return;
          }
          const updatedScript = this.buildScriptContext(
            saved,
            profile,
            sdCardPath,
            script.type,
          );
          if (!updatedScript) { return; }
          SimulatorPanel.simulateScript(this.context, this.profileManager, updatedScript);
          SimulatorPanel.setWatchMode(true);
        },
      );
      this.context.subscriptions.push(this.watchDisposable);
    }
  }

  dispose(): void {
    this.watchDisposable?.dispose();
    this.watchDisposable = undefined;
  }

  // ── Review prompt ────────────────────────────────────────────────────────

  private async checkReviewPrompt(): Promise<void> {
    // Never show if the user has already reviewed or dismissed permanently
    if (this.context.globalState.get<boolean>("review.done", false)) {
      return;
    }

    const count =
      this.context.globalState.get<number>("review.simulateCount", 0) + 1;
    await this.context.globalState.update("review.simulateCount", count);

    if (count < 10) { return; }

    // Respect "Remind Me Later" delay
    const remindAfter = this.context.globalState.get<number>(
      "review.remindAfter",
      0,
    );
    if (remindAfter > 0 && Date.now() < remindAfter) { return; }

    await this.showReviewPrompt();
  }

  private async showReviewPrompt(): Promise<void> {
    const selection = await vscode.window.showInformationMessage(
      "You've simulated 10+ scripts with EdgeTX Dev Kit! 🎉 A quick review helps other developers find it.",
      "⭐ Write a Review",
      "Remind Me Later",
      "No Thanks",
    );

    if (selection === "⭐ Write a Review") {
      await vscode.env.openExternal(
        vscode.Uri.parse(
          "https://marketplace.visualstudio.com/items?itemName=jeffreychix.edgetx-dev-kit&ssr=false#review-details",
        ),
      );
      await this.context.globalState.update("review.done", true);
    } else if (selection === "Remind Me Later") {
      const remindAt = Date.now() + 14 * 24 * 60 * 60 * 1000; // 14 days
      await this.context.globalState.update("review.remindAfter", remindAt);
    } else if (selection === "No Thanks") {
      await this.context.globalState.update("review.done", true);
    }
    // undefined = dismissed via X — do nothing, will re-evaluate next time
  }

  private buildScriptContext(
    doc: vscode.TextDocument,
    profile: EdgeTXProfile,
    sdCardPath: string,
    scriptType: "widget" | "telemetry",
  ): ScriptContext | null {
    const fileName = path.basename(doc.uri.fsPath);
    try {
      if (scriptType === "widget") {
        const widgetName = this.sdCardWatcher.getWidgetName(doc, profile.version);
        const widgetDir = path.join(sdCardPath, "WIDGETS", widgetName);
        const physicalPath = path.join(widgetDir, fileName);
        fs.mkdirSync(widgetDir, { recursive: true });
        fs.copyFileSync(doc.uri.fsPath, physicalPath);

        const simAnnotation = this.parseSimulateAnnotation(doc);
        const zone = simAnnotation
          ? { layout: simAnnotation.layout, index: simAnnotation.zoneIndex }
          : undefined;

        return {
          type: "widget",
          wasiPath: `/WIDGETS/${widgetName}/${fileName}`,
          physicalPath,
          sourceFilePath: doc.uri.fsPath,
          widgetName,
          zone,
        };
      } else {
        const targetDir = path.join(sdCardPath, "SCRIPTS", "TELEMETRY");
        const physicalPath = path.join(targetDir, fileName);
        fs.mkdirSync(targetDir, { recursive: true });
        fs.copyFileSync(doc.uri.fsPath, physicalPath);
        return {
          type: "telemetry",
          wasiPath: `/SCRIPTS/TELEMETRY/${fileName}`,
          physicalPath,
          sourceFilePath: doc.uri.fsPath,
        };
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(
        `EdgeTX: Failed to deploy script — ${err.message}`,
      );
      return null;
    }
  }

  private parseSimulateAnnotation(
    doc: vscode.TextDocument,
  ): { layout: string; zoneIndex: number } | null {
    const match = doc
      .getText()
      .match(/---@simulate\s+([\w+]+)(?:\s+zone=(\d+))?(?:\s|$)/m);
    if (!match) { return null; }
    return {
      layout: match[1],
      zoneIndex: match[2] !== undefined ? parseInt(match[2], 10) : 0,
    };
  }
}
