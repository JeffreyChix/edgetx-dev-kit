import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { fetchRemoteManifest, fetchStubs } from "./utils/fetcher";
import { parseVersion } from "./utils/general";

const DEFAULT_VERSIONS = Array.from({ length: 10 }).map(
  (_, index) => `2.${index + 3}`,
); // 2.3 to 2.12

const SUPPORTED_SCHEMA_VERSION = 1;

export class VersionManager {
  private manifest: Manifest | null;
  private apiDocs: Record<string, ApiDoc> | null;

  constructor(private context: vscode.ExtensionContext) {
    this.manifest = this.readLocalManifest();
    this.apiDocs = this.initApiDocs();
  }

  private initApiDocs() {
    try {
      const data: Record<string, ApiDoc> = {};

      const stubsDir = this.getStubsDir();
      const versions = fs.readdirSync(stubsDir);

      for (const version of versions) {
        const json = this.getStubFile(version, "edgetx-lua-api.json");
        data[version] = (json ?? {}) as ApiDoc;
      }

      return data;
    } catch {
      return null;
    }
  }

  private getManifestPath() {
    return path.join(this.context.globalStorageUri.fsPath, "manifest.json");
  }

  private readLocalManifest() {
    try {
      const data = fs.readFileSync(this.getManifestPath(), "utf-8");
      return JSON.parse(data) as Manifest;
    } catch {
      return null;
    }
  }

  private writeLocalManifest(manifest: Manifest) {
    this.manifest = manifest;

    fs.mkdirSync(this.context.globalStorageUri.fsPath, { recursive: true });
    fs.writeFileSync(
      this.getManifestPath(),
      JSON.stringify(manifest, null, 2),
      "utf-8",
    );
  }

  getSupportedVersions() {
    if (!this.manifest) {
      return DEFAULT_VERSIONS;
    }

    const versions = Object.entries(this.manifest.versions)
      .filter(([v]) => v !== "main")
      .map(([v]) => v);

    return this.sortVersionsDesc(versions);
  }

  private getStubsDir() {
    const downloaded = path.join(this.context.globalStorageUri.fsPath, "stubs");
    if (fs.existsSync(downloaded)) {
      return downloaded;
    }

    return path.join(this.context.extensionPath, "bundled", "edgetx", "stubs");
  }

  getVersionStubsDir(version: string) {
    return path.join(this.getStubsDir(), version);
  }

  private async downloadAndWriteStubs(version: string, entry: EdgeTXVersion) {
    const stubsDir = path.join(
      this.context.globalStorageUri.fsPath,
      "stubs",
      version,
    );

    fs.mkdirSync(stubsDir, { recursive: true });

    const stubs = await fetchStubs(entry.files, version);

    for (const [file, content] of Object.entries(stubs)) {
      fs.writeFileSync(path.join(stubsDir, file), content, "utf-8");
    }
  }

  async syncStubs(notifyOnError = false) {
    try {
      const remoteManifest = await fetchRemoteManifest();
      const batchDownloads: Promise<void>[] = [];

      if (remoteManifest.manifestVersion > SUPPORTED_SCHEMA_VERSION) {
        await vscode.window.showInformationMessage(
          "Update edgetx-dev-kit for the latest API stubs",
        );
        return 0;
      }

      for (const [version, entry] of Object.entries(remoteManifest.versions)) {
        const local = this.manifest?.versions[version];

        if (local?.stubHash === entry.stubHash) {
          continue;
        }

        batchDownloads.push(this.downloadAndWriteStubs(version, entry));
      }

      await Promise.all(batchDownloads);

      if (batchDownloads.length > 0) {
        this.writeLocalManifest(remoteManifest);
        this.apiDocs = this.initApiDocs();
        await vscode.window.showInformationMessage("EdgeTX: Stubs updated.");
      }
      return batchDownloads.length;
    } catch (err) {
      if (notifyOnError) {
        const msg = (err as Error).message ?? "EdgeTX: Stubs update failed.";
        vscode.window.showErrorMessage(msg);
      }
      console.error("Stub sync error:", err);
      return false;
    }
  }

  private sortVersionsDesc(versions: string[]) {
    return versions.sort((a, b) => {
      const [majA, minA] = parseVersion(a);
      const [majB, minB] = parseVersion(b);

      if (majA !== majB) {
        return majB - majA;
      }
      return minB - minA;
    });
  }

  ensureVersion(version: string) {
    const exists = fs.existsSync(this.getVersionStubsDir(version));

    if (!exists && this.manifest) {
      const entry = this.manifest.versions[version];

      this.downloadAndWriteStubs(version, entry).then(async () => {
        await vscode.window.showInformationMessage(
          `EdgeTX stubs for version ${version} are ready.`,
        );
      });
    }

    return exists;
  }

  getStubFile<T = unknown>(version: string, fileName: EdgeTXFile): T | null {
    const stubsDir = this.getStubsDir();
    const filePath = path.join(stubsDir, version, fileName);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const data = fs.readFileSync(filePath, "utf-8");
    return fileName.endsWith(".json") ? (JSON.parse(data) as T) : (data as T);
  }

  getScriptTypes(version: string) {
    return this.getStubFile<Record<string, ScriptTypeDefinition>>(
      version,
      "edgetx-script-types.json",
    );
  }

  getApiDocs() {
    return this.apiDocs;
  }

  getApiDoc(version: string) {
    return this.apiDocs?.[version] ?? null;
  }

  getModules(version: string) {
    const apiDoc = this.getApiDoc(version);
    if (!apiDoc) {
      return [];
    }
    return [...new Set(apiDoc.functions.map((f) => f.module))].sort();
  }
}
