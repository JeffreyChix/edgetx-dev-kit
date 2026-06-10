/**
 * SimulatorHost — runs in the extension host (Node.js).
 * Owns the WASM simulator: downloads binary, spawns workers,
 * runs the LCD frame loop, and streams frames to the webview.
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as https from "https";
import { getEdgeTXConfig } from "./utils/general";
import * as http from "http";
import { Worker } from "worker_threads";
import { WASIThreads } from "@emnapi/wasi-threads";
import type { WASIInstance } from "@emnapi/wasi-threads";
import { WASI } from "@tybys/wasm-util";

// Protocol constants (from fs-proxy-protocol.ts)
const CTRL_BUFFER_SIZE = 64 * 4;
const DATA_BUFFER_SIZE = 4 * 1024 * 1024;
const WAKE_BUFFER_SIZE = 4;

// ---------------------------------------------------------------------------
// Stub fs for the main-thread WASI instance
// (real I/O happens in worker threads via FsProxyClient → FS Worker)
// ---------------------------------------------------------------------------

const stubFs = (() => {
  let nextFd = 3;
  const dirStat = () => ({
    dev: 0n,
    ino: 0n,
    mode: 0o040755n,
    nlink: 1n,
    uid: 0n,
    gid: 0n,
    rdev: 0n,
    size: 0n,
    blksize: 4096n,
    blocks: 0n,
    atimeMs: 0n,
    mtimeMs: 0n,
    ctimeMs: 0n,
    birthtimeMs: 0n,
    atimeNs: 0n,
    mtimeNs: 0n,
    ctimeNs: 0n,
    birthtimeNs: 0n,
    atime: new Date(0),
    mtime: new Date(0),
    ctime: new Date(0),
    birthtime: new Date(0),
    isFile: () => false,
    isDirectory: () => true,
    isSymbolicLink: () => false,
    isCharacterDevice: () => false,
    isBlockDevice: () => false,
    isSocket: () => false,
    isFIFO: () => false,
  });
  return {
    openSync() {
      return nextFd++;
    },
    closeSync() {},
    fstatSync() {
      return dirStat();
    },
    statSync() {
      return dirStat();
    },
    lstatSync() {
      return dirStat();
    },
    readdirSync() {
      return [];
    },
    readSync() {
      return 0;
    },
    writeSync(_fd: number, _b: any, _o: number, len: number) {
      return len;
    },
    mkdirSync() {},
    renameSync() {},
    rmdirSync() {},
    unlinkSync() {},
    linkSync() {},
    symlinkSync() {},
    readlinkSync(p: string) {
      return p;
    },
    realpathSync(p: string) {
      return p;
    },
    ftruncateSync() {},
    futimesSync() {},
    utimesSync() {},
    fdatasyncSync() {},
    fsyncSync() {},
  };
})();

// ---------------------------------------------------------------------------
// Minimal WASM binary parser to extract memory import limits
// ---------------------------------------------------------------------------

function getMemoryImport(bytes: Uint8Array): {
  initial: number;
  maximum: number;
} {
  let off = 8; // skip magic + version

  function readU32Leb(): number {
    let result = 0,
      shift = 0;
    while (true) {
      const b = bytes[off++];
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) {
        return result;
      }
      shift += 7;
    }
  }

  function readName(): string {
    const len = readU32Leb();
    const s = new TextDecoder().decode(bytes.subarray(off, off + len));
    off += len;
    return s;
  }

  while (off < bytes.length) {
    const sectionId = bytes[off++];
    const sectionLen = readU32Leb();
    const sectionEnd = off + sectionLen;

    if (sectionId !== 2) {
      off = sectionEnd;
      continue;
    }

    const count = readU32Leb();
    for (let i = 0; i < count; i++) {
      const mod = readName();
      const name = readName();
      const kind = bytes[off++];
      if (kind === 2) {
        const flags = readU32Leb();
        const initial = readU32Leb();
        const maximum = flags & 1 ? readU32Leb() : 65536;
        if (mod === "env" && name === "memory") {
          return { initial, maximum };
        }
      } else if (kind === 0) {
        readU32Leb();
      } else if (kind === 1) {
        readU32Leb();
        readU32Leb();
        readU32Leb();
      } else if (kind === 3) {
        off += 2;
      } else if (kind === 4) {
        readU32Leb();
      }
    }
    break;
  }
  return { initial: 256, maximum: 32768 };
}

// ---------------------------------------------------------------------------
// ScriptContext — describes the script to launch after first frame
// ---------------------------------------------------------------------------

export interface ScriptContext {
  type: "widget" | "telemetry";
  /** WASI path, e.g. "/SCRIPTS/TELEMETRY/myscript.lua" — used as chunk name */
  wasiPath: string;
  /** Absolute path on disk — used to read the file content in Node.js */
  physicalPath: string;
  /** Original source file in the workspace */
  sourceFilePath: string;
  /** Widget internal name (from the Lua `name` field), only for widget type */
  widgetName?: string;
  /** Layout + zone from ---@simulate annotation; EdgeTX computes the actual rect */
  zone?: { layout: string; index: number };
}

