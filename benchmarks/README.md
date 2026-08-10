# HiveBuzz performance benchmark

This benchmark records deterministic asset sizes, catalog bootstrap transfer,
and a local Worker render proxy. Run it after a production build:

```bash
npm run build
npm run benchmark -- --label=current --output=benchmarks/current.json
npm run performance:check
```

The checked snapshots were collected on 2026-08-11 with Node 24.18.1. The
runner warms the built Worker five times and records 30 home renders. Local
render timings exclude the network and D1, so they are regression signals, not
Cloudflare latency claims.

## Result

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Home major initial byte budget, desktop | 1,060,357 B | 587,620 B | 44.6% less |
| Home major initial byte budget, mobile | 1,060,357 B | 255,884 B | 75.9% less |
| Home hero, desktop | 767,648 B | 469,382 B | 38.9% less |
| Home hero, mobile | 767,648 B | 137,646 B | 82.1% less |
| Static catalog bootstrap byte estimate | 27,854 B, 2 call sites | 460 B, 1 shared call site | 98.3% less |
| Preloaded webfonts | 146,464 B, 11 files | 0 B, 0 files | removed |
| Home HTML | 58,998 B | 52,404 B | 11.2% less |
| Home HTML, gzip | 9,935 B | 8,977 B | 9.6% less |
| Local Worker render p50 | 13.783 ms | 17.274 ms, latest run | inconclusive |
| Local Worker render p95 | 32.978 ms | 54.933 ms, latest run | inconclusive |
| Initial JavaScript, gzip | 99,260 B | 99,553 B | 0.3% more |

The major initial byte budget combines gzipped HTML, initial JavaScript and
CSS, eagerly preloaded font bytes, the selected hero image, and the catalog
bootstrap payload. It is a stable comparison budget rather than a browser HAR.
The benchmark executes the API response path with a deterministic D1 stub to
measure each raw JSON response, then multiplies that size by statically detected
client call sites. A unit test separately proves concurrent callers share one
in-flight request. HTTP compression, real D1 latency, Worker startup, and
browser scheduling require production sampling.

`npm run performance:check` applies deterministic CI budgets to HTML, initial
JavaScript and CSS, font preloads, catalog call sites, responsive home images,
and the major initial byte estimate. Timing stays report only because shared CI
latency is too noisy for a stable gate.

That timing warning is material: two consecutive final after runs produced
p50 values of 7.450 ms and 17.274 ms, with p95 values of 11.853 ms and 54.933
ms. The range crosses the before snapshot, so this report makes no local render
latency improvement claim. The byte, request, cache, and query-shape results are
deterministic and are the measured improvements used for the release gate.

The small JavaScript increase is the shared, validated download count loader.
It replaces two full catalog fetches and keeps the immutable manifest catalog
in the server rendered page.

## Bottlenecks found

1. The home page embedded the complete catalog in HTML, then `HiveApp` fetched
   the same 13,927 byte catalog again. `SiteFooter` made a second independent
   request, and every subpage fetched the full catalog solely to show service
   status.
2. `/api/releases` read manifest JSON from D1, parsed it, validated it, and
   rebuilt every release on each uncached request. A fresh Worker isolate also
   performed catalog version synchronization before the read.
3. The three 1774 by 887 hero backgrounds were served unchanged on mobile.
4. Eleven Geist and Geist Mono font subsets were preloaded on every route.
5. Request dependent metadata called `headers()` for a host that is fixed in
   production, adding work to every HTML render.

## Changes

- The initial catalog remains server rendered. A shared client loader now asks
  only for aggregate download counts and merges them into the trusted seed.
- The count response reads only the `downloads` table and uses a short public
  cache window. The compatibility form of `/api/releases` remains available.
- API responses bypass HTML nonce generation while retaining common security
  headers. HTML keeps its nonce based CSP unchanged.
- Each hero now has a recompressed desktop asset and a 960 pixel mobile asset.
  Responsive high priority preloads expose the LCP image before CSS discovery.
- The UI uses the system sans and monospace stacks, removing all webfont
  requests. The static production metadata no longer reads request headers.
- The footer reports catalog availability rather than making a broader system
  health claim from a briefly cached count response.
- Regression tests enforce hero budgets, one count endpoint call site, no
  manifest database reads in that endpoint, no request dependent metadata,
  and no font preload or local filesystem URL in rendered HTML.

## Production baseline

Before these changes, production sampling from Seoul observed:

| Route | Size | Observed timing |
| --- | ---: | --- |
| `/api/releases` | 13,927 B | warm p50 about 430 ms, warm p95 about 750 ms, first observed response 3.995 s |
| `/` | 59,234 B | warmed samples 255 to 372 ms TTFB; first samples 2.39 to 2.65 s |
| `/guide` | 50,533 B | warmed samples 141 to 487 ms TTFB |
| `/contribute` | 26,176 B | warmed samples 100 to 203 ms TTFB |

Network timing is inherently noisy. A production after sample must use the
deployed optimized version and the same route protocol; it is intentionally not
filled from a local result.
