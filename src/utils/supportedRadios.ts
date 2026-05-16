import radios from "../../bundled/radios.json";

// Map of wasm id → min supported version
const MIN_VERSIONS: Record<string, string> = {
  el18: "2.8",
  nb4p: "2.11",
  nv14: "2.5",
  pa01: "2.11",
  pl18: "2.10",
  pl18ev: "2.10",
  pl18u: "2.11",
  st16: "2.11",
  x10: "2.4",
  x10express: "2.4",
  x12s: "2.4",
  x7access: "2.4",
  x9dp2019: "2.4",
  x9e: "2.4",
  v14: "2.10",
  v16: "2.10",
  commando8: "2.8",
  bumblebee: "2.10",
  tpros: "2.10",
  tprov2: "2.10",
  t12max: "2.10",
  t14: "2.10",
  t15: "2.10",
  t15pro: "2.12",
  t16: "2.4",
  t18: "2.4",
  t20: "2.10",
  t20v2: "2.10",
  boxer: "2.8",
  gx12: "2.11",
  mt12: "2.10",
  pocket: "2.10",
  tx12mk2: "2.8",
  tx15: "2.12",
  tx16s: "2.4",
  tx16smk3: "2.12",
  zorro: "2.6",
  f16: "2.10",
};

function getWasmId(wasm: string): string {
  const m = wasm.match(/^edgetx-(.+)-simulator\.wasm$/);
  return m ? m[1] : wasm;
}

export const SUPPORTED_RADIOS: RadioDefinition[] = (
  radios as RadioProfile[]
).map((profile) => {
  const id = getWasmId(profile.wasm);
  const isColor = profile.display.depth >= 16;
  return {
    id,
    name: profile.name,
    display: isColor ? "color" : "bw",
    screenWidth: profile.display.w,
    screenHeight: profile.display.h,
    minSupportedVersion: MIN_VERSIONS[id] ?? "2.8",
    maxSupportedVersion: null,
    profile,
  };
});
