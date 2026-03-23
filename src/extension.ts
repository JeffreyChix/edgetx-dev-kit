import * as vscode from "vscode";

import { EdgeTXManager } from "./edgetxManager";
import { ProfileManager } from "./profileManager";
import { CompletionProvider } from "./completionProvider";
import { DiagnosticsProvider } from "./diagnosticsProvider";
import { ScriptWizard } from "./scriptWizard";
import { ApiSearchPanel } from "./apiSearchPanel";
import { VersionManager } from "./versionManager";
import { getEdgeTXConfig } from "./utils/general";
import { EdgeTXStatusBar } from "./edgetxStatusBar";
import { SDCardWatcher } from "./sdCardWatcher";

let edgetxManager: EdgeTXManager;

export async function activate(context: vscode.ExtensionContext) {
  const versionManager = new VersionManager(context);
  const profileManager = new ProfileManager(context, versionManager);
  const scriptWizard = new ScriptWizard(
    context,
    profileManager,
    versionManager,
  );
  const diagnosticsProvider = new DiagnosticsProvider(
    profileManager,
    versionManager,
  );
  const completionProvider = new CompletionProvider();
  const apiSearchPanel = new ApiSearchPanel(
    context,
    profileManager,
    versionManager,
  );
  edgetxManager = new EdgeTXManager(context, profileManager, versionManager);
  const statusBar = new EdgeTXStatusBar(context, edgetxManager, profileManager);
  const sdCardWatcher = new SDCardWatcher(
    profileManager,
    statusBar,
    diagnosticsProvider,
  );

  sdCardWatcher.register(context);
  diagnosticsProvider.register(context, () => edgetxManager.isActive());

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { language: "lua" },
      completionProvider,
      "!",
    ),
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ApiSearchPanel.viewId,
      apiSearchPanel,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  edgetxManager.onDidChangeActive((active) => {
    statusBar.refresh();

    if (!active) {
      diagnosticsProvider.clear();
    }

    vscode.commands.executeCommand("setContext", "edgetx.active", active);
  });

  function getNewScriptCommandHandler(scriptType: ScriptType) {
    return async () => {
      await scriptWizard.generateScript(scriptType);
    };
  }

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("edgetx.toggle", async () => {
      await edgetxManager.toggle();
      diagnosticsProvider.refresh();
    }),

    vscode.commands.registerCommand("edgetx.setProfile", async () => {
      await profileManager.promptSetProfile();
      await edgetxManager.activate();
      statusBar.refresh();
      diagnosticsProvider.refresh();
      apiSearchPanel.refresh();
    }),

    vscode.commands.registerCommand("edgetx.newScript", async () => {
      await scriptWizard.open();
    }),

    vscode.commands.registerCommand(
      "edgetx.newTelemetry",
      getNewScriptCommandHandler("telemetry"),
    ),

    vscode.commands.registerCommand(
      "edgetx.newWidget",
      getNewScriptCommandHandler("widget"),
    ),

    vscode.commands.registerCommand(
      "edgetx.newMix",
      getNewScriptCommandHandler("mix"),
    ),

    vscode.commands.registerCommand(
      "edgetx.newFunction",
      getNewScriptCommandHandler("function"),
    ),

    vscode.commands.registerCommand(
      "edgetx.newOneTime",
      getNewScriptCommandHandler("oneTime"),
    ),

    vscode.commands.registerCommand("edgetx.searchApi", async () => {
      ApiSearchPanel.open(context, profileManager, versionManager);
    }),

    vscode.commands.registerCommand("edgetx.checkUpdatesAndSync", async () => {
      statusBar.showAction("SYNCING_STUBS");

      const synced = await versionManager.syncStubs(true);
      const profile = profileManager.getProfile();

      statusBar.refresh();

      if (synced === false) {
        return;
      }

      const message =
        synced === 0
          ? "EdgeTX stubs up to date."
          : "New EdgeTX stubs downloaded and synced.";

      await vscode.window.showInformationMessage(message);

      if (synced !== 0 && profile) {
        await edgetxManager.injectLuaLsSettings(profile.version);
      }
    }),

    vscode.commands.registerCommand("edgetx.deployScript", async () => {
      const activeEditor = vscode.window.activeTextEditor;

      if (!activeEditor || activeEditor.document.languageId !== "lua") {
        vscode.window.showWarningMessage(
          "EdgeTX: Open a Lua script to deploy.",
        );
        return;
      }

      await sdCardWatcher.deploy(activeEditor.document);
    }),

    // coming soon
    vscode.commands.registerCommand("edgetx.simulate", () => {
      vscode.window
        .showInformationMessage(
          "EdgeTX: Live simulation is coming soon 😃 Follow the project to stay up to date.",
          "View on GitHub",
          "Dismiss",
        )
        .then((action) => {
          if (action === "View on GitHub") {
            vscode.env.openExternal(
              vscode.Uri.parse("https://github.com/JeffreyChix/edgetx-dev-kit"),
            );
          }
        });
    }),
  );

  const config = getEdgeTXConfig();

  if (
    config.get("autoActivateOnStart") &&
    vscode.window.activeTextEditor?.document.languageId === "lua"
  ) {
    await edgetxManager.activate();
  }

  if (config.get("checkUpdatesOnStart")) {
    versionManager
      .syncStubs()
      .then((synced) => {
        const profile = profileManager.getProfile();

        if (synced !== false && synced !== 0 && profile) {
          edgetxManager.injectLuaLsSettings(profile.version);
        }
      })
      .catch((err) => {
        console.error("EdgeTX stub sync failed silently: ", err);
      });
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration("edgetx.stubsRawBaseUrl")) {
        await versionManager.syncStubs(true);
      }
    }),
  );
}

export function deactivate() {
  edgetxManager?.deactivate();
}
