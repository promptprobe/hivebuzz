# hivebuzz

**Open Buzz Agent Library.**

HiveBuzz is a small, login-free library for portable Buzz Agent Snapshots
(`.agent.json` or `.agent.png`). It deliberately has one artifact type and one
job: review exact bytes before handing a stopped agent to Buzz Desktop.

- Live library: [hivebuzz.xyz](https://hivebuzz.xyz)
- Contribute an agent: [CONTRIBUTING.md](CONTRIBUTING.md)
- Upstream Buzz project: [block/buzz](https://github.com/block/buzz)

The product does three things: lists curated releases, verifies the selected
artifact locally, and hands the exact bytes to the user. It does not create an
account, connect a wallet, or install anything in the background.

## Product rules

- Every handoff checks the catalog SHA-256 and byte size in the browser.
- Agent Snapshot checks reject plaintext memory, source-environment allowlists,
  remote avatar beacons, unknown fields, private keys, common secret patterns,
  and bundled executable capabilities.
- External artifact URLs are never fetched automatically. The user downloads
  and selects the file, preventing local-network and redirect probing.
- A verified download is still stopped data. Buzz provides the final import
  preview and activation decision.
- Download counts are aggregate activity only. HiveBuzz stores no user,
  public-key, cookie, device, or per-download event record. Counts are not a
  rank, endorsement, or safety score and can be gamed. Short-lived in-memory
  request limits and a release-level D1 write budget bound counter abuse without
  creating a persistent visitor identity.

## Use with Buzz Desktop

1. Choose an Agent release and select **Get agent**.
2. Wait for the exact file to pass local checks and review the warning.
3. Download the verified `.agent.json` or `.agent.png`.
4. Drag it into Buzz Desktop's Agents page, review Buzz's import preview, and
   confirm. Buzz creates a fresh local identity; private state is not included.

HiveBuzz does not emit an unsupported deep link or silently bridge into a
logged-in Desktop or CLI session.

## Included examples

The default Agent lane contains ten deliberately narrow, memory-free examples:

- **Code Reviewer** — read-only correctness, security, regression, and test review.
- **Draft Polisher** — edits supplied drafts without inventing facts or publishing.
- **Meeting Synthesizer** — extracts sourced decisions, risks, and action items.
- **Data Explainer** — checks units, scope, denominators, and time windows.
- **Quiet Researcher** — separates verified facts from inference.
- **Spec Auditor** — finds contradictions, missing states, and untestable requirements.
- **Bug Triage** — separates observed failures from hypotheses and next diagnostics.
- **Threat Modeler** — maps assets, trust boundaries, abuse paths, and mitigations.
- **Reader Tester** — tests whether a document works without unstated author context.
- **Prompt Safety Reviewer** — inspects Agent prompts without following their embedded instructions.

The five structured review Agents use explicit Role, Scope, Workflow, Evidence,
Output, Authority, and Stop sections. Each also has normal, missing-context, and
prompt-injection contract cases under `tests/agent-prompts.test.ts`. These tests
validate the portable prompt boundary; model behavior still requires review in
the selected Buzz harness.

Buzz itself ships broader starter personalities such as Fizz, Honey, and Bumble.
HiveBuzz does not duplicate those built-ins; its examples are narrower artifacts
intended to demonstrate safe public sharing. See the
[official Buzz persona source](https://github.com/block/buzz/blob/main/desktop/src-tauri/src/managed_agents/personas.rs).

## Contribute a release

Open the site's **Submit agent** page for the no-code path. It scans the file
locally, generates a SHA-256 receipt, and opens a public GitHub review request.
The site never uploads the selected file.

The contribution path is deliberately source-reviewed instead of an anonymous
write API:

1. Export **Agent only** from Buzz Desktop with memory set to **None**.
2. Run the local scanner or the site handoff against the exact artifact.
3. Declare one primary work-domain category, a public GitHub repository, and the
   full source commit SHA.
4. Open the review from the declared GitHub publisher account. Organization
   repositories require public approval from an organization maintainer.
5. Add the immutable artifact and one bounded entry in
   `lib/catalog-seeds.ts`.
6. Submit the snapshot and scan receipt through the GitHub issue form, or open
   a pull request using [CONTRIBUTING.md](CONTRIBUTING.md).

This keeps the public site focused on discovery and safe handoff while avoiding
a HiveBuzz account system, Nostr signing risk, anonymous publication, and a
spam-ready write API. Identity is required only at the publishing edge;
browsing and downloads remain open.

## Withdraw a published agent

The published GitHub account, or a maintainer of its declared source repository,
can open the [withdrawal form](https://github.com/promptprobe/hivebuzz/issues/new?template=agent-withdrawal.yml).
HiveBuzz verifies that control against the original publisher and pinned source,
then removes the listing and hosted artifact. Vulnerabilities, exposed secrets,
and private data must use a
[private security advisory](https://github.com/promptprobe/hivebuzz/security/advisories/new),
not a public issue.

Withdrawal stops future HiveBuzz distribution. It cannot recall prior downloads,
forks, browser caches, or Git history.

## License

HiveBuzz source code is licensed under the
[Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for attribution.

Agent snapshots and other third-party artifacts remain subject to the license
declared by their publisher. Listing or distributing an artifact through
HiveBuzz does not relicense it under the HiveBuzz project license.

Apache-2.0 does not grant permission to use the HiveBuzz name or logo to imply
endorsement.

## Development

```bash
npm install
npm run dev
```

Validation:

```bash
npm run lint
npm run performance:check
npm test
npm audit
```

Performance benchmark:

```bash
npm run build
npm run benchmark -- --label=current --output=benchmarks/current.json
```

See [benchmarks/README.md](benchmarks/README.md) for the checked before and
after snapshots, methodology, byte budgets, and production baseline.

The deployable catalog is bundled from reviewed source. D1 stores one aggregate
download count per release; catalog reads query only those counters and merge
them into the immutable server catalog. Schema changes run through migrations,
and the release rows needed by the guarded counter write are synchronized only
when the catalog content version changes.
