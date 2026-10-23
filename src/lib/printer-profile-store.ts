import { type PrinterProfile, validatePrinterProfile } from "./barcode-label-sheet";

export const PROFILE_STORAGE_KEY = "forma-pos:barcode-profiles:v1";
export type NamedProfile = { name: string; settings: PrinterProfile };
export const MAX_NAMED_PROFILES = 10;

function validName(name: string) {
  if (name.trim() !== name || name.length < 2 || name.length > 40 ||
    [...name].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))
    throw Error("Profile names must be 2–40 printable characters.");
}
export function readNamedProfiles(raw: string | null): NamedProfile[] {
  if (!raw || raw.length > 15000) return [];
  try {
    const rows: unknown = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length > MAX_NAMED_PROFILES) return [];
    const entries: NamedProfile[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      const v = item.settings;
      if (typeof item.name !== "string" || !v || typeof v !== "object" || Array.isArray(v)) continue;
      const settings = v as Record<string, unknown>;
      if (typeof settings.template !== "string" || typeof settings.storeName !== "string" ||
        typeof settings.barcodeHeightMm !== "number" || typeof settings.offsetXmm !== "number" ||
        typeof settings.offsetYmm !== "number") continue;
      const candidate: PrinterProfile = {
        template: settings.template as PrinterProfile["template"],
        storeName: settings.storeName,
        barcodeHeightMm: settings.barcodeHeightMm,
        offsetXmm: settings.offsetXmm,
        offsetYmm: settings.offsetYmm
      };
      try {
        validName(item.name);
        validatePrinterProfile(candidate);
        if (!entries.some(e => e.name.toLowerCase() === item.name.toLowerCase()))
          entries.push({ name: item.name, settings: candidate });
      } catch { /* Silently ignore damaged browser-only profile entries. */ }
    }
    return entries;
  } catch { return []; }
}
export function upsertNamedProfile(entries: NamedProfile[], name: string, settings: PrinterProfile) {
  validName(name); validatePrinterProfile(settings);
  const index = entries.findIndex(e => e.name.toLowerCase() === name.toLowerCase());
  if (index < 0 && entries.length >= MAX_NAMED_PROFILES)
    throw Error("Only 10 printer profiles may be stored on this browser.");
  const next = [...entries], entry = { name, settings: { ...settings } };
  if (index < 0) next.push(entry); else next[index] = entry;
  return next;
}
export function deleteNamedProfile(entries: NamedProfile[], name: string) {
  return entries.filter(e => e.name !== name);
}
