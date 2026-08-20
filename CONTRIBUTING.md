# Contributing an agent

HiveBuzz accepts public, memory-free Buzz Agent Snapshots through reviewed
GitHub issues or pull requests. Browsing and downloading remain login-free.

## No-code submission

1. In Buzz Desktop, open **Agents → ··· → Share → Export Agent**.
2. Export **Agent only** as JSON. Do not include core memory or all memories.
3. Open the site's **Submit agent** page and run the local scan.
4. Choose one primary work-domain category and enter your GitHub handle.
5. Add a public GitHub repository, the full 40-character commit SHA containing
   the reviewed source and artifact, and the release license.
6. Download the generated scan receipt.
7. Open the GitHub registration request from the declared publisher account and
   attach:
   - the exact `.agent.json` or `.agent.png` file that passed;
   - the generated `*-submission.json` receipt.

The site does not upload the selected file. GitHub is used only for the public
review request and publisher proof. No HiveBuzz account, Nostr signature,
Buzz key, real name, or email is requested.

## Pull-request submission

1. Fork this repository and create a focused branch.
2. Put the immutable artifact at
   `public/agents/<slug>-<version>.agent.json` (JSON is preferred).
3. Add one bounded definition to `catalog/agent-definitions.ts`, then run
   `npm run catalog:generate` to refresh the generated catalog and previews.
4. Keep Agent Snapshot capabilities empty: no commands, hooks, MCP servers,
   filesystem access, or network hosts.
5. Use one category: `research`, `development`, `design`, `operations`, `data`,
   `marketing`, `security`, or `personal`.
6. Declare a recommended Agent harness (`codex`, `claude`, `goose`, or
   `buzz-agent`) and recommended model. These are public compatibility hints,
   not credentials or enforced runtime settings.
7. Run:

   ```bash
   npm ci
   npm test
   npm run lint
   npx tsc --noEmit
   ```

8. Open a pull request using the agent-submission template from the declared
   publisher account.

Fork pull requests are treated as untrusted data and do not run contributor
code in GitHub Actions. A maintainer first reviews the diff, artifact digest,
publisher, source repository, and pinned commit. Full checks run only from a
maintainer-owned branch in an isolated environment.

## Publication rules

- Snapshot format must be `buzz-agent-snapshot` version 1.
- Memory must be `{ "level": "none" }` with no entries.
- Source-environment response allowlists and remote avatar URLs are rejected.
- Secrets, private keys, credentials, unknown fields, and executable
  capabilities are rejected.
- The artifact SHA-256 and byte size are pinned in source.
- A public GitHub repository, full source commit SHA, and explicit license are
  required.
- The GitHub issue or pull-request author must match the declared publisher.
  Organization-owned repositories require public approval from an organization
  maintainer.
- Publisher proof establishes accountability for the submission; it is not an
  endorsement, legal identity check, or guarantee that the agent is safe.
- Passing static checks is not an endorsement. Maintainers may reject any
  submission whose behavior or provenance cannot be reviewed safely.

Never put credentials, private repository URLs, personal data, or active Nostr
keys in an issue, pull request, snapshot, or receipt.

## Withdraw a published agent

1. Open the [agent withdrawal form](https://github.com/promptprobe/hivebuzz/issues/new?template=agent-withdrawal.yml)
   from the published GitHub account. A maintainer of the declared source
   repository may instead provide public proof of control.
2. Supply the release key, listing or artifact URL, and exact published SHA-256.
3. A HiveBuzz maintainer verifies the requester against the original publisher
   and pinned source commit.
4. HiveBuzz first blocks new downloads, then removes the catalog record and
   hosted artifact and verifies the public URL no longer distributes it.

For a vulnerability, exposed secret, or private data, do not use a public issue.
Use a [private security advisory](https://github.com/promptprobe/hivebuzz/security/advisories/new).
Withdrawal cannot recall existing downloads, forks, caches, or Git history.
