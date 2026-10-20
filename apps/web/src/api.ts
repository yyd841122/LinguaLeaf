// Thin client for the server's JSON API. All handlers share one fetch that
// turns non-2xx responses into ApiError so callers only see data or a throw.
export class ApiError extends Error {
  readonly status: number;
  // The server's JSON error body when it had one (parsed), else null —
  // some rejections carry a reader-facing reason the canned copy per
  // status family cannot express. Server error bodies are JSON objects.
  readonly body: Record<string, unknown> | null;

  constructor(
    status: number,
    url: string,
    method: string,
    body: Record<string, unknown> | null = null
  ) {
    super(`${method} ${url} → ${status}`);
    this.status = status;
    this.body = body;
  }
}

export async function fetchJson<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let body: Record<string, unknown> | null = null;
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      // An error response without a JSON body stays null; callers fall
      // back to their canned copy for the status family.
    }
    throw new ApiError(response.status, url, init?.method ?? "GET", body);
  }
  // 204 No Content (book deletion) has no body: parsing it as JSON throws
  // and would make a successful request look like a failure.
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