// ---------------------------------------------------------------------------
// RadioProfile (mirrors the type from @edgetx/simulator-ui without importing it)
// ---------------------------------------------------------------------------

interface RadioProfile {
  name: string;
  wasm: string;
  display: { w: number; h: number; depth: number };
  inputs: any[];
  switches: any[];
  keys: any[];
  trims: any[];
}

// ---------------------------------------------------------------------------
// SimulatorHost
// ---------------------------------------------------------------------------

export class SimulatorHost {
  private panel: vscode.WebviewPanel;
  private storagePath: string;

  private fsWorker: Worker | null = null;
  private wasiThreads: WASIThreads | null = null;
  private exports: SimulatorExports | null = null;

  private analogBuffer = new SharedArrayBuffer(32 * 2);
  private analogValues = new Int16Array(this.analogBuffer);
  private lcdSyncBuffer = new SharedArrayBuffer(4);
  private lcdSync = new Int32Array(this.lcdSyncBuffer);
  private wakeBuffer: SharedArrayBuffer | null = null;

  private wasmLcdBuf = 0;
  private wasmLcdBufSize = 0;

  private lcdRunning = false;
  private keyboardPollInterval: NodeJS.Timeout | null = null;
  private stopped = false;
  private scriptContext: ScriptContext | undefined;
  private scriptLaunched = false;
  private radioStoragePath = "";
  private modelBackup: Map<string, Buffer> | null = null;

