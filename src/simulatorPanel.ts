import * as vscode from "vscode";
import { getWebviewContent } from "./getWebviewContent";
import { ProfileManager } from "./profileManager";
import { SimulatorHost, ScriptContext } from "./simulatorHost";

const WASM_BASE_URL =
  "https://ypwfws8ckruh03m1.public.blob.vercel-storage.com/wasm";

export class SimulatorPanel {
  public static readonly viewType = "edgetx.simulator";
  private static instance: SimulatorPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private host: SimulatorHost | undefined;
  private scriptContext: ScriptContext | undefined;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly profileManager: ProfileManager,
    scriptContext?: ScriptContext,
  ) {
    this.scriptContext = scriptContext;
    const profile = profileManager.getProfile();
    const viewColumn = profile && profile.screenWidth > 490
      ? vscode.ViewColumn.Active
      : vscode.ViewColumn.Beside;
    this.panel = vscode.window.createWebviewPanel(
      SimulatorPanel.viewType,
      "EdgeTX Simulator",
      viewColumn,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(
            context.extensionUri,
            "webview",
            "simulator",
            "dist",
          ),
        ],
      },
    );
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "bundled", "images", "icon.png");

    getWebviewContent(context, this.panel.webview).then((html) => {
      this.panel.webview.html = html;
      // Send initial status so webview shows something immediately
      this.panel.webview.postMessage({
        type: "simStatus",
        progress: 0,
        status: "Waiting for radio profile…",
      });
    });

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Message handler
    this.panel.webview.onDidReceiveMessage(
      (msg) => {
        if (msg.type === "ready") {
          this.sendRadioProfile();
          // Restore persisted UI state
          this.panel.webview.postMessage({
            type: "uiState",
            showControls: this.context.globalState.get<boolean>("simulator.showControls", false),
            showTelemetry: this.context.globalState.get<boolean>("simulator.showTelemetry", false),
            streamingEnabled: this.context.globalState.get<boolean>("simulator.streamingEnabled", false),
            showLogs: this.context.globalState.get<boolean>("simulator.showLogs", false),
          });
          return;
        }
        if (msg.type === "setProfile") {
          vscode.commands.executeCommand("edgetx.setProfile");
          return;
        }
        if (msg.type === "reload") {
          this.sendRadioProfile();
          return;
        }
        if (msg.type === "setShowControls") {
          this.context.globalState.update("simulator.showControls", msg.value);
          return;
        }
        if (msg.type === "setShowTelemetry") {
          this.context.globalState.update("simulator.showTelemetry", msg.value);
          return;
        }
        if (msg.type === "setStreamingEnabled") {
          this.context.globalState.update("simulator.streamingEnabled", msg.value);
          return;
        }
        if (msg.type === "setShowLogs") {
          this.context.globalState.update("simulator.showLogs", msg.value);
          return;
        }
        if (msg.type === "simTelemetryBatch") {
          this.host?.sendTelemetryFrames(msg.frames);
          return;
        }
        // Route simulator input messages to the host
        if (
          msg.type === "simAnalog" ||
          msg.type === "simSwitch" ||
          msg.type === "simKey" ||
          msg.type === "simTrim" ||
          msg.type === "simRotary" ||
          msg.type === "simChar" ||
          msg.type === "simTouch" ||
          msg.type === "simTouchUp"
        ) {
          this.host?.handleInput(msg);
        }
      },
      null,
      this.disposables,
    );
  }

  static open(
    context: vscode.ExtensionContext,
    profileManager: ProfileManager,
  ) {
    if (SimulatorPanel.instance) {
      SimulatorPanel.instance.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    SimulatorPanel.instance = new SimulatorPanel(context, profileManager);
  }

  static simulateScript(
    context: vscode.ExtensionContext,
    profileManager: ProfileManager,
    script: ScriptContext,
  ) {
    if (SimulatorPanel.instance) {
      // Restart simulation with the new script context
      SimulatorPanel.instance.scriptContext = script;
      SimulatorPanel.instance.panel.reveal();
      SimulatorPanel.instance.sendRadioProfile();
      return;
    }
    SimulatorPanel.instance = new SimulatorPanel(
      context,
      profileManager,
      script,
    );
  }

  static isOpen(): boolean {
    return !!SimulatorPanel.instance;
  }

  static setWatchMode(active: boolean) {
    SimulatorPanel.instance?.panel.webview.postMessage({
      type: "setWatching",
      active,
    });
  }

  static refresh() {
    if (SimulatorPanel.instance) {
      SimulatorPanel.instance.sendRadioProfile();
    }
  }

  private sendRadioProfile() {
    const profile = this.profileManager.getProfile();
    if (!profile) {
      return;
    }

    // Find the full RadioProfile from radios.json using wasmId

    const radios = require("../bundled/radios.json") as RadioProfile[];
    const wasmFile = `edgetx-${profile.radio}-simulator.wasm`;
    const radioProfile = radios.find((r) => r.wasm === wasmFile);

    if (!radioProfile) {
      return;
    }

    // Tell the webview which radio we're using
    this.panel.webview.postMessage({
      type: "setRadio",
      radio: radioProfile,
    });

    this.panel.webview.postMessage({
      type: "setActive",
      active: true,
    });

    // Stop existing host if any, then start a new one
    const oldHost = this.host;
    this.host = undefined;

    const storagePath = this.context.globalStorageUri.fsPath;
    const newHost = new SimulatorHost(this.panel, storagePath);
    this.host = newHost;

    // Stop old host after creating new one (avoids gap)
    if (oldHost) {
      oldHost.stop().catch(() => {});
    }

    // Fire-and-forget; errors are posted as simError by the host
    newHost
      .start(radioProfile, WASM_BASE_URL, this.scriptContext)
      .catch(() => {});
  }

  private dispose() {
    SimulatorPanel.instance = undefined;

    // Stop the host gracefully
    if (this.host) {
      this.host.stop().catch(() => {});
      this.host = undefined;
    }

    this.panel.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}
