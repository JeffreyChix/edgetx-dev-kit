import { useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// CRSF constants
// ---------------------------------------------------------------------------

const CRSF_ADDR = 0xc8;
const PROTOCOL_CRSF = 2;
const MODULE = 0;

const LINK_ID = 0x14;
const BATTERY_ID = 0x08;
const ATTITUDE_ID = 0x1e;
const GPS_ID = 0x02;
const FLIGHT_MODE_ID = 0x21;
const VARIO_ID = 0x07; // vertical speed

const TX_POWER_MW = [0, 10, 25, 100, 500, 1000, 2000, 250, 50];

// ---------------------------------------------------------------------------
// Frame builders
// ---------------------------------------------------------------------------

function i16be(buf: Uint8Array, off: number, v: number) {
  buf[off] = (v >> 8) & 0xff;
  buf[off + 1] = v & 0xff;
}
function i32be(buf: Uint8Array, off: number, v: number) {
  buf[off] = (v >> 24) & 0xff;
  buf[off + 1] = (v >> 16) & 0xff;
  buf[off + 2] = (v >> 8) & 0xff;
  buf[off + 3] = v & 0xff;
}
function i24be(buf: Uint8Array, off: number, v: number) {
  buf[off] = (v >> 16) & 0xff;
  buf[off + 1] = (v >> 8) & 0xff;
  buf[off + 2] = v & 0xff;
}

function buildLinkFrame(l: LinkValues): number[] {
  const buf = new Uint8Array(13);
  buf[0] = CRSF_ADDR; buf[1] = 11; buf[2] = LINK_ID;
  buf[3] = l.rx_rssi1 & 0xff; buf[4] = l.rx_rssi2 & 0xff;
  buf[5] = l.rx_quality & 0xff; buf[6] = l.rx_snr & 0xff;
  buf[7] = l.antenna & 0xff; buf[8] = l.rf_mode & 0xff;
  buf[9] = l.tx_power_idx & 0xff; buf[10] = l.tx_rssi & 0xff;
  buf[11] = l.tx_quality & 0xff; buf[12] = l.tx_snr & 0xff;
  return Array.from(buf);
}

function buildBatteryFrame(b: BatteryValues): number[] {
  const buf = new Uint8Array(12);
  buf[0] = CRSF_ADDR; buf[1] = 10; buf[2] = BATTERY_ID;
  i16be(buf, 3, b.voltage);
  i16be(buf, 5, b.current);
  i24be(buf, 7, b.capacity);
  buf[10] = b.remaining & 0xff;
  return Array.from(buf);
}

function buildAttitudeFrame(a: AttitudeValues): number[] {
  const buf = new Uint8Array(9);
  buf[0] = CRSF_ADDR; buf[1] = 7; buf[2] = ATTITUDE_ID;
  i16be(buf, 3, Math.round(a.pitch * 10000));
  i16be(buf, 5, Math.round(a.roll * 10000));
  i16be(buf, 7, Math.round(a.yaw * 10000));
  return Array.from(buf);
}

function buildGpsFrame(g: GpsValues): number[] {
  const buf = new Uint8Array(19);
  buf[0] = CRSF_ADDR; buf[1] = 17; buf[2] = GPS_ID;
  i32be(buf, 3, g.lat);
  i32be(buf, 7, g.lon);
  i16be(buf, 11, 0);
  i16be(buf, 13, g.heading);
  i16be(buf, 15, g.altitude + 1000);
  buf[17] = g.satellites & 0xff;
  return Array.from(buf);
}

function buildFlightModeFrame(mode: string): number[] {
  const text = mode.slice(0, 13);
  const encoded = new TextEncoder().encode(text);
  const payloadLen = 3 + encoded.length;
  const buf = new Uint8Array(2 + payloadLen);
  buf[0] = CRSF_ADDR; buf[1] = payloadLen; buf[2] = FLIGHT_MODE_ID;
  buf.set(encoded, 3);
  return Array.from(buf);
}

function buildVarioFrame(vspdCmps: number): number[] {
  const buf = new Uint8Array(5);
  buf[0] = CRSF_ADDR; buf[1] = 3; buf[2] = VARIO_ID;
  i16be(buf, 3, vspdCmps);
  return Array.from(buf);
}

// ---------------------------------------------------------------------------
// Value interfaces
// ---------------------------------------------------------------------------

interface LinkValues {
  rx_rssi1: number; rx_rssi2: number; rx_quality: number; rx_snr: number;
  antenna: number; rf_mode: number; tx_power_idx: number;
  tx_rssi: number; tx_quality: number; tx_snr: number;
}
interface BatteryValues { voltage: number; current: number; capacity: number; remaining: number; }
interface AttitudeValues { pitch: number; roll: number; yaw: number; }
interface GpsValues { lat: number; lon: number; altitude: number; satellites: number; heading: number; }
interface FlightValues { flightMode: string; vspd: number; }

const DEFAULT_LINK: LinkValues = {
  rx_rssi1: -70, rx_rssi2: -80, rx_quality: 100, rx_snr: 15,
  antenna: 1, rf_mode: 4, tx_power_idx: 3, tx_rssi: -65, tx_quality: 99, tx_snr: 12,
};
const DEFAULT_BATTERY: BatteryValues = { voltage: 168, current: 50, capacity: 500, remaining: 80 };
const DEFAULT_ATTITUDE: AttitudeValues = { pitch: 0, roll: 0, yaw: 0 };
const DEFAULT_GPS: GpsValues = { lat: 437654321, lon: -792345678, altitude: 100, satellites: 8, heading: 0 };
const DEFAULT_FLIGHT: FlightValues = { flightMode: "Angle", vspd: 0 };

// ---------------------------------------------------------------------------
// Shared input component (VS Code–styled)
// ---------------------------------------------------------------------------

function TelField({
  label, value, onChange, min, max, step = 1, unit,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step?: number; unit?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
      <span style={{
        fontSize: 10, color: "var(--vscode-descriptionForeground)",
        width: 44, flexShrink: 0, letterSpacing: "0.04em",
      }}>
        {label}
      </span>
      <input
        type="number" value={value} min={min} max={max} step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          flex: 1, minWidth: 0,
          background: "var(--vscode-input-background)",
          color: "var(--vscode-input-foreground)",
          border: "1px solid var(--vscode-input-border, var(--vscode-panel-border))",
          borderRadius: 3, padding: "2px 6px", fontSize: 11,
          textAlign: "right", outline: "none",
        }}
      />
      {unit && (
        <span style={{ fontSize: 9, color: "var(--vscode-descriptionForeground)", width: 28, flexShrink: 0 }}>
          {unit}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type Tab = "link" | "gps" | "attitude" | "battery" | "flight";

interface Props {
  onInput: (msg: object) => void;
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
}

export function ExtensionTelemetry({ onInput, enabled, onEnabledChange }: Props) {
  const [tab, setTab] = useState<Tab>("link");
  const [link, setLink] = useState<LinkValues>(DEFAULT_LINK);
  const [battery, setBattery] = useState<BatteryValues>(DEFAULT_BATTERY);
  const [attitude, setAttitude] = useState<AttitudeValues>(DEFAULT_ATTITUDE);
  const [gps, setGps] = useState<GpsValues>(DEFAULT_GPS);
  const [flight, setFlight] = useState<FlightValues>(DEFAULT_FLIGHT);

  // 10 Hz streaming loop
  useEffect(() => {
    if (!enabled) { return; }
    const id = setInterval(() => {
      onInput({
        type: "simTelemetryBatch",
        frames: [
          buildLinkFrame(link),
          buildBatteryFrame(battery),
          buildAttitudeFrame(attitude),
          buildGpsFrame(gps),
          buildFlightModeFrame(flight.flightMode),
          buildVarioFrame(Math.round(flight.vspd * 100)),
        ],
        module: MODULE,
        protocol: PROTOCOL_CRSF,
      });
    }, 100);
    return () => clearInterval(id);
  }, [enabled, link, battery, attitude, gps, flight, onInput]);

  const ul = (k: keyof LinkValues) => (v: number) => setLink((s) => ({ ...s, [k]: v }));
  const ub = (k: keyof BatteryValues) => (v: number) => setBattery((s) => ({ ...s, [k]: v }));
  const ua = (k: keyof AttitudeValues) => (v: number) => setAttitude((s) => ({ ...s, [k]: v }));
  const ug = (k: keyof GpsValues) => (v: number) => setGps((s) => ({ ...s, [k]: v }));
  const uf = (k: keyof FlightValues) => (v: number | string) =>
    setFlight((s) => ({ ...s, [k]: v }));

  const TABS: Tab[] = ["link", "gps", "attitude", "battery", "flight"];

  return (
    <div style={{
      borderTop: "1px solid var(--vscode-panel-border)",
      display: "flex", flexDirection: "column",
    }}>
      {/* Panel header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 12px 0",
      }}>
        <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--vscode-descriptionForeground)", flex: 1 }}>
          Telemetry
        </span>
        {/* Streaming toggle */}
        <div
          onClick={() => onEnabledChange(!enabled)}
          style={{
            display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
            padding: "2px 8px", borderRadius: 3,
            background: enabled ? "var(--vscode-inputValidation-infoBorder, #007acc22)" : "transparent",
            border: `1px solid ${enabled ? "var(--vscode-inputValidation-infoBorder, #007acc)" : "var(--vscode-panel-border)"}`,
          }}
        >
          <span style={{
            width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
            background: enabled ? "var(--vscode-progressBar-background, #007acc)" : "var(--vscode-descriptionForeground)",
            opacity: enabled ? 1 : 0.4,
            animation: enabled ? "pulse 1.2s infinite" : "none",
          }} />
          <span style={{ fontSize: 9, letterSpacing: "0.08em", color: enabled ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)" }}>
            {enabled ? "STREAMING" : "OFF"}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", padding: "6px 12px 0", gap: 2 }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase",
              padding: "3px 8px", cursor: "pointer", border: "none",
              borderBottom: `2px solid ${tab === t ? "var(--vscode-focusBorder, #007acc)" : "transparent"}`,
              background: "transparent",
              color: tab === t ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ padding: "8px 12px 12px", overflowY: "auto", maxHeight: 220 }}>
        {tab === "link" && (
          <>
            <TelField label="1RSS" value={link.rx_rssi1} onChange={ul("rx_rssi1")} min={-120} max={0} unit="dB" />
            <TelField label="2RSS" value={link.rx_rssi2} onChange={ul("rx_rssi2")} min={-120} max={0} unit="dB" />
            <TelField label="Rqly" value={link.rx_quality} onChange={ul("rx_quality")} min={0} max={100} unit="%" />
            <TelField label="RSNR" value={link.rx_snr} onChange={ul("rx_snr")} min={-30} max={50} unit="dB" />
            <TelField label="RFMD" value={link.rf_mode} onChange={ul("rf_mode")} min={0} max={8} />
            <TelField label="ANT" value={link.antenna} onChange={ul("antenna")} min={0} max={1} />
            <TelField label="TPWR" value={TX_POWER_MW[link.tx_power_idx] ?? 0}
              onChange={(v) => { const i = TX_POWER_MW.indexOf(v); if (i >= 0) ul("tx_power_idx")(i); }}
              min={0} max={2000} unit="mW" />
            <TelField label="TRSS" value={link.tx_rssi} onChange={ul("tx_rssi")} min={-120} max={0} unit="dB" />
            <TelField label="TQly" value={link.tx_quality} onChange={ul("tx_quality")} min={0} max={100} unit="%" />
            <TelField label="TSNR" value={link.tx_snr} onChange={ul("tx_snr")} min={-30} max={50} unit="dB" />
          </>
        )}

        {tab === "gps" && (
          <>
            <TelField label="Lat" value={gps.lat / 1e7} onChange={(v) => ug("lat")(Math.round(v * 1e7))} min={-90} max={90} step={0.0001} unit="°" />
            <TelField label="Lon" value={gps.lon / 1e7} onChange={(v) => ug("lon")(Math.round(v * 1e7))} min={-180} max={180} step={0.0001} unit="°" />
            <TelField label="Alt" value={gps.altitude} onChange={ug("altitude")} min={-500} max={10000} unit="m" />
            <TelField label="Sats" value={gps.satellites} onChange={ug("satellites")} min={0} max={20} />
            <TelField label="Hdg" value={gps.heading / 100} onChange={(v) => ug("heading")(Math.round(v * 100))} min={0} max={360} step={0.1} unit="°" />
          </>
        )}

        {tab === "attitude" && (
          <>
            <TelField label="Ptch" value={attitude.pitch} onChange={ua("pitch")} min={-3.14} max={3.14} step={0.01} unit="rad" />
            <TelField label="Roll" value={attitude.roll} onChange={ua("roll")} min={-3.14} max={3.14} step={0.01} unit="rad" />
            <TelField label="Yaw" value={attitude.yaw} onChange={ua("yaw")} min={-6.28} max={6.28} step={0.01} unit="rad" />
          </>
        )}

        {tab === "battery" && (
          <>
            <TelField label="RXBt" value={battery.voltage / 10} onChange={(v) => ub("voltage")(Math.round(v * 10))} min={0} max={60} step={0.1} unit="V" />
            <TelField label="Curr" value={battery.current / 10} onChange={(v) => ub("current")(Math.round(v * 10))} min={0} max={200} step={0.1} unit="A" />
            <TelField label="Capa" value={battery.capacity} onChange={ub("capacity")} min={0} max={99999} unit="mAh" />
            <TelField label="Batt%" value={battery.remaining} onChange={ub("remaining")} min={0} max={100} unit="%" />
          </>
        )}

        {tab === "flight" && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
              <span style={{ fontSize: 10, color: "var(--vscode-descriptionForeground)", width: 44, flexShrink: 0 }}>FM</span>
              <input
                type="text" value={flight.flightMode} maxLength={15}
                onChange={(e) => uf("flightMode")(e.target.value)}
                style={{
                  flex: 1, background: "var(--vscode-input-background)",
                  color: "var(--vscode-input-foreground)",
                  border: "1px solid var(--vscode-input-border, var(--vscode-panel-border))",
                  borderRadius: 3, padding: "2px 6px", fontSize: 11, outline: "none",
                }}
              />
            </div>
            <TelField label="VSPD" value={flight.vspd} onChange={(v) => uf("vspd")(v)} min={-100} max={100} step={0.1} unit="m/s" />
          </>
        )}
      </div>

      {/* CSS for pulse animation */}
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
    </div>
  );
}
