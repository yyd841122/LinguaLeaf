import { describe, expect, it, vi } from "vitest";
import {
  createMemoryPdfBytesBackend,
  createPdfBytesStore,
  readPdfBlob,
} from "../src/store/idb-bytes-store";
import { pdfFingerprint } from "../src/store/pdf-fingerprint";

async function fixture() {
  const blob = new Blob(["%PDF bytes including the final page"]);
  const docId = await pdfFingerprint(await readPdfBlob(blob));
  return { blob, docId, title: "Book" };
}
describe("PDF bytes store", () => {
  it("lists metadata only, replaces one identity and refreshes storedAt", async () => {
    const backend = createMemoryPdfBytesBackend();
    const clock = vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(20);
    const store = createPdfBytesStore(backend, clock);
    const input = await fixture();
    await store.save(input);
    const read = vi.spyOn(FileReader.prototype, "readAsArrayBuffer");
    expect(await store.list()).toEqual([
      {
        docId: input.docId,
        title: "Book",
        size: input.blob.size,
        storedAt: 10,
      },
    ]);
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
    await store.save({ ...input, title: "Renamed" });
    expect(await store.list()).toEqual([
      {
        docId: input.docId,
        title: "Renamed",
        size: input.blob.size,
        storedAt: 20,
      },
    ]);
    expect(
      await pdfFingerprint(
        await readPdfBlob((await store.get(input.docId)).blob)
      )
    ).toBe(input.docId);
  });
  it("rejects failed inserts/replacements/deletes without losing the previous committed record", async () => {
    const backend = createMemoryPdfBytesBackend();
    const store = createPdfBytesStore(backend, () => 1);
    const input = await fixture();
    const put = vi
      .spyOn(backend, "put")
      .mockRejectedValueOnce(new Error("quota"));
    await expect(store.save(input)).rejects.toThrow("quota");
    expect(await store.list()).toEqual([]);
    await store.save(input);
    put.mockRejectedValueOnce(new Error("abort"));
    await expect(
      store.save({ ...input, title: "replacement" })
    ).rejects.toThrow("abort");
    expect(await store.list()).toEqual([
      { docId: input.docId, title: "Book", size: input.blob.size, storedAt: 1 },
    ]);
    vi.spyOn(backend, "delete").mockRejectedValueOnce(new Error("delete"));
    await expect(store.delete(input.docId)).rejects.toThrow("delete");
    expect((await store.get(input.docId)).title).toBe("Book");
    await store.delete(input.docId);
    await expect(store.get(input.docId)).rejects.toThrow();
  });
  it("serializes preparation too: delayed save then delete cannot resurrect bytes", async () => {
    const backend = createMemoryPdfBytesBackend();
    const store = createPdfBytesStore(backend);
    const input = await fixture();
    let release!: (bytes: ArrayBuffer) => void;
    const bytes = await readPdfBlob(input.blob);
    Object.defineProperty(input.blob, "arrayBuffer", {
      value: () =>
        new Promise<ArrayBuffer>((resolve) => {
          release = resolve;
        }),
    });
    const save = store.save(input);
    const remove = store.delete(input.docId);
    await Promise.resolve();
    release(bytes);
    await Promise.all([save, remove]);
    expect(await store.list()).toEqual([]);
  });
  it("rejects wrong digests, unreadable blobs, missing bytes, malformed metadata, and backend read failures", async () => {
    const backend = createMemoryPdfBytesBackend();
    const store = createPdfBytesStore(backend);
    const input = await fixture();
    await expect(
      store.save({ ...input, docId: "pdf:sha256-v1:" + "0".repeat(64) })
    ).rejects.toThrow("校验");
    const broken = new Blob(["broken"]);
    Object.defineProperty(broken, "arrayBuffer", {
      value: () => Promise.reject(new Error("blob read")),
    });
    await expect(store.save({ ...input, blob: broken })).rejects.toThrow(
      "blob read"
    );
    expect(await store.list()).toEqual([]);
    vi.spyOn(backend, "list")
      .mockResolvedValueOnce([{ docId: input.docId }])
      .mockRejectedValueOnce(new Error("open failed"));
    await expect(store.list()).rejects.toThrow("损坏");
    await expect(store.list()).rejects.toThrow("open failed");
    vi.spyOn(backend, "get").mockResolvedValueOnce({
      ...input,
      size: input.blob.size,
      storedAt: 1,
      blob: undefined,
    });
    await expect(store.get(input.docId)).rejects.toThrow("缺失");
  });
});
