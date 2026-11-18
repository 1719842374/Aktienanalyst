/**
 * Re-Export: die Logik liegt in shared/fazit-entry.ts (Server-PDF und Client nutzen dieselbe Datei).
 */
export {
  FAZIT_ENTRY_SOURCE,
  computeFazitEntry,
  fazitEntryForExport,
  withFazitEntryChatFacts,
  type FazitEntryExport,
  type FazitEntryValues,
} from "../../../shared/fazit-entry";
