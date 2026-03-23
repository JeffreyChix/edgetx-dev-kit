import * as vscode from "vscode";
import * as luaparse from "luaparse";
import * as path from "path";

import { ProfileManager } from "./profileManager";
import { VersionManager } from "./versionManager";
import { findVersionEntry, versionGte } from "./utils/general";

const ANNOTATION_TO_SCRIPT_KEY: Record<string, ScriptType> = {
  WidgetScript: "widget",
  TelemetryScript: "telemetry",
  OneTimeScript: "oneTime",
  FunctionScript: "function",
  MixScript: "mix",
};

export class DiagnosticsProvider {
  private collection: vscode.DiagnosticCollection;
  private debounceTimer: NodeJS.Timeout | undefined;

  constructor(
    private profileManager: ProfileManager,
    private versionManager: VersionManager,
  ) {
    this.collection = vscode.languages.createDiagnosticCollection("edgetx");
  }

  parseLuaSource(source: string, version: string) {
    let ast: luaparse.Chunk | null = null;

    try {
      ast = luaparse.parse(source, {
        locations: true,
        ranges: true,
        luaVersion: versionGte(version, "2.11") ? "5.3" : "5.2",
      });
    } catch {}

    return ast;
  }

  detectScriptType(document: vscode.TextDocument): {
    scriptKey: string | null;
    range: vscode.Range;
  } {
    const match = document.getText().match(/---@type\s+(\w+Script)/);

    if (!match || match.index === undefined) {
      return { scriptKey: null, range: new vscode.Range(0, 0, 0, 0) };
    }

    const pos = document.positionAt(match.index);
    const range = new vscode.Range(pos, pos.translate(0, match[0].length));

    return { scriptKey: ANNOTATION_TO_SCRIPT_KEY[match[1]] ?? null, range };
  }

  private getReturnStatement(
    ast: luaparse.Chunk,
  ): luaparse.ReturnStatement | undefined {
    return ast.body.reverse().find((n) => n.type === "ReturnStatement");
  }

  private getReturnedKeys(
    table: luaparse.TableConstructorExpression,
  ): Set<string> | null {
    if (!table) {
      return null;
    }

    const keys = table.fields.map(
      (f) => (f as luaparse.TableKeyString).key.name,
    );

    return new Set(keys);
  }

  private resolveFieldsForVersion(
    scriptKey: string,
    version: string,
  ): (ScriptField & { name: string })[] {
    const scriptTypes = this.versionManager.getScriptTypes(version);
    const def = scriptTypes?.[scriptKey];
    if (!def) {
      return [];
    }

    const entry =
      def.versions.find(findVersionEntry(version)) ??
      def.versions[def.versions.length - 1];

    return Object.entries(entry.fields).map(([name, field]) => ({
      name,
      ...field,
    }));
  }

  getScriptTable(
    ast: luaparse.Chunk,
  ): luaparse.TableConstructorExpression | null {
    let tableExpr: luaparse.TableConstructorExpression | null = null;

    const returnStmt = [...ast.body]
      .reverse()
      .find((n): n is luaparse.ReturnStatement => n.type === "ReturnStatement");

    if (!returnStmt || returnStmt.arguments.length === 0) {
      return null;
    }

    const returnExpr = returnStmt.arguments[0];

    if (returnExpr.type === "TableConstructorExpression") {
      return returnExpr;
    }

    if (returnExpr.type === "Identifier") {
      for (const node of ast.body) {
        if (node.type === "LocalStatement") {
          const idx = node.variables.findIndex(
            (v) => v.name === (returnExpr as luaparse.Identifier).name,
          );
          if (idx === -1) {
            continue;
          }

          const init = node.init[idx];

          if (init?.type === "TableConstructorExpression") {
            tableExpr = {
              ...init,
              fields: [...init.fields],
            };
          }
        }

        if (node.type === "AssignmentStatement") {
          node.variables.forEach((v, idx) => {
            if (
              v.type === "MemberExpression" &&
              v.base.type === "Identifier" &&
              v.base.name === returnExpr.name &&
              v.identifier.type === "Identifier"
            ) {
              const key = v.identifier.name;
              const value = node.init[idx];

              if (!tableExpr) {
                tableExpr = { type: "TableConstructorExpression", fields: [] };
              }

              tableExpr.fields = tableExpr.fields.filter(
                (f) => f.type === "TableKeyString" && f.key.name !== key,
              );

              tableExpr.fields.push({
                type: "TableKeyString",
                key: v.identifier,
                value,
                loc: v.loc,
              });
            }
          });
        }
      }
    }

    return tableExpr;
  }

