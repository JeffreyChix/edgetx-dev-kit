import * as vscode from "vscode";
import { ProfileManager } from "./profileManager";
import { VersionManager } from "./versionManager";
import { versionGte } from "./utils/general";

export class EdgeTXManager {
  private _active = false;
  private _onDidChangeActive = new vscode.EventEmitter<boolean>();
  public readonly onDidChangeActive = this._onDidChangeActive.event;

  constructor(
    private context: vscode.ExtensionContext,
    private profileManager: ProfileManager,
    private versionManager: VersionManager,
  ) {
    this._active = this.context.workspaceState.get("edgetx.active", false);
    vscode.commands.executeCommand("setContext", "edgetx.active", this._active);
  }

  isActive(): boolean {
    return this._active;
  }

  private getProfileDesc() {
    const profile = this.profileManager.getProfile();
    return `EdgeTX mode ON — ${profile?.radio} / EdgeTX ${profile?.version}`;
  }

  async toggle() {
    if (this._active) {
      await this.deactivate();
    } else {
      await this.activate();
    }
  }

  async activate() {
    if (!this.profileManager.getProfile()) {
      const profile = await this.profileManager.promptSetProfile();
      if (!profile) {
        return;
      }
    }

    const profile = this.profileManager.getProfile()!;

    const versionAvailable = this.versionManager.ensureVersion(profile.version);
    if (!versionAvailable) {
      vscode.window.showErrorMessage(
        `No EdgeTX API data for ${profile.version}. Will fetch shortly if online.`,
      );
      return;
    }

    await this.injectLuaLsSettings(profile.version);

    this._active = true;
    await this.context.workspaceState.update("edgetx.active", true);
    this._onDidChangeActive.fire(true);

    this.showActiveStatus();
  }

  private async runOnDeactivate() {
    const luaConfig = vscode.workspace.getConfiguration("Lua");
    const current: string[] = luaConfig.get("workspace.library") ?? [];

    await luaConfig.update(
      "workspace.library",
      current.filter((p) => !p.includes("stubs")),
      vscode.ConfigurationTarget.Workspace,
    );

    this._active = false;
    await this.context.workspaceState.update("edgetx.active", false);
    this._onDidChangeActive.fire(false);
    await vscode.window.showInformationMessage("EdgeTX mode OFF");
  }

  async deactivate() {
    const profile = this.profileManager.getProfile();
    if (!profile) {
      await this.runOnDeactivate();
    } else {
      this.showActiveStatus();
    }
  }

  private async showActiveStatus() {
    const action = await vscode.window.showInformationMessage(
      this.getProfileDesc(),
      "Change Profile",
      "Turn Off",
    );

    if (action === "Change Profile") {
      vscode.commands.executeCommand("edgetx.setProfile");
    }
    if (action === "Turn Off") {
      await this.runOnDeactivate();
    }
  }

  async injectLuaLsSettings(version: string) {
    const stubsDir = this.versionManager.getVersionStubsDir(version);

    const luaConfig = vscode.workspace.getConfiguration("Lua");

    const current: string[] = luaConfig.get("workspace.library") ?? [];

    const cleaned = current.filter((p) => !p.includes("stubs"));

    const luaVersion = versionGte(version, "2.11") ? "Lua 5.3" : "Lua 5.2";

    await luaConfig.update(
      "workspace.library",
      [...cleaned, stubsDir],
      vscode.ConfigurationTarget.Workspace,
    );

    await luaConfig.update(
      "runtime.version",
      luaVersion,
      vscode.ConfigurationTarget.Workspace,
    );
  }
}
