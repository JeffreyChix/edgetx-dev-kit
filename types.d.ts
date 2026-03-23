type ScreenDisplayType = "color" | "bw" | "monochrome";

interface RadioDefinition {
  id: string;
  name: string;
  display: ScreenDisplayType;
  screenWidth: number;
  screenHeight: number;
  hasTouch: boolean;
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
  availableOn: Availability;
  // group: ConstantGroup;
  sourceFile: string;
}

interface ApiDoc {
  version: string;
  generated: string;
  functions: LuaFunction[];
  constants: LuaConstant[];
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
