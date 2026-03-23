import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { versionGte } from "./utils/general";
import { SUPPORTED_RADIOS } from "./utils/supportedRadios";
import { VersionManager } from "./versionManager";

export class ProfileManager {
  private profile: EdgeTXProfile | undefined;
  private profilePath: string | undefined;
  private versions: string[];

  constructor(
    private context: vscode.ExtensionContext,
    private versionManager: VersionManager,
  ) {
    this.loadProfile();
    this.versions = this.versionManager.getSupportedVersions();
  }

  getProfile(): EdgeTXProfile | undefined {
    return this.profile;
  }

  getRadio(id: string): RadioDefinition | undefined {
    return SUPPORTED_RADIOS.find((r) => r.id === id);
  }

  async promptSetProfile(): Promise<EdgeTXProfile | undefined> {
    const radioItems = SUPPORTED_RADIOS.map((r) => ({
      label: r.name,
      description: `${r.display === "color" ? "🎨 Color" : "⬛ B&W"} ${r.screenWidth}×${r.screenHeight}`,
      detail: r.hasTouch ? "Touch screen" : undefined,
      radio: r,
    }));

    const pickedRadio = await vscode.window.showQuickPick(radioItems, {
      title: "EdgeTX: Select your radio (Step 1 of 2)",
      placeHolder: "Search for your radio model...",
    });

    if (!pickedRadio) {
      return undefined;
    }

    const versionItems = this.versions
      .filter((v) => versionGte(v, pickedRadio.radio.minSupportedVersion))
      .map((v) => ({
        label: `EdgeTX ${v}`,
        description: v === this.versions[0] ? "⭐ Latest" : undefined,
        version: v,
      }));

    const pickedVersion = await vscode.window.showQuickPick(versionItems, {
      title: "EdgeTX: Select firmware version (Step 2 of 2)",
      placeHolder: "Select the closest EdgeTX version on your radio",
    });

    if (!pickedVersion) {
      return undefined;
    }

    const radio = pickedRadio.radio;
    this.profile = {
      radio: radio.id,
      version: pickedVersion.version,
      display: radio.display,
      screenWidth: radio.screenWidth,
      screenHeight: radio.screenHeight,
    };

    await this.saveProfile();

    return this.profile;
  }

  private async saveProfile() {
    if (!this.profile) {
      return;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders?.[0]) {
      const vscodePath = path.join(workspaceFolders[0].uri.fsPath, ".vscode");
      if (!fs.existsSync(vscodePath)) {
        fs.mkdirSync(vscodePath, { recursive: true });
      }
      this.profilePath = path.join(vscodePath, "edgetx.json");
      fs.writeFileSync(this.profilePath, JSON.stringify(this.profile, null, 2));
    }

    await this.context.workspaceState.update("edgetx.profile", this.profile);
  }

  private loadProfile() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders?.[0]) {
      const profileFile = path.join(
        workspaceFolders[0].uri.fsPath,
        ".vscode",
        "edgetx.json",
      );
      if (fs.existsSync(profileFile)) {
        try {
          this.profile = JSON.parse(fs.readFileSync(profileFile, "utf8"));
          return;
        } catch {}
      }
    }

    this.profile = this.context.workspaceState.get("edgetx.profile");
  }
}
