import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from "vscode";

const PORT = 5174;

interface DevUris {
  refreshUri: vscode.Uri;
  clientUri: vscode.Uri;
  entryUri: vscode.Uri;
  origin: string;
  wsOrigin: string;
}

function createBaseCSP(webview: vscode.Webview): string[] {
  return [
    `default-src 'none'`,
    `img-src ${webview.cspSource} https: data: blob:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource} https:`,
    `worker-src blob:`,
    `connect-src https: blob: ws://localhost:${PORT} ws://127.0.0.1:${PORT}`,
  ];
}

function createDevCSP(
  webview: vscode.Webview,
  nonce: string,
  origin: string,
  wsOrigin: string,
): string {
  return (
    [
      ...createBaseCSP(webview),
      `script-src 'nonce-${nonce}' 'unsafe-eval' ${origin}`,
      `connect-src ${origin} ${wsOrigin} ws://localhost:${PORT} ws://127.0.0.1:${PORT} https: blob:`,
    ].join("; ") + ";"
  );
}

function createProdCSP(webview: vscode.Webview, nonce: string): string {
  return (
    [
      ...createBaseCSP(webview),
      `script-src 'nonce-${nonce}' 'unsafe-eval' ${webview.cspSource}`,
      `connect-src ${webview.cspSource} https: blob:`,
    ].join("; ") + ";"
  );
}

async function getDevUris(): Promise<DevUris> {
  const refreshLocal = vscode.Uri.parse(
    `http://localhost:${PORT}/@react-refresh`,
  );
  const clientLocal = vscode.Uri.parse(`http://localhost:${PORT}/@vite/client`);
  const entryLocal = vscode.Uri.parse(`http://localhost:${PORT}/src/main.tsx`);

  const [refreshUri, clientUri, entryUri] = await Promise.all([
    vscode.env.asExternalUri(refreshLocal),
    vscode.env.asExternalUri(clientLocal),
    vscode.env.asExternalUri(entryLocal),
  ]);

  const origin = `${clientUri.scheme}://${clientUri.authority}`;
  const wsOrigin = origin.replace(/^http/, "ws");

  return { refreshUri, clientUri, entryUri, origin, wsOrigin };
}

function createDevHTML(nonce: string, uris: DevUris, csp: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>EdgeTX Simulator</title>
    <style>* { box-sizing: border-box; margin: 0; padding: 0; } body { overflow: auto; }</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" nonce="${nonce}">
      import RefreshRuntime from "${uris.refreshUri.toString(true)}";
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
    </script>
    <script type="module" nonce="${nonce}" src="${uris.clientUri.toString(true)}"></script>
    <script type="module" nonce="${nonce}" src="${uris.entryUri.toString(true)}"></script>
  </body>
</html>`;
}

function processProductionHtml(
  htmlContent: string,
  webview: vscode.Webview,
  distPath: string,
  nonce: string,
): string {
  const processed = htmlContent.replace(
    /(href|src)=["']([^"']*)["']/g,
    (match, attr, url) => {
      if (
        url.startsWith("http") ||
        url.startsWith("data:") ||
        url.startsWith("#") ||
        url === ""
      ) {
        return match;
      }
      const clean = url.replace(/^\//, "");
      const onDisk = vscode.Uri.file(path.join(distPath, clean));
      return `${attr}="${webview.asWebviewUri(onDisk).toString()}"`;
    },
  );

  const csp = createProdCSP(webview, nonce);

  return processed
    .replace(
      "</head>",
      `<meta http-equiv="Content-Security-Policy" content="${csp}"></head>`,
    )
    .replace(
      /<script([^>]*)type="module"([^>]*)>/g,
      `<script$1type="module"$2 nonce="${nonce}">`,
    );
}

export async function getWebviewContent(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
): Promise<string> {
  const isDev = context.extensionMode === vscode.ExtensionMode.Development;
  const nonce = randomUUID();

  if (isDev) {
    const uris = await getDevUris();
    const csp = createDevCSP(webview, nonce, uris.origin, uris.wsOrigin);
    return createDevHTML(nonce, uris, csp);
  }

  const distPath = path.join(
    context.extensionPath,
    "webview",
    "simulator",
    "dist",
  );
  const htmlPath = path.join(distPath, "index.html");
  const htmlContent = fs.readFileSync(htmlPath, "utf8");

  return processProductionHtml(htmlContent, webview, distPath, nonce);
}
