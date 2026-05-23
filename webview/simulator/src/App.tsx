import { useState, useEffect, useCallback, useRef } from "react";
import { SimulatorThemeProvider } from "@edgetx/simulator-ui";
import type { RadioProfile } from "@edgetx/simulator-ui";
import { ExtensionSimulator } from "./ExtensionSimulator";

// VS Code WebView API
declare function acquireVsCodeApi(): {
  postMessage(msg: object, transfer?: Transferable[]): void;
};

const vscode =
  typeof acquireVsCodeApi !== "undefined" ? acquireVsCodeApi() : null;

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

export function App() {
  const [radio, setRadio] = useState<RadioProfile | null>(null);
  const [active, setActive] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextAudioTimeRef = useRef<number>(0);
  const [frameData, setFrameData] = useState<FrameData | null>(null);
  const [simState, setSimState] = useState<SimState>({
    loading: false,
    error: null,
    progress: 0,
    status: "",
  });
  const [keyboardMode, setKeyboardMode] = useState<"none" | "text" | "number">("none");
  const [showControls, setShowControls] = useState(false);
  const [watching, setWatching] = useState(false);
  const [showTelemetry, setShowTelemetry] = useState(false);
  const [streamingEnabled, setStreamingEnabled] = useState(false);
  // False until the first message from the extension arrives, preventing the
  // "No radio profile set" screen from flashing during the ready round-trip.
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const msg = e.data;
      if (!msg || !msg.type) return;

      // First message from the extension — safe to show real UI now
      setInitialized(true);

      switch (msg.type) {
        case "setRadio":
          setRadio(msg.radio);
          setFrameData(null);
          // Keep loading:true so ExtensionSimulator shows the bar immediately,
          // without waiting for the first simStatus from the host
          setSimState({ loading: true, error: null, progress: 0, status: "Starting…" });
          setKeyboardMode("none");
          break;
        case "setActive":
          setActive(msg.active);
          break;
        case "simFrame":
          setFrameData({
            buffer: msg.buffer,
            width: msg.width,
            height: msg.height,
            depth: msg.depth,
          });
          break;
        case "simStatus":
          setSimState({
            loading: true,
            error: null,
            progress: msg.progress,
            status: msg.status,
          });
          break;
        case "simError":
          setSimState({
            loading: false,
            error: msg.message,
            progress: 0,
            status: "Failed",
          });
          break;
        case "simRunning":
          setSimState((s) => ({ ...s, loading: false }));
          break;
        case "simKeyboardMode":
          setKeyboardMode(msg.mode);
          break;
        case "uiState":
          if (typeof msg.showControls === "boolean") setShowControls(msg.showControls);
          if (typeof msg.showTelemetry === "boolean") setShowTelemetry(msg.showTelemetry);
          if (typeof msg.streamingEnabled === "boolean") setStreamingEnabled(msg.streamingEnabled);
          break;
        case "setWatching":
          setWatching(!!msg.active);
          break;
        case "simAudio": {
          if (!audioCtxRef.current) {
            audioCtxRef.current = new AudioContext({ sampleRate: 32000 });
            nextAudioTimeRef.current = audioCtxRef.current.currentTime;
          }
          const ctx = audioCtxRef.current;
          if (ctx.state === "suspended") {
            ctx.resume();
          }
          const samples = new Int16Array(msg.samples);
          if (samples.length === 0) break;
          const float32 = new Float32Array(samples.length);
          for (let i = 0; i < samples.length; i++) float32[i] = samples[i] / 32768;
          const buf = ctx.createBuffer(1, float32.length, 32000);
          buf.copyToChannel(float32, 0);
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(ctx.destination);
          const startTime = Math.max(ctx.currentTime, nextAudioTimeRef.current);
          src.start(startTime);
          nextAudioTimeRef.current = startTime + buf.duration;
          break;
        }
      }
    };

    window.addEventListener("message", handler);
    // Tell extension we're ready
    vscode?.postMessage({ type: "ready" });

    return () => window.removeEventListener("message", handler);
  }, []);

  const sendInput = useCallback((msg: object) => {
    vscode?.postMessage(msg);
  }, []);

  const handleShowControlsChange = useCallback((value: boolean) => {
    setShowControls(value);
    vscode?.postMessage({ type: "setShowControls", value });
  }, []);

  const handleShowTelemetryChange = useCallback((value: boolean) => {
    setShowTelemetry(value);
    vscode?.postMessage({ type: "setShowTelemetry", value });
  }, []);

  const handleStreamingEnabledChange = useCallback((value: boolean) => {
    setStreamingEnabled(value);
    vscode?.postMessage({ type: "setStreamingEnabled", value });
  }, []);

  const handleReload = useCallback(() => {
    vscode?.postMessage({ type: "reload" });
  }, []);

  // Blank until the first message arrives — prevents "No radio profile set"
  // from flashing during the ready round-trip on panel open.
  if (!initialized) {
    return (
      <div style={{ height: "100vh", background: "var(--vscode-editor-background)" }} />
    );
  }

  if (!radio || !active) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          gap: 12,
          color: "var(--vscode-foreground)",
          fontFamily: "var(--vscode-font-family)",
        }}
      >
        <span style={{ fontSize: 13, opacity: 0.5 }}>
          {!radio ? "No radio profile set" : "Simulation paused"}
        </span>
        {!radio && (
          <button
            onClick={() => vscode?.postMessage({ type: "setProfile" })}
            style={{
              padding: "6px 16px",
              background: "var(--vscode-button-background)",
              color: "var(--vscode-button-foreground)",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Set Radio Profile
          </button>
        )}
      </div>
    );
  }

  return (
    <SimulatorThemeProvider theme="vscode">
      <ExtensionSimulator
        radio={radio}
        frameData={frameData}
        simState={simState}
        keyboardMode={keyboardMode}
        onInput={sendInput}
        showControls={showControls}
        onShowControlsChange={handleShowControlsChange}
        watching={watching}
        showTelemetry={showTelemetry}
        onShowTelemetryChange={handleShowTelemetryChange}
        streamingEnabled={streamingEnabled}
        onStreamingEnabledChange={handleStreamingEnabledChange}
        onReload={handleReload}
      />
    </SimulatorThemeProvider>
  );
}
