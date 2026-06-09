import { useEffect, useMemo, useRef, useState } from "react";
import { ExtensionTelemetry } from "./ExtensionTelemetry";
import {
  RadioScreen,
  Joystick,
  SwitchWidget,
  PotKnob,
  PotSlider,
  MultiPosSwitch,
  TrimButton,
  KEY_MAP,
  KEYBOARD_MAP,
} from "@edgetx/simulator-ui";
import type { RadioProfile, RadioInput } from "@edgetx/simulator-ui";

interface FrameData {
  buffer: ArrayBuffer;
  width: number;
  height: number;
  depth: number;
}

interface SimState {
  loading: boolean;
  error: string | null;
  progress: number;
  status: string;
}

interface LogEntry {
  text: string;
  time: number;
  level: "lua" | "firmware" | "error";
}

interface Props {
  radio: RadioProfile;
  frameData: FrameData | null;
  simState: SimState;
  keyboardMode: "none" | "text" | "number";
  onInput: (msg: object) => void;
  showControls: boolean;
  onShowControlsChange: (value: boolean) => void;
  watching: boolean;
  showTelemetry: boolean;
  onShowTelemetryChange: (value: boolean) => void;
  streamingEnabled: boolean;
  onStreamingEnabledChange: (value: boolean) => void;
  onReload: () => void;
  logs: LogEntry[];
  showLogs: boolean;
  onShowLogsChange: (value: boolean) => void;
  onClearLogs: () => void;
}

// ── Helpers (same as Simulator.tsx) ──────────────────────────────────────────

function toAdc(v: number) {
  return Math.round((v + 1) * 2048);
}

function getStickIndices(inputs: RadioInput[]) {
  let lh = -1,
    lv = -1,
    rv = -1,
    rh = -1;
  for (let i = 0; i < inputs.length; i++) {
    if (inputs[i].type === "STICK") {
      if (inputs[i].name === "LH") lh = i;
      else if (inputs[i].name === "LV") lv = i;
      else if (inputs[i].name === "RV") rv = i;
      else if (inputs[i].name === "RH") rh = i;
    }
  }
  return { lh, lv, rv, rh };
}

function getVisibleSwitches(radio: RadioProfile) {
  return radio.switches
    .map((sw, index) => ({ sw, index }))
    .filter(({ sw }) => sw.default !== "NONE" && !sw.name.startsWith("SW"));
}

function getFlexInputs(radio: RadioProfile) {
  return radio.inputs
    .map((input, index) => ({ input, index }))
    .filter(
      ({ input }) =>
        input.type === "FLEX" && input.default && input.default !== "NONE",
    );
}

function getPots(radio: RadioProfile) {
  return getFlexInputs(radio).filter(
    ({ input }) => input.default === "POT" || input.default === "POT_CENTER",
  );
}

function getSliders(radio: RadioProfile) {
  return getFlexInputs(radio).filter(({ input }) => input.default === "SLIDER");
}

function getMultiPos(radio: RadioProfile) {
  return getFlexInputs(radio).find(({ input }) => input.default === "MULTIPOS");
}

// ── Radio button (extension-native, routes via onInput) ──────────────────────

