const CACHE_MILLISECONDS = 30_000;

export type DownloadCounts = Record<string, number>;

let cachedRequest: { expiresAt: number; promise: Promise<DownloadCounts> } | null = null;

function parseDownloadCounts(input: unknown): DownloadCounts {
  if (typeof input !== "object" || input === null || !("downloadCounts" in input)) {
    throw new Error("Catalog count response is invalid.");
  }
  const candidate = (input as { downloadCounts?: unknown }).downloadCounts;
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw new Error("Catalog count response is invalid.");
  }

  const counts: DownloadCounts = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (Number.isSafeInteger(value) && Number(value) >= 0) counts[key] = Number(value);
  }
  return counts;
}

export function loadCatalogDownloadCounts(): Promise<DownloadCounts> {
  const now = Date.now();
  if (cachedRequest && cachedRequest.expiresAt > now) return cachedRequest.promise;

  const promise = fetch("/api/releases?view=counts", { headers: { accept: "application/json" } })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Catalog counts are unavailable (${response.status}).`);
      return parseDownloadCounts(await response.json());
    })
    .catch((error) => {
      cachedRequest = null;
      throw error;
    });

  cachedRequest = { expiresAt: now + CACHE_MILLISECONDS, promise };
  return promise;
}

export function mergeDownloadCounts<T extends { key: string; downloadCount: number }>(releases: T[], counts: DownloadCounts): T[] {
  return releases.map((release) => {
    const nextCount = counts[release.key];
    const mergedCount = nextCount === undefined ? release.downloadCount : Math.max(release.downloadCount, nextCount);
    return mergedCount === release.downloadCount
      ? release
      : { ...release, downloadCount: mergedCount };
  });
}
