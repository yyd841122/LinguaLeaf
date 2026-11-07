export type PersistenceResult = "granted" | "denied" | "failed" | "unavailable";

// Always resolves; persistence is a convenience request outside PDF opening.
export async function requestStoragePersistence(
  storage: Pick<StorageManager, "persist"> | undefined = navigator.storage
): Promise<PersistenceResult> {
  if (typeof storage?.persist !== "function") return "unavailable";
  try {
    return (await storage.persist()) ? "granted" : "denied";
  } catch {
    return "failed";
  }
}