function RadioBtn({
  label,
  keyCode,
  onInput,
}: {
  label: string;
  keyCode: number;
  onInput: (msg: object) => void;
}) {
  return (
    <button
      style={{
        padding: "5px 10px",
        fontSize: 10,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        background: "var(--vscode-button-secondaryBackground, #3a3a3a)",
        color: "var(--vscode-button-secondaryForeground, #ccc)",
        border: "1px solid var(--vscode-panel-border)",
        borderRadius: 3,
        cursor: "pointer",
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
      onMouseDown={() => onInput({ type: "simKey", key: keyCode, state: 1 })}
      onMouseUp={() => onInput({ type: "simKey", key: keyCode, state: 0 })}
      onMouseLeave={() => onInput({ type: "simKey", key: keyCode, state: 0 })}
      onTouchStart={(e) => {
        e.preventDefault();
        onInput({ type: "simKey", key: keyCode, state: 1 });
      }}
      onTouchEnd={() => onInput({ type: "simKey", key: keyCode, state: 0 })}
    >
      {label}
    </button>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <div
      style={{
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: "0.15em",
        textTransform: "uppercase",
        color: "var(--vscode-descriptionForeground)",
        paddingBottom: 6,
        borderBottom: "1px solid var(--vscode-panel-border)",
        marginBottom: 10,
      }}
    >
      {label}
    </div>
  );
}

// ── Log panel ─────────────────────────────────────────────────────────────────

function formatTime(ms: number): string {
  const d = new Date(ms);
  return (
    String(d.getHours()).padStart(2, "0") +
    ":" +
    String(d.getMinutes()).padStart(2, "0") +
    ":" +
    String(d.getSeconds()).padStart(2, "0") +
    "." +
    String(d.getMilliseconds()).padStart(3, "0")
  );
}

const LEVEL_STYLE: Record<"lua" | "firmware" | "error", { label: string; color: string }> = {
  lua:      { label: "lua", color: "var(--vscode-terminal-ansiGreen, #4ec994)" },
  firmware: { label: "fw",  color: "var(--vscode-terminal-ansiBlue, #569cd6)"  },
  error:    { label: "err", color: "var(--vscode-errorForeground, #f48771)"    },
};

function FilterChip({
  label,
  color,
  active,
  onToggle,
  title,
}: {
  label: string;
  color: string;
  active: boolean;
  onToggle: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onToggle}
      title={title}
      style={{
        fontSize: 9,
        padding: "1px 6px",
        borderRadius: 3,
        cursor: "pointer",
        letterSpacing: "0.08em",
        border: `1px solid ${active ? color : "var(--vscode-panel-border)"}`,
        background: "transparent",
        color: active ? color : "var(--vscode-descriptionForeground)",
        fontWeight: active ? 600 : 400,
        opacity: active ? 1 : 0.5,
      }}
    >
      {label}
    </button>
  );
}

function LogPanel({
  logs,
  onClear,
}: {
  logs: LogEntry[];
  onClear: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [showLua, setShowLua] = useState(true);
  const [showFirmware, setShowFirmware] = useState(true);
  const [showError, setShowError] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);

  const filtered = useMemo(() => {
    const noneActive = !showLua && !showFirmware && !showError;
    const q = search.toLowerCase();
    return logs.filter((entry) => {
      const levelMatch =
        noneActive ||
        (showLua && entry.level === "lua") ||
        (showFirmware && entry.level === "firmware") ||
        (showError && entry.level === "error");
      const textMatch = !q || entry.text.toLowerCase().includes(q);
      return levelMatch && textMatch;
    });
  }, [logs, search, showLua, showFirmware, showError]);

  useEffect(() => {
    if (autoScroll) {
      endRef.current?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
    }
  }, [filtered, autoScroll]);

  return (
    <div
      style={{
        borderTop: "1px solid var(--vscode-panel-border)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "8px 12px 6px",
          gap: 6,
        }}
      >
        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            color: "var(--vscode-descriptionForeground)",
            flex: 1,
          }}
        >
          Simulator Log
        </span>
        <FilterChip
          label="Lua"
          color="var(--vscode-terminal-ansiGreen, #4ec994)"
          active={showLua}
          onToggle={() => setShowLua((v) => !v)}
          title="Lua — standard output from your Lua scripts"
        />
        <FilterChip
          label="FW"
          color="var(--vscode-terminal-ansiBlue, #569cd6)"
          active={showFirmware}
          onToggle={() => setShowFirmware((v) => !v)}
          title="FW — internal EdgeTX firmware trace messages"
        />
        <FilterChip
          label="Err"
          color="var(--vscode-errorForeground, #f48771)"
          active={showError}
          onToggle={() => setShowError((v) => !v)}
          title="Err — Lua runtime errors and stderr output"
        />
        <button
          onClick={() => setAutoScroll((v) => !v)}
          title={autoScroll ? "Auto-scroll on — click to disable" : "Auto-scroll off — click to enable"}
          style={{
            fontSize: 9,
            padding: "2px 8px",
            background: "transparent",
            color: autoScroll
              ? "var(--vscode-terminal-ansiGreen, #4ec994)"
              : "var(--vscode-descriptionForeground)",
            border: `1px solid ${autoScroll ? "var(--vscode-terminal-ansiGreen, #4ec994)" : "var(--vscode-panel-border)"}`,
            borderRadius: 3,
            cursor: "pointer",
            opacity: autoScroll ? 1 : 0.5,
          }}
        >
          ↓
        </button>
        <button
          onClick={onClear}
          style={{
            fontSize: 9,
            padding: "2px 8px",
            background: "transparent",
            color: "var(--vscode-descriptionForeground)",
            border: "1px solid var(--vscode-panel-border)",
            borderRadius: 3,
            cursor: "pointer",
            letterSpacing: "0.08em",
          }}
        >
          Clear
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: "0 12px 6px" }}>
        <input
          type="text"
          placeholder="Search logs…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            boxSizing: "border-box" as const,
            background: "var(--vscode-input-background)",
            color: "var(--vscode-input-foreground)",
            border:
              "1px solid var(--vscode-input-border, var(--vscode-panel-border))",
            borderRadius: 3,
            padding: "3px 8px",
            fontSize: 11,
            outline: "none",
          }}
        />
      </div>

      {/* Entries */}
      <div
        style={{
          fontFamily: "var(--vscode-editor-font-family, monospace)",
          fontSize: 11,
          lineHeight: 1.5,
          padding: "4px 12px 12px",
          overflowY: "auto",
          maxHeight: 200,
        }}
      >
        {filtered.length === 0 ? (
          <span
            style={{
              color: "var(--vscode-descriptionForeground)",
              fontSize: 10,
              opacity: 0.6,
            }}
          >
            {logs.length === 0
              ? "No log output yet."
              : "No results for current search or filters."}
          </span>
        ) : (
          filtered.map((entry, i) => {
            const ls = LEVEL_STYLE[entry.level];
            return (
              <div key={i} style={{ display: "flex", gap: 8, minWidth: 0 }}>
                <span
                  style={{
                    color: "var(--vscode-descriptionForeground)",
                    flexShrink: 0,
                    fontSize: 10,
                    userSelect: "none",
                  }}
                >
                  {formatTime(entry.time)}
                </span>
                <span
                  style={{
                    color: ls.color,
                    flexShrink: 0,
                    fontSize: 9,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    userSelect: "none",
                    minWidth: 22,
                  }}
                >
                  {ls.label}
                </span>
                <span
                  style={{
                    color: "var(--vscode-foreground)",
                    wordBreak: "break-all",
                    whiteSpace: "pre-wrap",
                    minWidth: 0,
                    flex: 1,
                  }}
                >
                  {entry.text}
                </span>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ExtensionSimulator({
  radio,
  frameData,
  simState,
  keyboardMode,
  onInput,
  showControls,
  onShowControlsChange,
  watching,
  showTelemetry,
  onShowTelemetryChange,
  streamingEnabled,
  onStreamingEnabledChange,
  onReload,
  logs,
  showLogs,
  onShowLogsChange,
  onClearLogs,
}: Props) {
  const analogRef = useRef<number[]>([]);
  const switchRef = useRef<number[]>([]);
  const springAnimations = useRef<Map<number, number>>(new Map());
  const initializedRef = useRef(false);

  const si = getStickIndices(radio.inputs);
  const switches = getVisibleSwitches(radio);
  const pots = getPots(radio);
  const sliders = getSliders(radio);
  const multipos = getMultiPos(radio);
  const leftKeys = radio.keys.filter((k: { side: string }) => k.side === "L");
  const rightKeys = radio.keys.filter((k: { side: string }) => k.side === "R");

  // Initialize analog/switch state when sim first becomes ready
  useEffect(() => {
    if (frameData && !initializedRef.current) {
      initializedRef.current = true;
      const thrIdx = si.lv;
      analogRef.current = radio.inputs.map((input, i) => {
        if (input.default === "MULTIPOS") return 0;
        if (i === thrIdx) return 0;
        return 2048;
      });
      switchRef.current = radio.switches.map(() => -1);
      analogRef.current.forEach((v, i) =>
        onInput({ type: "simAnalog", index: i, value: v }),
      );
      switchRef.current.forEach((s, i) =>
        onInput({ type: "simSwitch", index: i, state: s }),
      );
    }
  }, [frameData, radio, onInput, si.lv]);

  useEffect(() => {
    initializedRef.current = false;
  }, [radio.wasm]);

  // Keyboard / wheel input
  useEffect(() => {
    const GRANULARITY = 1;

    function handleKey(e: KeyboardEvent) {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
      const down = e.type === "keydown";

      if (keyboardMode === "text") {
        if (!down) {
          if (e.key === "ArrowLeft") {
            onInput({
              type: "simKey",
              key: KEY_MAP["KEY_PAGEUP"] ?? 3,
              state: 0,
            });
            e.preventDefault();
          }
          if (e.key === "ArrowRight") {
            onInput({
              type: "simKey",
              key: KEY_MAP["KEY_PAGEDN"] ?? 4,
              state: 0,
            });
            e.preventDefault();
          }
          return;
        }
        if (e.key.length === 1) {
          const code = e.key.charCodeAt(0);
          if (code >= 32 && code < 127) {
            onInput({ type: "simChar", code });
            e.preventDefault();
            return;
          }
        }
        const textMap: Record<string, () => void> = {
          Backspace: () => onInput({ type: "simChar", code: 8 }),
          Delete: () => onInput({ type: "simChar", code: 127 }),
          ArrowLeft: () =>
            onInput({
              type: "simKey",
              key: KEY_MAP["KEY_PAGEUP"] ?? 3,
              state: 1,
            }),
          ArrowRight: () =>
            onInput({
              type: "simKey",
              key: KEY_MAP["KEY_PAGEDN"] ?? 4,
              state: 1,
            }),
          Enter: () => {
            onInput({
              type: "simKey",
              key: KEY_MAP["KEY_ENTER"] ?? 2,
              state: 1,
            });
            setTimeout(
              () =>
                onInput({
                  type: "simKey",
                  key: KEY_MAP["KEY_ENTER"] ?? 2,
                  state: 0,
                }),
              80,
            );
          },
          Escape: () => {
            onInput({
              type: "simKey",
              key: KEY_MAP["KEY_EXIT"] ?? 1,
              state: 1,
            });
            setTimeout(
              () =>
                onInput({
                  type: "simKey",
                  key: KEY_MAP["KEY_EXIT"] ?? 1,
                  state: 0,
                }),
              80,
            );
          },
          Home: () => {
            onInput({
              type: "simKey",
              key: KEY_MAP["KEY_PAGEUP"] ?? 3,
              state: 1,
            });
            setTimeout(
              () =>
                onInput({
                  type: "simKey",
                  key: KEY_MAP["KEY_PAGEUP"] ?? 3,
                  state: 0,
                }),
              800,
            );
          },
          End: () => {
            onInput({
              type: "simKey",
              key: KEY_MAP["KEY_PAGEDN"] ?? 4,
              state: 1,
            });
            setTimeout(
              () =>
                onInput({
                  type: "simKey",
                  key: KEY_MAP["KEY_PAGEDN"] ?? 4,
                  state: 0,
                }),
              800,
            );
          },
        };
        textMap[e.key]?.();
        if (e.key !== "Tab") e.preventDefault();
        return;
      }

      if (keyboardMode === "number") {
        if (!down) {
          if (e.key === "ArrowUp") {
            onInput({
              type: "simKey",
              key: KEY_MAP["KEY_PAGEDN"] ?? 4,
              state: 0,
            });
            e.preventDefault();
          }
          if (e.key === "ArrowDown") {
            onInput({
              type: "simKey",
              key: KEY_MAP["KEY_PAGEUP"] ?? 3,
              state: 0,
            });
            e.preventDefault();
          }
          return;
        }
        if (e.key === "ArrowUp") {
          onInput({
            type: "simKey",
            key: KEY_MAP["KEY_PAGEDN"] ?? 4,
            state: 1,
          });
          e.preventDefault();
          return;
        }
        if (e.key === "ArrowDown") {
          onInput({
            type: "simKey",
            key: KEY_MAP["KEY_PAGEUP"] ?? 3,
            state: 1,
          });
          e.preventDefault();
          return;
        }
        return;
      }

      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        if (down)
          onInput({
            type: "simRotary",
            steps: e.key === "ArrowUp" ? -GRANULARITY : GRANULARITY,
          });
        e.preventDefault();
        return;
      }
      const keyName = KEYBOARD_MAP[e.key];
      if (!keyName) return;
      onInput({
        type: "simKey",
        key: KEY_MAP[keyName] ?? 0,
        state: down ? 1 : 0,
      });
      e.preventDefault();
    }

    document.addEventListener("keydown", handleKey);
    document.addEventListener("keyup", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("keyup", handleKey);
    };
  }, [keyboardMode, onInput]);

  function updateAnalog(index: number, value: number) {
    const v = Math.round(Math.max(0, Math.min(4096, value)));
    analogRef.current[index] = v;
    onInput({ type: "simAnalog", index, value: v });
  }

  function updateSwitch(index: number, state: number) {
    switchRef.current[index] = state;
    onInput({ type: "simSwitch", index, state });
  }

  function springTo(index: number, target: number) {
    const existing = springAnimations.current.get(index);
    if (existing) cancelAnimationFrame(existing);
    let pos = analogRef.current[index] ?? 2048;
    let vel = 0,
      prev = 0;
    const stiffness = 600,
      damping = 25;
    const tick = (now: number) => {
      if (prev === 0) prev = now;
      const dt = Math.min((now - prev) / 1000, 0.033);
      prev = now;
      const force = (target - pos) * stiffness;
      vel = (vel + force * dt) * Math.exp(-damping * dt);
      pos += vel * dt;
      updateAnalog(index, Math.round(pos));
      if (Math.abs(pos - target) < 1 && Math.abs(vel) < 10) {
        updateAnalog(index, target);
        springAnimations.current.delete(index);
        return;
      }
      springAnimations.current.set(index, requestAnimationFrame(tick));
    };
    springAnimations.current.set(index, requestAnimationFrame(tick));
  }

  function applyGimbal(side: "left" | "right", nx: number, ny: number) {
    if (side === "left") {
      if (si.lh >= 0) updateAnalog(si.lh, toAdc(nx));
      if (si.lv >= 0) updateAnalog(si.lv, toAdc(-ny));
    } else {
      if (si.rh >= 0) updateAnalog(si.rh, toAdc(nx));
      if (si.rv >= 0) updateAnalog(si.rv, toAdc(-ny));
    }
  }

  function releaseGimbal(side: "left" | "right") {
    const thrIdx = si.lv;
    if (side === "left") {
      if (si.lh >= 0) springTo(si.lh, 2048);
      if (si.lv >= 0 && si.lv !== thrIdx) springTo(si.lv, 2048);
    } else {
      if (si.rh >= 0) springTo(si.rh, 2048);
      if (si.rv >= 0) springTo(si.rv, 2048);
    }
  }

  function trimSwitchIndex(trimIndex: number, direction: "dec" | "inc") {
    const maxMain = Math.min(radio.trims.length, 4);
    const base =
      trimIndex < maxMain ? (maxMain - 1 - trimIndex) * 2 : trimIndex * 2;
    return base + (direction === "inc" ? 1 : 0);
  }

  const { loading, error, progress, status } = simState;
  const isReady = !loading && !error;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
        background: "var(--vscode-editor-background)",
        color: "var(--vscode-foreground)",
        fontFamily: "var(--vscode-font-family)",
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "6px 12px",
          borderBottom: "1px solid var(--vscode-panel-border)",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            flex: 1,
            fontSize: 11,
            opacity: 0.6,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {radio.name}
        </span>
        {watching && (
          <span
            style={{
              fontSize: 9,
              padding: "2px 6px",
              borderRadius: 3,
              background: "var(--vscode-inputValidation-infoBorder)",
              color: "var(--vscode-editor-background)",
              letterSpacing: "0.08em",
              fontWeight: 600,
            }}
          >
            ● WATCHING
          </span>
        )}
        {keyboardMode !== "none" && (
          <span
            style={{
              fontSize: 9,
              padding: "2px 6px",
              borderRadius: 3,
              background: "var(--vscode-badge-background)",
              color: "var(--vscode-badge-foreground)",
              letterSpacing: "0.08em",
            }}
          >
            ⌨ {keyboardMode === "text" ? "TYPE" : "NUM"}
          </span>
        )}

        {isReady && (
          <button
            onClick={() => onShowControlsChange(!showControls)}
            style={{
              fontSize: 11,
              padding: "3px 10px",
              background: showControls
                ? "var(--vscode-button-background)"
                : "transparent",
              color: showControls
                ? "var(--vscode-button-foreground)"
                : "var(--vscode-foreground)",
              border:
                "1px solid var(--vscode-button-border, var(--vscode-panel-border))",
              borderRadius: 3,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {showControls ? "Hide Controls" : "Show Controls"}
          </button>
        )}
        {isReady && (
          <button
            onClick={() => onShowTelemetryChange(!showTelemetry)}
            style={{
              fontSize: 11,
              padding: "3px 10px",
              background: showTelemetry
                ? "var(--vscode-button-background)"
                : "transparent",
              color: showTelemetry
                ? "var(--vscode-button-foreground)"
                : "var(--vscode-foreground)",
              border:
                "1px solid var(--vscode-button-border, var(--vscode-panel-border))",
              borderRadius: 3,
              cursor: "pointer",
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            {streamingEnabled && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--vscode-progressBar-background, #007acc)",
                  flexShrink: 0,
                  animation: "pulse 1.2s infinite",
                }}
              />
            )}
            Telemetry
          </button>
        )}
        {isReady && (
          <button
            onClick={() => onShowLogsChange(!showLogs)}
            style={{
              fontSize: 11,
              padding: "3px 10px",
              background: showLogs
                ? "var(--vscode-button-background)"
                : "transparent",
              color: showLogs
                ? "var(--vscode-button-foreground)"
                : "var(--vscode-foreground)",
              border:
                "1px solid var(--vscode-button-border, var(--vscode-panel-border))",
              borderRadius: 3,
              cursor: "pointer",
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            {logs.length > 0 && (
              <span
                style={{
                  fontSize: 9,
                  padding: "0 4px",
                  borderRadius: 3,
                  background: "var(--vscode-badge-background)",
                  color: "var(--vscode-badge-foreground)",
                  lineHeight: "16px",
                }}
              >
                {logs.length > 999 ? "999+" : logs.length}
              </span>
            )}
            Logs
          </button>
        )}
        <button
          onClick={onReload}
          title="Reload simulation"
          style={{
            fontSize: 16,
            lineHeight: 1,
            padding: "2px 6px",
            background: "transparent",
            color: "var(--vscode-foreground)",
            border:
              "1px solid var(--vscode-button-border, var(--vscode-panel-border))",
            borderRadius: 3,
            cursor: "pointer",
          }}
        >
          ↻
        </button>
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>

      {/* ── LCD Screen ─────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          padding: "16px 12px 12px",
          flexShrink: 0,
        }}
      >
        {loading && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              width: "100%",
              maxWidth: 300,
            }}
          >
            <span
              style={{
                fontSize: 11,
                opacity: 0.6,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              {status}
            </span>
            <div
              style={{
                width: "100%",
                height: 3,
                background: "var(--vscode-panel-border)",
                borderRadius: 9999,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${progress}%`,
                  background: "var(--vscode-progressBar-background)",
                  borderRadius: 9999,
                  transition: "width 0.3s",
                }}
              />
            </div>
          </div>
        )}
        {error && (
          <div
            style={{
              fontSize: 12,
              color: "var(--vscode-errorForeground)",
              fontFamily: "monospace",
              padding: "8px 0",
            }}
          >
            {error}
          </div>
        )}
        {isReady && (
          <div
            onWheel={(e) => {
              e.stopPropagation();
              if (keyboardMode !== "none") return;
              onInput({ type: "simRotary", steps: e.deltaY > 0 ? 1 : -1 });
            }}
            style={{
              padding: 10,
              borderRadius: 8,
              background: "var(--vscode-sideBar-background, #1e1e1e)",
              border: "2px solid var(--vscode-panel-border)",
              boxShadow:
                "0 4px 16px rgba(0,0,0,0.4), inset 0 1px 3px rgba(0,0,0,0.6)",
            }}
          >
            <RadioScreen
              frameData={frameData}
              width={radio.display.w}
              height={radio.display.h}
              depth={radio.display.depth}
              onTouch={(x, y) => onInput({ type: "simTouch", x, y })}
              onTouchUp={() => onInput({ type: "simTouchUp" })}
            />
          </div>
        )}
      </div>

      {/* ── Scrollable area: controls + telemetry ──────────────────────────── */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* Controls Panel */}
        {isReady && showControls && (
          <div
            style={{
              borderTop: "1px solid var(--vscode-panel-border)",
              padding: "14px 12px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            {/* Buttons */}
            {(leftKeys.length > 0 || rightKeys.length > 0) && (
              <div>
                <SectionLabel label="Buttons" />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-around",
                    gap: 12,
                  }}
                >
                  {leftKeys.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      {leftKeys.map((k) => (
                        <RadioBtn
                          key={k.key}
                          label={k.label}
                          keyCode={KEY_MAP[k.key] ?? 0}
                          onInput={onInput}
                        />
                      ))}
                    </div>
                  )}
                  {rightKeys.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      {rightKeys.map((k) => (
                        <RadioBtn
                          key={k.key}
                          label={k.label}
                          keyCode={KEY_MAP[k.key] ?? 0}
                          onInput={onInput}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Switches */}
            {switches.length > 0 && (
              <div>
                <SectionLabel label="Switches" />
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 12,
                    justifyContent: "center",
                  }}
                >
                  {switches.map(({ sw, index }) => (
                    <SwitchWidget
                      key={sw.name}
                      name={sw.name}
                      type={sw.default === "TOGGLE" ? "MOMENT" : sw.type}
                      onChange={(pos) => updateSwitch(index, pos)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Sticks */}
            {(si.lh >= 0 || si.lv >= 0 || si.rh >= 0 || si.rv >= 0) && (
              <div>
                <SectionLabel label="Sticks" />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-around",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  {(si.lh >= 0 || si.lv >= 0) && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <span style={{ fontSize: 9, opacity: 0.5 }}>LEFT</span>
                      <Joystick
                        springX
                        springY={false}
                        initialY={1}
                        size={100}
                        onInput={(nx, ny) => applyGimbal("left", nx, ny)}
                        onRelease={() => releaseGimbal("left")}
                      />
                    </div>
                  )}
                  {(si.rh >= 0 || si.rv >= 0) && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <span style={{ fontSize: 9, opacity: 0.5 }}>RIGHT</span>
                      <Joystick
                        springX
                        springY
                        size={100}
                        onInput={(nx, ny) => applyGimbal("right", nx, ny)}
                        onRelease={() => releaseGimbal("right")}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Pots & Sliders */}
            {(pots.length > 0 || sliders.length > 0) && (
              <div>
                <SectionLabel label="Pots & Sliders" />
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 16,
                    justifyContent: "center",
                    alignItems: "flex-end",
                  }}
                >
                  {pots.map(({ input, index }) => (
                    <PotKnob
                      key={input.name}
                      id={index}
                      name={input.label}
                      onValue={(v) =>
                        updateAnalog(index, Math.round((v / 100 + 1) * 2048))
                      }
                    />
                  ))}
                  {sliders.map(({ input, index }) => (
                    <PotSlider
                      key={input.name}
                      id={index}
                      name={input.label}
                      onValue={(v) =>
                        updateAnalog(index, Math.round((v / 100 + 1) * 2048))
                      }
                    />
                  ))}
                </div>
              </div>
            )}

            {/* MultiPos */}
            {multipos && (
              <div>
                <SectionLabel label="Multi-Position" />
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <MultiPosSwitch
                    id={multipos.index}
                    name={multipos.input.label}
                    onValue={(pos) =>
                      updateAnalog(multipos.index, Math.round((pos * 4096) / 5))
                    }
                  />
                </div>
              </div>
            )}

            {/* Trims */}
            {radio.trims.length > 0 && (
              <div>
                <SectionLabel label="Trims" />
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                    justifyContent: "center",
                  }}
                >
                  {radio.trims.map((trim, i) => (
                    <div
                      key={trim.name}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <span style={{ fontSize: 9, opacity: 0.5 }}>
                        {trim.name}
                      </span>
                      <div style={{ display: "flex", gap: 4 }}>
                        <TrimButton
                          label="−"
                          onPress={() =>
                            onInput({
                              type: "simTrim",
                              trim: trimSwitchIndex(i, "dec"),
                              state: 1,
                            })
                          }
                          onRelease={() =>
                            onInput({
                              type: "simTrim",
                              trim: trimSwitchIndex(i, "dec"),
                              state: 0,
                            })
                          }
                        />
                        <TrimButton
                          label="+"
                          onPress={() =>
                            onInput({
                              type: "simTrim",
                              trim: trimSwitchIndex(i, "inc"),
                              state: 1,
                            })
                          }
                          onRelease={() =>
                            onInput({
                              type: "simTrim",
                              trim: trimSwitchIndex(i, "inc"),
                              state: 0,
                            })
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Telemetry Panel */}
        {isReady && showTelemetry && (
          <ExtensionTelemetry
            onInput={onInput}
            enabled={streamingEnabled}
            onEnabledChange={onStreamingEnabledChange}
          />
        )}

        {/* Log Panel */}
        {isReady && showLogs && (
          <LogPanel logs={logs} onClear={onClearLogs} />
        )}
      </div>
      {/* end shared scrollable */}
    </div>
  );
}
