// Thin client for the server's JSON API. All handlers share one fetch that
// turns non-2xx responses into ApiError so callers only see data or a throw.
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, url: string, method: string) {
    super(`${method} ${url} → ${status}`);
    this.status = status;
  }
}

export async function fetchJson<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new ApiError(response.status, url, init?.method ?? "GET");
  }
  // 204 No Content (book deletion) has no body: parsing it as JSON throws
  // and would make a successful request look like a failure.
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