  constructor(panel: vscode.WebviewPanel, storagePath: string) {
    this.panel = panel;
    this.storagePath = storagePath;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async start(
    radio: RadioProfile,
    wasmBaseUrl: string,
    script?: ScriptContext,
  ): Promise<void> {
    this.scriptContext = script;
    this.scriptLaunched = false;
    try {
      await this._start(radio, wasmBaseUrl);
    } catch (err: any) {
      if (!this.stopped) {
        this.postMessage({
          type: "simError",
          message: err?.message ?? String(err),
        });
      }
    }
  }

  handleInput(msg: any): void {
    if (!this.exports) {
      return;
    }
    const ex = this.exports;
    switch (msg.type) {
      case "simAnalog": {
        const v = Math.round(Math.max(0, Math.min(4096, msg.value)));
        if (msg.index >= 0 && msg.index < this.analogValues.length) {
          this.analogValues[msg.index] = v;
        }
        break;
      }
      case "simSwitch":
        ex.simuSetSwitch(msg.index, msg.state);
        break;
      case "simKey":
        ex.simuSetKey(msg.key, msg.state);
        break;
      case "simTrim":
        ex.simuSetTrim(msg.trim, msg.state);
        break;
      case "simRotary":
        ex.simuRotaryEncoderEvent(msg.steps);
        break;
      case "simChar":
        ex.simuInjectChar(msg.code);
        break;
      case "simTouch":
        ex.simuTouchDown(msg.x, msg.y);
        break;
      case "simTouchUp":
        ex.simuTouchUp();
        break;
    }
  }

  sendTelemetryFrames(frames: number[][]): void {
    const ex = this.exports;
    if (!ex?.simuSendTelemetry) { return; }
    for (const frameData of frames) {
      if (!frameData.length) { continue; }
      const bytes = new Uint8Array(frameData);
      const ptr = ex.malloc(bytes.length);
      if (!ptr) { continue; }
      new Uint8Array(ex.memory.buffer).set(bytes, ptr);
      ex.simuSendTelemetry(0, 2, ptr, bytes.length); // module=0 (internal), protocol=2 (CRSF)
      ex.free(ptr);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.lcdRunning = false;

    if (this.keyboardPollInterval) {
      clearInterval(this.keyboardPollInterval);
      this.keyboardPollInterval = null;
    }

    if (this.wasiThreads) {
      try {
        this.wasiThreads.terminateAllThreads();
      } catch {}
      this.wasiThreads = null;
    }

    if (this.fsWorker) {
      await this._stopFsWorker();
    }

    // Restore model files that were modified by widget injection, so the next
    // plain simulator open doesn't show the simulated widget.
    if (this.scriptContext?.type === "widget") {
      this._restoreModels();
    }

    this.exports = null;
  }

  // -------------------------------------------------------------------------
  // Private: boot sequence
  // -------------------------------------------------------------------------

  private async _start(
    radio: RadioProfile,
    wasmBaseUrl: string,
  ): Promise<void> {
    const wasmFile = radio.wasm;
    const wasmUrl = `${wasmBaseUrl}/${wasmFile}`;
    const radioKey = wasmFile
      .replace(/\.wasm$/, "")
      .replace(/^edgetx-/, "")
      .replace(/-simulator$/, "");

    // Step 1: Load WASM — use cache when available, re-download only if the
    // server ETag has changed (new EdgeTX build), or if no cache exists yet.
    const wasmCacheDir = path.join(this.storagePath, "wasm");
    const wasmCachePath = path.join(wasmCacheDir, wasmFile);
    const wasmETagPath = wasmCachePath + ".etag";

    let wasmBytes: Uint8Array;

    if (fs.existsSync(wasmCachePath)) {
      const storedETag = fs.existsSync(wasmETagPath)
        ? fs.readFileSync(wasmETagPath, "utf8").trim()
        : null;

      let serverETag: string | null = null;
      try {
        serverETag = await this.fetchETag(wasmUrl);
      } catch {
        // Offline or server error — silently fall back to cache.
      }

      const cacheIsFresh =
        !serverETag || !storedETag || serverETag === storedETag;

      if (cacheIsFresh) {
        this.postMessage({
          type: "simStatus",
          progress: 5,
          status: "Loading firmware…",
        });
        wasmBytes = new Uint8Array(fs.readFileSync(wasmCachePath));
      } else {
        this.postMessage({
          type: "simStatus",
          progress: 5,
          status: "Updating firmware…",
        });
        const { bytes, etag } = await this.downloadWasmWithETag(wasmUrl);
        wasmBytes = bytes;
        fs.writeFileSync(wasmCachePath, wasmBytes);
        if (etag) {
          fs.writeFileSync(wasmETagPath, etag, "utf8");
        }
      }
    } else {
      this.postMessage({
        type: "simStatus",
        progress: 5,
        status: "Downloading firmware…",
      });
      fs.mkdirSync(wasmCacheDir, { recursive: true });
      const { bytes, etag } = await this.downloadWasmWithETag(wasmUrl);
      wasmBytes = bytes;
      fs.writeFileSync(wasmCachePath, wasmBytes);
      if (etag) {
        fs.writeFileSync(wasmETagPath, etag, "utf8");
      }
    }

    if (this.stopped) {
      return;
    }

    // Step 2: Setup filesystem
    // Use the user's configured SD card path if set and exists on disk;
    // otherwise fall back to the extension's own per-radio storage sandbox.
    const configuredSdCard = getEdgeTXConfig()
      .get<string>("sdCardPath")
      ?.trim();
    const usesSdCard = !!(configuredSdCard && fs.existsSync(configuredSdCard));
    const radioStoragePath = usesSdCard
      ? configuredSdCard!
      : path.join(this.storagePath, radioKey);
    this.radioStoragePath = radioStoragePath;

    this.postMessage({
      type: "simStatus",
      progress: 20,
      status: usesSdCard
        ? "Using SD card filesystem…"
        : "Setting up filesystem…",
    });
    this.wakeBuffer = new SharedArrayBuffer(WAKE_BUFFER_SIZE);

    this.fsWorker = new Worker(path.join(__dirname, "fsWorker.js"));
    this.fsWorker.on("message", (msg: any) => {
      if (msg?.type === "trace") {
        // console.log(msg.text);
      }
    });
    this.fsWorker.on("error", (err) => {
      if (!this.stopped) {
        this.postMessage({
          type: "simError",
          message: `FS Worker error: ${err.message}`,
        });
      }
    });

    // Wait for FS worker ready
    await new Promise<void>((resolve, reject) => {
      const onMsg = (msg: any) => {
        if (msg.type === "ready") {
          this.fsWorker!.off("message", onMsg);
          resolve();
        }
      };
      const onErr = (err: Error) => {
        this.fsWorker!.off("message", onMsg);
        reject(err);
      };
      this.fsWorker!.on("message", onMsg);
      this.fsWorker!.once("error", onErr);
      this.fsWorker!.postMessage({
        type: "init",
        storagePath: radioStoragePath,
        wakeBuffer: this.wakeBuffer,
      });
    });

    if (this.stopped) {
      return;
    }

    // Step 3: Load WASM
    this.postMessage({
      type: "simStatus",
      progress: 40,
      status: "Loading WASM…",
    });

    const { initial, maximum } = getMemoryImport(wasmBytes);
    const memory = new WebAssembly.Memory({ initial, maximum, shared: true });

    const readCStr = (ptr: number): string => {
      const view = new Uint8Array(memory.buffer);
      let end = ptr;
      while (view[end] !== 0) {
        end++;
      }
      return new TextDecoder("utf-8").decode(view.subarray(ptr, end));
    };

    const wasi = new WASI({
      version: "preview1",
      fs: stubFs as any,
      preopens: { "/": "/" },
      print: (s: string) => {
        if (s && !this.stopped) this.postMessage({ type: "simLog", text: s, level: "lua" });
      },
      printErr: (s: string) => {
        if (s && !this.stopped) this.postMessage({ type: "simLog", text: s, level: "error" });
      },
    });

    this.wasiThreads = new WASIThreads({
      wasi: wasi as WASIInstance,
      reuseWorker: { size: 4, strict: true },
      waitThreadStart: 1000,
      postMessage: (_msg: any, _transfer?: Transferable[]) => {
        /* main thread: no parent */
      },
      onCreateWorker: () => {
        const worker = new Worker(path.join(__dirname, "wasmWorker.js"));
        worker.postMessage({
          type: "analog-buffer",
          buffer: this.analogBuffer,
        });
        worker.postMessage({ type: "lcd-sync", buffer: this.lcdSyncBuffer });
        // Create FS channel for this WASM worker
        const ctrlBuffer = new SharedArrayBuffer(CTRL_BUFFER_SIZE);
        const dataBuffer = new SharedArrayBuffer(DATA_BUFFER_SIZE);
        this.fsWorker!.postMessage({ type: "channel", ctrlBuffer, dataBuffer });
        worker.postMessage({ type: "wake-buffer", buffer: this.wakeBuffer });
        worker.postMessage({ type: "fs-channel", ctrlBuffer, dataBuffer });
        worker.on("message", (msg: any) => {
          if (msg?.type === "audio" && msg.samples instanceof ArrayBuffer) {
            this.panel.webview.postMessage({
              type: "simAudio",
              samples: msg.samples,
            });
          } else if (msg?.type === "trace" && msg.text && !this.stopped) {
            this.postMessage({ type: "simLog", text: msg.text, level: msg.level ?? "firmware" });
          }
        });
        return worker as any;
      },
    });

    // Start FS worker loop before preloading (WASM workers call FS)
    this.fsWorker.postMessage({ type: "start" });

    if (this.stopped) {
      return;
    }

    // Step 4: Instantiate WASM (no streaming in Node.js)
    this.postMessage({
      type: "simStatus",
      progress: 60,
      status: "Instantiating WASM…",
    });

    const wasiObj = this.wasiThreads.wasi;
    const importObject = {
      wasi_snapshot_preview1: wasiObj.wasiImport as WebAssembly.ModuleImports,
      wasi: {
        ...this.wasiThreads.getImportObject().wasi,
      } as WebAssembly.ModuleImports,
      env: {
        memory,
        simuGetAnalog: (idx: number): number => this.analogValues[idx] ?? 0,
        simuQueueAudio: (buf: number, len: number): void => {
          const copy = new Uint8Array(memory.buffer, buf, len).slice(0).buffer;
          this.panel.webview.postMessage({ type: "simAudio", samples: copy });
        },
        simuTrace: (ptr: number): void => {
          const text = readCStr(ptr);
          if (text && !this.stopped) this.postMessage({ type: "simLog", text, level: "firmware" });
        },
        simuLcdNotify: (): void => {
          Atomics.add(this.lcdSync, 0, 1);
          Atomics.notify(this.lcdSync, 0);
        },
        // Aux serial bridge (firmware -> host). No host-side serial device
        // yet, so these are no-ops — matches the native build's stubs.
        simuAuxSerialStart: (): void => {},
        simuAuxSerialStop: (): void => {},
        simuAuxSerialSetBaudrate: (): void => {},
        simuAuxSerialSendBuffer: (): void => {},
      } as WebAssembly.ModuleImports,
    } as WebAssembly.Imports;

    // Compile to Module first (BufferSource → Module overload), then instantiate
    // wasmBytes comes from https download (plain ArrayBuffer, not SharedArrayBuffer)
    const module = await WebAssembly.compile(wasmBytes.buffer as ArrayBuffer);
    const instance = await WebAssembly.instantiate(module, importObject);

    if (this.stopped) {
      return;
    }
    this.exports = instance.exports as unknown as SimulatorExports;
    this.wasiThreads.initialize(instance, module, memory);

    this.postMessage({
      type: "simStatus",
      progress: 80,
      status: "Starting firmware…",
    });
    await this.wasiThreads.preloadWorkers();

    if (this.stopped) {
      return;
    }

    // Step 5: Boot firmware
    const ex = this.exports;
    ex.simuInit();
    this._setFatfsPaths("/", "/");
    ex.simuCreateDefaults?.();
    ex.simuStart(0);

    this.postMessage({ type: "simLogClear" });
    this.postMessage({ type: "simRunning" });

    // Step 6: Start LCD loop and keyboard polling
    this.lcdRunning = true;
    this._startLcdLoop();
    this._startKeyboardPoll();
  }

  // -------------------------------------------------------------------------
  // Private: LCD loop
  // -------------------------------------------------------------------------

  private _startLcdLoop(): void {
    const run = async () => {
      while (this.lcdRunning && this.exports) {
        const ready = await this.waitForLcdFrame(100);
        if (!this.lcdRunning || !this.exports) {
          break;
        }
        if (!ready) {
          continue;
        }

        const ex = this.exports;
        const lcdDepth = ex.simuLcdGetDepth();
        const lcdW = ex.simuLcdGetWidth();
        const lcdH = ex.simuLcdGetHeight();

        let size: number;
        if (lcdDepth === 1) {
          size = lcdW * ((lcdH + 7) >> 3);
        } else if (lcdDepth === 4) {
          size = (lcdW * lcdH * 4) >> 3;
        } else {
          size = lcdW * lcdH * (lcdDepth >> 3);
        }

        const frame = this.copyLcd(size);
        if (frame) {
          ex.simuLcdFlushed();
          if (!this.stopped) {
            // VS Code postMessage uses structured clone; copy frame data as plain object
            const buf = frame.buffer.slice(
              frame.byteOffset,
              frame.byteOffset + frame.byteLength,
            );
            try {
              this.panel.webview.postMessage({
                type: "simFrame",
                buffer: buf,
                width: lcdW,
                height: lcdH,
                depth: lcdDepth,
              });
            } catch {
              // Panel may be disposed
              this.lcdRunning = false;
            }

            // Launch the script on the very first rendered frame — the firmware
            // is fully initialised and the Lua runtime is ready at this point.
            if (!this.scriptLaunched && this.scriptContext) {
              this.scriptLaunched = true;
              // For widgets: back up the model files BEFORE injecting the widget
              // so we can restore them when the panel closes.
              if (this.scriptContext.type === "widget") {
                this._backupModels();
              }
              this._launchScript(this.scriptContext);
            }
          }
        }
      }
    };
    run().catch((err) => {
      if (!this.stopped) {
        this.postMessage({
          type: "simError",
          message: `LCD loop error: ${err?.message ?? err}`,
        });
      }
    });
  }

  private async waitForLcdFrame(timeout = 100): Promise<boolean> {
    const current = Atomics.load(this.lcdSync, 0);
    const result = Atomics.waitAsync(this.lcdSync, 0, current, timeout);
    if (result.async) {
      const status = await result.value;
      return status === "ok";
    }
    return true;
  }

  private copyLcd(size: number): Uint8Array | null {
    const ex = this.exports;
    if (!ex) {
      return null;
    }

    if (!this.wasmLcdBuf || this.wasmLcdBufSize < size) {
      if (this.wasmLcdBuf) {
        ex.free(this.wasmLcdBuf);
      }
      this.wasmLcdBuf = ex.malloc(size);
      this.wasmLcdBufSize = this.wasmLcdBuf ? size : 0;
      if (!this.wasmLcdBuf) {
        return null;
      }
    }

    const copied = ex.simuLcdCopy(this.wasmLcdBuf, size);
    if (copied === 0) {
      return null;
    }

    const mem = new Uint8Array(ex.memory.buffer, this.wasmLcdBuf, copied);
    const result = new Uint8Array(copied);
    result.set(mem);
    return result;
  }

  // -------------------------------------------------------------------------
  // Private: keyboard mode polling
  // -------------------------------------------------------------------------

  private _startKeyboardPoll(): void {
    let lastMode: "none" | "text" | "number" = "none";
    this.keyboardPollInterval = setInterval(() => {
      const ex = this.exports;
      if (!ex) {
        return;
      }
      const mode: "none" | "text" | "number" =
        ex.simuIsTextKeyboardActive?.() === 1
          ? "text"
          : ex.simuIsNumberKeyboardActive?.() === 1
            ? "number"
            : "none";
      if (mode !== lastMode) {
        lastMode = mode;
        this.postMessage({ type: "simKeyboardMode", mode });
      }
    }, 200);
  }

  // -------------------------------------------------------------------------
  // Private: model backup / restore (widget simulation cleanup)
  // -------------------------------------------------------------------------

  private _backupModels(): void {
    const modelsDir = path.join(this.radioStoragePath, "MODELS");
    try {
      if (!fs.existsSync(modelsDir)) { return; }
      const files = fs.readdirSync(modelsDir).filter((f) => f.endsWith(".yml"));
      this.modelBackup = new Map();
      for (const file of files) {
        const filePath = path.join(modelsDir, file);
        this.modelBackup.set(filePath, fs.readFileSync(filePath));
      }
    } catch {
      this.modelBackup = null;
    }
  }

  private _restoreModels(): void {
    if (!this.modelBackup) { return; }
    for (const [filePath, content] of this.modelBackup) {
      try {
        fs.writeFileSync(filePath, content);
      } catch {
        // best-effort
      }
    }
    this.modelBackup = null;
  }

  // -------------------------------------------------------------------------
  // Private: script launching
  // -------------------------------------------------------------------------

  private _launchScript(script: ScriptContext): void {
    if (script.type === "widget" && script.widgetName) {
      if (script.zone) {
        this._loadWidgetByLayout(script.widgetName, script.zone.layout, script.zone.index);
      } else {
        this._loadWidget(script.widgetName);
      }
    } else if (script.type === "telemetry") {
      this._runScript(script.physicalPath, script.wasiPath);
    }
  }

  private _runScript(physicalPath: string, chunkName: string): void {
    const ex = this.exports;
    if (!ex?.simuRunScriptContent) {
      return;
    }

    let source: Buffer;
    try {
      source = fs.readFileSync(physicalPath);
    } catch (e: any) {
      this.postMessage({
        type: "simError",
        message: `Failed to read script: ${e.message}`,
      });
      return;
    }

    const contentPtr = ex.malloc(source.length);
    const namePtr = this._allocCStr(chunkName);
    try {
      new Uint8Array(ex.memory.buffer).set(source, contentPtr);
      ex.simuRunScriptContent(contentPtr, source.length, namePtr);
    } finally {
      ex.free(contentPtr);
      ex.free(namePtr);
    }
  }

  private _loadWidget(widgetName: string): void {
    const ex = this.exports;
    if (!ex?.simuLoadWidget) { return; }
    const ptr = this._allocCStr(widgetName);
    try {
      ex.simuLoadWidget(ptr);
    } finally {
      ex.free(ptr);
    }
  }

  private _loadWidgetByLayout(widgetName: string, layoutId: string, zoneIndex: number): void {
    const ex = this.exports;
    if (!ex?.simuLoadWidgetByLayout) {
      this._loadWidget(widgetName);
      return;
    }
    const namePtr = this._allocCStr(widgetName);
    const layoutPtr = this._allocCStr(layoutId);
    try {
      ex.simuLoadWidgetByLayout(namePtr, layoutPtr, zoneIndex);
    } finally {
      ex.free(namePtr);
      ex.free(layoutPtr);
    }
  }

  // -------------------------------------------------------------------------
  // Private: FATFS paths
  // -------------------------------------------------------------------------

  private _setFatfsPaths(sdPath: string, settingsPath: string): void {
    const ex = this.exports!;
    const sdPtr = this._allocCStr(sdPath);
    const settingsPtr = this._allocCStr(settingsPath);
    ex.simuFatfsSetPaths(sdPtr, settingsPtr);
    ex.free(sdPtr);
    ex.free(settingsPtr);
  }

  private _allocCStr(s: string): number {
    const ex = this.exports!;
    const encoded = new TextEncoder().encode(s);
    const ptr = ex.malloc(encoded.length + 1);
    if (!ptr) {
      throw new Error("malloc failed");
    }
    const view = new Uint8Array(ex.memory.buffer);
    view.set(encoded, ptr);
    view[ptr + encoded.length] = 0;
    return ptr;
  }

  // -------------------------------------------------------------------------
  // Private: helpers
  // -------------------------------------------------------------------------

  private postMessage(msg: any): void {
    try {
      this.panel.webview.postMessage(msg);
    } catch {
      // Panel may be disposed
    }
  }

  private fetchETag(url: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith("https://") ? https : http;
      const req = (client as typeof https).request(
        url,
        { method: "HEAD" },
        (res) => {
          res.resume();
          if (res.statusCode !== 200) {
            resolve(null);
            return;
          }
          resolve((res.headers["etag"] as string) ?? null);
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  private downloadWasmWithETag(
    url: string,
  ): Promise<{ bytes: Uint8Array; etag: string | null }> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith("https://") ? https : http;
      const req = (client as typeof https).get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(
            new Error(
              `Failed to download WASM: HTTP ${res.statusCode} for ${url}`,
            ),
          );
          res.resume();
          return;
        }
        const etag = (res.headers["etag"] as string) ?? null;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve({
            bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
            etag,
          });
        });
        res.on("error", reject);
      });
      req.on("error", reject);
    });
  }

  private async _stopFsWorker(): Promise<void> {
    if (!this.fsWorker) {
      return;
    }
    await new Promise<void>((resolve) => {
      const handler = (msg: any) => {
        if (msg.type === "stopped") {
          this.fsWorker!.off("message", handler);
          resolve();
        }
      };
      this.fsWorker!.on("message", handler);
      this.fsWorker!.postMessage({ type: "stop" });
      // Timeout safety
      setTimeout(resolve, 3000);
    });
    try {
      this.fsWorker.terminate();
    } catch {}
    this.fsWorker = null;
  }
}
