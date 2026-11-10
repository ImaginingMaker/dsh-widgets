/** One JSON call to this plugin's Host half; a non-2xx answer becomes an Error carrying the Host's message. */
export async function hostJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
  return data as T;
}

export const postJson = <T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> =>
  hostJson<T>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  });

/** The minimum a React component needs from a store, so a test can pass a plain object. */
export interface Store<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}

export interface Sender<T> extends Store<T> {
  load(): Promise<T>;
}