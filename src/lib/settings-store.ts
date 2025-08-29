import fs from "fs";
import path from "path";

export type AsrWorkflow = "TRANSCRIBE" | "NOVA_SONIC";

export interface AppSettings {
  asrWorkflow: AsrWorkflow;
}

const DATA_DIR = path.join(process.cwd(), "data");
const SETTINGS_PATH = path.join(DATA_DIR, "app-settings.json");

const DEFAULTS: AppSettings = {
  asrWorkflow: (process.env.DEFAULT_ASR_WORKFLOW as AsrWorkflow) || "TRANSCRIBE",
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadSettings(): AppSettings {
  try {
    ensureDir();
    if (!fs.existsSync(SETTINGS_PATH)) {
      fs.writeFileSync(SETTINGS_PATH, JSON.stringify(DEFAULTS, null, 2), "utf-8");
      return DEFAULTS;
    }
    const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(next: AppSettings): AppSettings {
  const normalized: AppSettings = {
    asrWorkflow: next.asrWorkflow === "NOVA_SONIC" ? "NOVA_SONIC" : "TRANSCRIBE",
  };
  try {
    ensureDir();
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(normalized, null, 2), "utf-8");
  } catch {
    // best-effort
  }
  return normalized;
}