  private checkWidgetConstraints(
    table: luaparse.TableConstructorExpression | null,
    version: string,
    fileName: string,
    scriptTypeRange: vscode.Range,
    display: ScreenDisplayType,
  ): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];

    if (fileName !== "main.lua") {
      diagnostics.push(
        this.error(
          scriptTypeRange,
          `EdgeTX: Widget scripts must be named 'main.lua' (current: '${fileName}')`,
        ),
      );
    }

    if (display !== "color") {
      diagnostics.push(
        this.warning(
          scriptTypeRange,
          `EdgeTX: widget scripts are not available on non-color displays (current display: '${display}')`,
        ),
      );
    }

    if (!table) {
      return diagnostics;
    }

    for (const field of table.fields) {
      if (field.type !== "TableKeyString") {
        continue;
      }

      if (field.key.name === "name") {
        const value = field.value;
        if (value.type === "StringLiteral") {
          const raw = this.stripQuotes(value.raw);
          if (raw.length === 0) {
            const range = this.nodeToRange(value);
            diagnostics.push(
              this.error(range, `EdgeTX: Widget name cannot be empty.`),
            );
          }
          if (raw.length > 10) {
            const range = this.nodeToRange(value);
            diagnostics.push(
              this.error(
                range,
                `EdgeTX: Widget name '${raw}' exceeds 10 characters (${raw.length})`,
              ),
            );
          }
        }
      }

      if (field.key.name === "options") {
        const value = field.value;
        if (value.type !== "TableConstructorExpression") {
          continue;
        }

        const maxOptions = versionGte(version, "2.11") ? 10 : 5;
        const optionCount = value.fields.length;

        if (optionCount > maxOptions) {
          const range = this.nodeToRange(value);
          diagnostics.push(
            this.error(
              range,
              `EdgeTX: Too many options (${optionCount}). Maximum is ${maxOptions} for EdgeTX ${version}`,
            ),
          );
        }

        for (const option of value.fields) {
          if (option.type !== "TableValue") {
            continue;
          }
          if (option.value.type !== "TableConstructorExpression") {
            continue;
          }

          const optionFields = option.value.fields;
          const firstField = optionFields[0];

          if (
            firstField?.type === "TableValue" &&
            firstField.value.type === "StringLiteral"
          ) {
            const optionName = this.stripQuotes(firstField.value.raw);
            const nameRange = this.nodeToRange(firstField.value);

            if (optionName.length === 0) {
              diagnostics.push(
                this.error(nameRange, `EdgeTX: Option name cannot be empty`),
              );
            }
            if (optionName.length > 10) {
              diagnostics.push(
                this.error(
                  nameRange,
                  `EdgeTX: Option name '${optionName}' exceeds 10 characters (${optionName.length})`,
                ),
              );
            }

            if (/\s/.test(optionName)) {
              diagnostics.push(
                this.error(
                  nameRange,
                  `EdgeTX: Option name '${optionName}' must not contain spaces`,
                ),
              );
            }
          }
        }
      }
    }

    return diagnostics;
  }

  // ─── Checks ───────────────────────────────────────────────────────────────────

  private checkReturnStatement(
    ast: luaparse.Chunk | null,
    scriptKey: string,
    scriptTypeRange: vscode.Range,
  ): vscode.Diagnostic[] {
    const returnStmt = ast ? this.getReturnStatement(ast) : undefined;

    if (returnStmt) {
      return [];
    }

    return [
      this.error(
        scriptTypeRange,
        `EdgeTX: ${scriptKey} script is missing a return statement.`,
      ),
    ];
  }

  private checkFields(
    ast: luaparse.Chunk | null,
    fields: (ScriptField & {
      name: string;
    })[],
    table: luaparse.TableConstructorExpression | null,
  ): vscode.Diagnostic[] {
    const returnStmt = ast ? this.getReturnStatement(ast) : undefined;

    if (!returnStmt) {
      return [];
    }

    if (returnStmt.arguments.length === 0) {
      const range = this.nodeToRange(returnStmt);
      return [
        this.error(range, `EdgeTX: script is missing a return argument.`),
      ];
    }

    if (!table) {
      return [];
    }

    const range = this.nodeToRange(returnStmt.arguments[0]);

    const keys = this.getReturnedKeys(table);

    return fields
      .filter((f) => {
        const isRequired = !f.optional;
        const isMissing = !keys || !keys.has(f.name);
        return isRequired && isMissing;
      })
      .map((f) =>
        this.error(
          range,
          `EdgeTX: script is missing '${f.name}: ${f.signature}'.`,
        ),
      );
  }

  private checkFieldTypes(
    fields: (ScriptField & {
      name: string;
    })[],
    table: luaparse.TableConstructorExpression | null,
  ): vscode.Diagnostic[] {
    if (!table) {
      return [];
    }
    const diagnostics: vscode.Diagnostic[] = [];

    for (const field of fields) {
      const tableField = table.fields.find(
        (tf) => tf.type === "TableKeyString" && tf.key.name === field.name,
      );

      if (!tableField) {
        continue;
      }

      const value = tableField.value;
      const isCorrectType = this.isExpectedType(value, field.signature);

      if (!isCorrectType) {
        const range = this.nodeToRange(tableField.value);
        diagnostics.push(
          this.error(
            range,
            `EdgeTX: '${field.name}' must be of type '${field.signature}'`,
          ),
        );
      }
    }

    return diagnostics;
  }

  update(document: vscode.TextDocument) {
    const profile = this.profileManager.getProfile();
    if (!profile || document.languageId !== "lua") {
      this.collection.delete(document.uri);
      return;
    }

    const { scriptKey, range: scriptTypeRange } =
      this.detectScriptType(document);

    const fields = this.resolveFieldsForVersion(
      scriptKey ?? "",
      profile.version,
    );

    const source = document.getText();
    const ast = this.parseLuaSource(source, profile.version);

    const table = ast ? this.getScriptTable(ast) : null;

    const fileName = path.basename(document.fileName);

    const structuralDiagnostics = scriptKey
      ? [
          ...this.checkReturnStatement(ast, scriptKey, scriptTypeRange),
          ...this.checkFields(ast, fields, table),
          ...this.checkFieldTypes(fields, table),
          ...(scriptKey === "widget"
            ? this.checkWidgetConstraints(
                table,
                profile.version,
                fileName,
                scriptTypeRange,
                profile.display,
              )
            : []),
        ]
      : [];

    const lintDiagnostics = this.lint(source, profile, scriptKey);

    this.collection.set(document.uri, [
      ...structuralDiagnostics,
      ...lintDiagnostics,
    ]);
  }

  private debouncedUpdate(document: vscode.TextDocument) {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.update(document), 400);
  }

  register(context: vscode.ExtensionContext, isActive: () => boolean) {
    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (doc.languageId === "lua" && isActive()) {
          this.update(doc);
        }
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.languageId === "lua" && isActive()) {
          this.debouncedUpdate(e.document);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((d) =>
        this.collection.delete(d.uri),
      ),
    );

    vscode.workspace.textDocuments.forEach((doc) => {
      if (doc.languageId === "lua" && isActive()) {
        this.update(doc);
      }
    });
  }

  private lint(
    source: string,
    profile: EdgeTXProfile,
    scriptKey: string | null,
  ): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    const lines = source.split("\n");

    const unavailableApis = this.getUnavailableApis(
      profile.version,
      profile.display === "color" ? "COLOR_LCD" : "NON_COLOR_LCD",
    );

    const versionGated: {
      pattern: RegExp;
      minVersion: string;
      apiName: string;
    }[] = [
      {
        pattern: /\btouchState\b/,
        minVersion: "2.7",
        apiName: "touchState parameter",
      },
    ];

    const unsupportedLibraries = [
      {
        pattern: /\brequire\s*\(\s*['"]package['"]\s*\)|\bpackage\.\w+/,
        name: "package",
      },
      {
        pattern: /\brequire\s*\(\s*['"]coroutine['"]\s*\)|\bcoroutine\.\w+/,
        name: "coroutine",
      },
      {
        pattern: /\brequire\s*\(\s*['"]os['"]\s*\)|\bos\.\w+/,
        name: "os",
      },
      {
        pattern: /\brequire\s*\(\s*['"]debug['"]\s*\)|\bdebug\.\w+/,
        name: "debug",
      },
      {
        pattern: /\brequire\s*\(\s*['"]table['"]\s*\)|\btable\.\w+/,
        name: "table",
        colorOnly: true,
      },
    ];

    const unsupportedIoFunctions = [
      {
        pattern: /\bio\.(?!open|close|read|write|seek)\w+/,
        name: "io",
      },
    ];

    lines.forEach((line, i) => {
      const range = new vscode.Range(i, 0, i, line.length);

      for (const check of unavailableApis) {
        if (check.pattern.test(line)) {
          diagnostics.push(this.warning(range, `EdgeTX: ${check.msg}.`));
        }
      }

      for (const gate of versionGated) {
        if (
          !versionGte(profile.version, gate.minVersion) &&
          gate.pattern.test(line)
        ) {
          diagnostics.push(
            this.error(
              range,
              `EdgeTX: ${gate.apiName} requires EdgeTX ${gate.minVersion}+. Your profile is set to ${profile.version}.`,
            ),
          );
        }
      }

      for (const lib of unsupportedLibraries) {
        if (
          lib.colorOnly &&
          profile.display !== "color" &&
          lib.pattern.test(line)
        ) {
          diagnostics.push(
            this.warning(
              range,
              `EdgeTX: '${lib.name}' library is only available on color LCD radios.`,
            ),
          );
        } else if (!lib.colorOnly && lib.pattern.test(line)) {
          diagnostics.push(
            this.error(
              range,
              `EdgeTX: '${lib.name}' standard library is not available in EdgeTX Lua.`,
            ),
          );
        }
      }

      for (const fn of unsupportedIoFunctions) {
        if (fn.pattern.test(line)) {
          const match = line.match(/\bio\.(\w+)/);
          diagnostics.push(
            this.error(
              range,
              `EdgeTX: 'io.${match?.[1] ?? "?"}' is not available in EdgeTX Lua.\nSupported: io.open(), io.close(), io.read(), io.write(), io.seek()`,
            ),
          );
        }
      }

      // function scripts don't have access to lcd
      if (scriptKey && scriptKey === "function" && /\blcd\.\w+/.test(line)) {
        diagnostics.push(
          this.error(
            range,
            "EdgeTX: function scripts don't have access to lcd",
          ),
        );
      }
    });

    return diagnostics;
  }

  private getUnavailableApis(
    version: string,
    displayType: Availability,
  ): { pattern: RegExp; msg: string }[] {
    const apiDoc = this.versionManager.getApiDoc(version);

    if (!apiDoc) {
      return [];
    }

    return [...apiDoc.functions, ...apiDoc.constants]
      .filter(
        (api) =>
          api.availableOn &&
          api.availableOn !== "GENERAL" &&
          api.availableOn !== displayType,
      )
      .map((api) => {
        const isFunction = api.entityType === "function";
        const pattern = isFunction
          ? new RegExp(`\\b${this.escapeRegExp(api.name)}\\s*\\(`)
          : new RegExp(`\\b${this.escapeRegExp(api.name)}\\b`);

        const msg = isFunction
          ? `${api.name}() is not available on ${displayType === "COLOR_LCD" ? "color" : "non-color"} displays.`
          : `${api.name} is not available on ${displayType === "NON_COLOR_LCD" ? "non-color" : "color"} displays.`;

        return { pattern, msg };
      });
  }

  private escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private warning(range: vscode.Range, message: string): vscode.Diagnostic {
    const d = new vscode.Diagnostic(
      range,
      "⚠️ " + message,
      vscode.DiagnosticSeverity.Warning,
    );
    d.source = "edgetx";
    return d;
  }

  private error(range: vscode.Range, message: string): vscode.Diagnostic {
    const d = new vscode.Diagnostic(
      range,
      "🚩 " + message,
      vscode.DiagnosticSeverity.Error,
    );
    d.source = "edgetx";
    return d;
  }

  private nodeToRange(node: luaparse.Node): vscode.Range {
    // luaparse locations are 1-based lines, 0-based columns
    return new vscode.Range(
      new vscode.Position(node.loc!.start.line - 1, node.loc!.start.column),
      new vscode.Position(node.loc!.end.line - 1, node.loc!.end.column),
    );
  }

  private isExpectedType(
    node: luaparse.Expression,
    signature: string,
  ): boolean {
    if (node.type === "Identifier") {
      return true;
    }
    if (signature.startsWith("fun")) {
      return node.type === "FunctionDeclaration";
    }
    if (signature === "string") {
      return node.type === "StringLiteral";
    }

    if (
      signature.endsWith("[]") ||
      signature.toLowerCase().includes("table") ||
      signature.toLowerCase().includes("options") ||
      signature.toLowerCase().includes("input") ||
      signature.toLowerCase().includes("output")
    ) {
      return node.type === "TableConstructorExpression";
    }

    return true;
  }

  stripQuotes(value: string) {
    return value.replace(/^['"]|['"]$/g, "");
  }

  refresh() {
    this.clear();

    vscode.workspace.textDocuments.forEach((doc) => {
      if (doc.languageId === "lua") {
        this.update(doc);
      }
    });
  }

  clear() {
    this.collection.clear();
  }
}
