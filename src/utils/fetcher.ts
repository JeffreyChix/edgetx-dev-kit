import { getEdgeTXConfig } from "./general";

export async function fetchRemoteManifest() {
  const STUBS_RAW_BASE_URL = getEdgeTXConfig().get<string>("stubsRawBaseUrl");

  if (!STUBS_RAW_BASE_URL) {
    throw new Error("EdgeTX: Missing stubs raw base url.");
  }

  const res = await fetch(STUBS_RAW_BASE_URL + "/manifest.json");

  if (!res.ok) {
    throw new Error(`Failed to fetch remote manifest: ${res.status}`);
  }
  const manifest = (await res.json()) as Manifest;

  return manifest;
}

export async function fetchStubs(
  files: string[],
  version: string,
): Promise<Record<string, string>> {
  const STUBS_RAW_BASE_URL = getEdgeTXConfig().get<string>("stubsRawBaseUrl");

  if (!STUBS_RAW_BASE_URL) {
    throw new Error("EdgeTX: Missing stubs raw base url.");
  }

  const stubsPath = `${STUBS_RAW_BASE_URL}/stubs/${version}`;

  const entries = await Promise.all(
    files.map(async (file) => {
      const res = await fetch(`${stubsPath}/${file}`);

      if (!res.ok) {
        throw new Error(
          `EdgeTX: Failed to fetch stub ${file} for version ${version}: ${res.status}`,
        );
      }

      const content = await res.text();
      return [file, content] as const;
    }),
  );

  return Object.fromEntries(entries);
}
