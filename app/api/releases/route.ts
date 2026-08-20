import { getD1 } from "@/db";
import { CATALOG_RELEASES } from "@/lib/catalog-seeds";

interface DownloadRow {
  release_key: string;
  count: number;
}

const RELEASE_KEYS = CATALOG_RELEASES.map((release) => release.key);
const RELEASE_KEY_SET = new Set(RELEASE_KEYS);

function json(data: unknown, init: ResponseInit = {}, cacheable = false) {
  const headers = new Headers(init.headers);
  headers.set(
    "cache-control",
    cacheable ? "public, max-age=10, s-maxage=30, stale-while-revalidate=300" : "no-store",
  );
  headers.set("x-content-type-options", "nosniff");
  return Response.json(data, { ...init, headers });
}

async function readDownloadCounts(db: Pick<D1Database, "prepare">) {
  const placeholders = RELEASE_KEYS.map(() => "?").join(", ");
  const result = await db.prepare(`
    SELECT release_key, count
    FROM downloads
    WHERE release_key IN (${placeholders})
  `).bind(...RELEASE_KEYS).all<DownloadRow>();

  const downloadCounts: Record<string, number> = {};
  for (const row of result.results) {
    const count = Math.max(0, Math.floor(Number(row.count)));
    if (RELEASE_KEY_SET.has(row.release_key) && count > 0) downloadCounts[row.release_key] = count;
  }
  return downloadCounts;
}

export async function getReleaseResponse(request: Request, db: Pick<D1Database, "prepare">) {
  try {
    const downloadCounts = await readDownloadCounts(db);
    if (new URL(request.url).searchParams.get("view") === "counts") {
      return json({ downloadCounts }, {}, true);
    }
    const releases = CATALOG_RELEASES.map((release) => ({
      ...release,
      downloadCount: downloadCounts[release.key] ?? 0,
    }));
    return json({ releases });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Catalog is unavailable." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    return await getReleaseResponse(request, await getD1());
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Catalog is unavailable." }, { status: 500 });
  }
}
