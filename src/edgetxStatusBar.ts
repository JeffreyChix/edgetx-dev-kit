import * as vscode from "vscode";
import { EdgeTXManager } from "./edgetxManager";
import { ProfileManager } from "./profileManager";

type Action = "SYNCING_STUBS" | "DEPLOYING_SCRIPT";

const ACTION_TEXT: Record<Action, string> = {
  SYNCING_STUBS: "$(sync~spin) EdgeTX: Checking updates...",
  DEPLOYING_SCRIPT: "$(cloud-upload~spin) EdgeTX: Deploying script...",
};

export class EdgeTXStatusBar {
  private readonly statusBar: vscode.StatusBarItem;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly edgetxManager: EdgeTXManager,
    private readonly profileManager: ProfileManager,
  ) {
    this.statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.statusBar.command = "edgetx.toggle";
    this.context.subscriptions.push(this.statusBar);
    this.refresh();
    this.statusBar.show();
  }

  refresh() {
    this.statusBar.text = this.buildText();
    this.statusBar.tooltip = this.edgetxManager.isActive()
      ? undefined
      : "Click to enable EdgeTX Lua mode";
    this.statusBar.backgroundColor = this.edgetxManager.isActive()
      ? new vscode.ThemeColor("statusBarItem.warningBackground")
      : undefined;
  }

  showAction(action: Action, hideAfterMs?: number) {
    this.statusBar.text = ACTION_TEXT[action];
    if (hideAfterMs !== undefined) {
      setTimeout(() => this.refresh(), hideAfterMs);
    }
  }

  showMessage(text: string, hideAfterMs?: number) {
    this.statusBar.text = text;
    if (hideAfterMs !== undefined) {
      setTimeout(() => this.refresh(), hideAfterMs);
    }
  }

  private buildText(): string {
    const profile = this.profileManager.getProfile();

    if (!profile) {
      return "$(broadcast) EdgeTX: No profile";
    }
    if (!this.edgetxManager.isActive()) {
      return "$(broadcast) EdgeTX: Off";
    }

    return `$(broadcast) EdgeTX: ${profile.radio ?? "On"} • ${profile.version ?? ""}`.trimEnd();
  }
}
