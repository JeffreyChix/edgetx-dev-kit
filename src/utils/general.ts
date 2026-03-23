import * as vscode from "vscode";

export function parseVersion(v: string): [number, number] {
  if (v === "main") {
    return [Infinity, Infinity];
  }
  const [major, minor] = v.split(".").map(Number);
  return [major, minor];
}

export function versionGte(v: string, min: string): boolean {
  const [maj, min_] = parseVersion(v);
  const [minMaj, minMin] = parseVersion(min);
  if (maj !== minMaj) {
    return maj > minMaj;
  }
  return min_ >= minMin;
}

export function versionLte(v: string, min: string): boolean {
  const [maj, min_] = parseVersion(v);
  const [minMaj, minMin] = parseVersion(min);
  if (maj !== minMaj) {
    return maj < minMaj;
  }
  return min_ <= minMin;
}

export function findVersionEntry(
  version: string,
): (entry: ScriptVersion) => boolean {
  return (entry) => {
    const fromOk = versionGte(version, entry.from);
    const toOk = entry.to === null || versionLte(version, entry.to);
    return fromOk && toOk;
  };
}

export function getEdgeTXConfig() {
  return vscode.workspace.getConfiguration("edgetx");
}