type ScreenDisplayType = "color" | "bw" | "monochrome";

interface RadioDefinition {
  id: string;
  name: string;
  display: ScreenDisplayType;
  screenWidth: number;
  screenHeight: number;
  minSupportedVersion: string;
  maxSupportedVersion: string | null;
}

interface EdgeTXProfile {
  radio: string;
  version: string;
  display: ScreenDisplayType;
  screenWidth: number;
  screenHeight: number;
}

type EdgeTXFile =
  | "edgetx-lua-api.json"
  | "edgetx-script-types.json"
  | "edgetx.globals.d.lua"
  | "edgetx.constants.d.lua"
  | "edgetx.scripts.d.lua"
  | "edgetx.bitmap.d.lua"
  | "edgetx.lcd.d.lua"
  | "edgetx.model.d.lua";

type EdgeTXVersion = {
  generatedAt: string;
  stubHash: string;
  sources: {
    [key: string]: string;
  };
  files: EdgeTXFile[];
};

interface Manifest {
  manifestVersion: number;
  updatedAt: string;
  versions: {
    [key: string]: EdgeTXVersion;
  };
}

type LuaEntityType = "function" | "constant";

type LuaValueType = string;

type ConstantGroup =
  | "font"
  | "alignment"
  | "color"
  | "playback"
  | "display"
  | "switch"
  | "input"
  | "other";

interface LuaTableField {
  name: string;
  type: LuaValueType;
  description: string;
}

interface LuaParam {
  name: string;
  type: LuaValueType;
  description: string;
  optional: boolean;
  flagHints: string[]; // e.g. ["BOLD", "BLINK", "LEFT"]
}

interface LuaReturn {
  name: string;
  type: LuaValueType;
  description: string;
  fields?: LuaTableField[]; // populated when type === "table"
}

type Availability = "COLOR_LCD" | "NON_COLOR_LCD" | "GENERAL";

interface LuaFunction {
  entityType: "function";
  module: string;
  name: string;
  signature: string;
  description: string;
  parameters: LuaParam[];
  overloadParameters: LuaParam[];
  returns: LuaReturn[];
  notices: string[];
  status: string;
  sinceVersion: string;
  availableOn?: Availability;
  deprecated: boolean;
  sourceFile: string;
}

interface LuaConstant {
  entityType: "constant";
  module: string;
  name: string;
  description: string;
  type: "number" | "string";
  availableOn: Availability;
  sourceFile: string;
}

interface LuaClass {
  entityType: "class";
  name: string;
  fields: {
    name: string;
    type: string;
    description: string;
    notices: string[];
    returns: LuaReturn[];
    flagHints: string[];
    sinceVersion: string;
  }[];
}

interface ApiDoc {
  version: string;
  generated: string;
  functions: LuaFunction[];
  constants: LuaConstant[];
  lvgl: {
    functions: LuaFunction[];
    constants: LuaConstant[];
    classes: LuaClass[];
  };
}

interface WizardConfig {
  name: string;
  layout: "dashboard" | "list" | "minimal";
}

type ScriptType = "oneTime" | "telemetry" | "widget" | "function" | "mix";

interface ScriptField {
  optional: boolean;
  signature: string;
  description: string;
  returnSample?: string;
}

interface ScriptVersion {
  from: string;
  to: string | null; // null means latest
  fields: Record<string, ScriptField>;
}

interface ScriptTypeDefinition {
  generic?: { name: string; description: string; type: string; sample: string };
  description: string;
  notices: string[];
  versions: ScriptVersion[];
}


interface RadioDisplay {
  w: number;
  h: number;
  depth: number; // 1 = monochrome, 4 = grayscale, 16 = color RGB565
}

interface RadioInput {
  name: string;
  type: "STICK" | "FLEX";
  label: string;
  default?: string; // POT | POT_CENTER | SLIDER | MULTIPOS | NONE
}

interface RadioSwitch {
  name: string;
  type: "2POS" | "3POS";
  default: string; // 2POS | 3POS | TOGGLE | NONE
}

interface RadioTrim {
  name: string;
}

interface RadioKey {
  key: string; // KEY_MODEL | KEY_SYS | KEY_TELE | KEY_EXIT | KEY_ENTER | KEY_PAGEUP | KEY_PAGEDN | KEY_MENU
  label: string;
  side: "L" | "R";
}

interface RadioProfile {
  name: string;
  wasm: string; // e.g. "edgetx-tx16s-simulator.wasm"
  display: RadioDisplay;
  inputs: RadioInput[];
  switches: RadioSwitch[];
  trims: RadioTrim[];
  keys: RadioKey[];
}

interface SimulatorExports {
  memory: WebAssembly.Memory;
  malloc: (size: number) => number;
  free: (ptr: number) => void;
  simuInit: () => void;
  simuStart: (tests: number) => void;
  simuStop: () => void;
  simuFatfsSetPaths: (sdPath: number, settingsPath: number) => void;
  simuCreateDefaults?: () => void;
  simuSetKey: (key: number, state: number) => void;
  simuSetTrim: (trim: number, state: number) => void;
  simuSetSwitch: (swtch: number, state: number) => void;
  simuTouchDown: (x: number, y: number) => void;
  simuTouchUp: () => void;
  simuRotaryEncoderEvent: (steps: number) => void;
  simuInjectChar: (c: number) => void;
  simuLcdChanged: () => number;
  simuLcdCopy: (buf: number, maxLen: number) => number;
  simuLcdGetWidth: () => number;
  simuLcdGetHeight: () => number;
  simuLcdGetDepth: () => number;
  simuLcdFlushed: () => void;
  simuIsTextKeyboardActive: () => number;
  simuIsNumberKeyboardActive: () => number;
  simuSendTelemetry: (module: number, protocol: number, dataPtr: number, len: number) => void;
  simuRunScriptContent?: (contentPtr: number, len: number, namePtr: number) => void;
  simuLoadWidget?: (namePtr: number) => void;
  simuLoadWidgetByLayout?: (namePtr: number, layoutPtr: number, zoneIndex: number) => void;
}