import request from "supertest";
import type { Express } from "express";
import { expect, vi } from "vitest";

// The import finishes asynchronously (ticket 08): the POST returns once the
// book row exists, and the transition lands on the shelf listing — the same
// public endpoint the bookshelf polls. Tests wait through that seam until a
// book settles, instead of reaching into the import task.
export async function waitForShelfBook(
  app: Express,
  bookId: number,
  status: "ready" | "failed"
): Promise<void> {
  await vi.waitFor(
    async () => {
      const shelf = await request(app).get("/api/books");
      const book = shelf.body.books.find(
        (candidate: { id: number }) => candidate.id === bookId
      );
      expect(book, `book ${bookId} never reached "${status}"`).toBeDefined();
      expect(book.status).toBe(status);
    },
    { timeout: 5000 }
  );
}
