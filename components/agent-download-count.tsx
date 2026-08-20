"use client";

import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { loadCatalogDownloadCounts } from "@/lib/catalog-client";

export function AgentDownloadCount({ releaseKey, initialCount }: { releaseKey: string; initialCount: number }) {
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    let active = true;
    loadCatalogDownloadCounts()
      .then((counts) => {
        const next = counts[releaseKey];
        if (active && Number.isSafeInteger(next)) setCount((current) => Math.max(current, next));
      })
      .catch(() => undefined);
    const onCount = (event: Event) => {
      const detail = (event as CustomEvent<{ releaseKey?: string; downloadCount?: number }>).detail;
      if (detail?.releaseKey === releaseKey && Number.isSafeInteger(detail.downloadCount)) {
        setCount((current) => Math.max(current, Number(detail.downloadCount)));
      }
    };
    window.addEventListener("hivebuzz:download-count", onCount);
    return () => {
      active = false;
      window.removeEventListener("hivebuzz:download-count", onCount);
    };
  }, [releaseKey]);

  return <><Download size={13} aria-hidden="true" /> {new Intl.NumberFormat("en-US").format(count)}</>;
}
