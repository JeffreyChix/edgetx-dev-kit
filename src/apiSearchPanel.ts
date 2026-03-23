import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { ProfileManager } from "./profileManager";
import { VersionManager } from "./versionManager";

export class ApiSearchPanel implements vscode.WebviewViewProvider {
  public static readonly viewId = "edgetx.apiSearch";
  private view?: vscode.WebviewView;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly profileManager: ProfileManager,
    private readonly versionManager: VersionManager,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    this.render();

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.command === "insert") {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === "lua") {
          editor.insertSnippet(new vscode.SnippetString(msg.snippet));
        }
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.render();
      }
    });
  }

  refresh() {
    if (this.view?.visible) {
      this.render();
    }
  }

  static open(
    context: vscode.ExtensionContext,
    profileManager: ProfileManager,
    versionManager: VersionManager,
  ) {
    const profile = profileManager.getProfile();
    if (!profile) {
      vscode.window.showErrorMessage("EdgeTX: Set a radio profile first.");
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "edgetxApiSearch",
      "EdgeTX API Search",
      vscode.ViewColumn.Beside,
      { enableScripts: true },
    );

    panel.webview.html = getSearchHtml(
      context,
      versionManager,
      profile.version,
    );

    panel.webview.onDidReceiveMessage(
      async (msg) => {
        if (msg.command === "insert") {
          const editor = vscode.window.activeTextEditor;
          if (editor && editor.document.languageId === "lua") {
            editor.insertSnippet(new vscode.SnippetString(msg.snippet));
          }
        }
      },
      undefined,
      context.subscriptions,
    );
  }

  private render() {
    if (!this.view) {
      return;
    }

    const profile = this.profileManager.getProfile();
    if (!profile) {
      this.view.webview.html = this.getNoProfileHtml();
      return;
    }

    this.view.webview.html = getSearchHtml(
      this.context,
      this.versionManager,
      profile.version,
    );
  }

  private getNoProfileHtml(): string {
    return `<!DOCTYPE html>
<html><body style="padding:12px;font-family:var(--vscode-font-family);color:var(--vscode-foreground)">
  <p>Set a radio profile to use API Search.</p>
</body></html>`;
  }
}

function getSearchHtml(
  context: vscode.ExtensionContext,
  versionManager: VersionManager,
  profileVersion: string,
): string {
  const apiDocs = versionManager.getApiDocs() ?? {};

  const apis = Object.fromEntries(
    Object.entries(apiDocs).map(([version, apiDoc]) => [
      version,
      [...apiDoc.functions, ...apiDoc.constants],
    ]),
  );

  const modules = versionManager
    .getModules(profileVersion)
    .filter((m) => m !== "general");

  const supportedVersions = [
    profileVersion,
    ...versionManager
      .getSupportedVersions()
      .filter((v) => v !== profileVersion),
  ];

  const templatePath = path.join(
    context.extensionPath,
    "webview",
    "api-search-panel.html",
  );
  let html = fs.readFileSync(templatePath, "utf8");

  html = html.replace(
    "const APIS = /*APIS*/ {}; /*END_APIS*/",
    () => `const APIS = ${JSON.stringify(apis)};`,
  );

  const moduleOptions = modules
    .map((m) => `<option value="${m}">${m}</option>`)
    .join("\n      ");
  html = html.replace("<!--MODULES-->", moduleOptions);

  const versionOptions = supportedVersions
    .map(
      (v) =>
        `<option value="${v}"${v === profileVersion ? " selected" : ""}>${v}${v === profileVersion ? " — profile" : ""}</option>`,
    )
    .join("\n      ");
  html = html.replace("<!--VERSIONS-->", versionOptions);

  return html;
}
