"use client";

import { AlertTriangle, Bot, Check, Download, ExternalLink, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Dialog } from "@/components/dialog";
import type { InstallableReleaseRecord } from "@/lib/directory-catalog";
import type { AgentSnapshotScanResult } from "@/lib/snapshot-scan";
import type { ReleaseRecord } from "@/lib/hive-contract";

export interface NoticeState {
  tone: "success" | "error" | "neutral";
  message: string;
}

interface ScanView {
  ok: boolean;
  sha256: string;
  hardErrors: string[];
  warnings: string[];
  checks: string[];
}

function CheckRow({ icon, title, detail, tone = "ok" }: { icon: ReactNode; title: string; detail: string; tone?: "ok" | "warn" | "block" }) {
  return (
    <div className={`check-row check-${tone}`}>
      <span className="check-icon" aria-hidden="true">{icon}</span>
      <span><strong>{title}</strong><small>{detail}</small></span>
    </div>
  );
}

function toScanView(result: AgentSnapshotScanResult): ScanView {
  return {
    ok: result.ok,
    sha256: result.sha256,
    hardErrors: result.hardErrors,
    warnings: result.warnings,
    checks: result.checks,
  };
}

function fileNameFromUrl(url: string) {
  try {
    const path = new URL(url, "https://hivebuzz.invalid").pathname;
    return decodeURIComponent(path.split("/").pop() ?? "artifact");
  } catch {
    return "artifact";
  }
}

export function InstallDialog({
  release,
  onClose,
  onNotice,
  onCounted,
}: {
  release: InstallableReleaseRecord | null;
  onClose(): void;
  onNotice(notice: NoticeState): void;
  onCounted(releaseKey: string, count: number): void;
}) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [scan, setScan] = useState<ScanView | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [handoffUnderstood, setHandoffUnderstood] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState("");
  const [downloaded, setDownloaded] = useState(false);

  const inspectBytes = useCallback(async (input: ArrayBuffer, fileName: string) => {
    if (!release) return;
    setBusy(true);
    setBytes(null);
    setScan(null);
    setReviewed(false);
    setHandoffUnderstood(false);
    setDownloaded(false);
    try {
      const result = await import("@/lib/snapshot-scan").then(({ scanAgentSnapshot }) => scanAgentSnapshot(input, fileName, {
        sha256: release.manifest.artifact.sha256,
        sizeBytes: release.manifest.artifact.sizeBytes,
        mediaType: release.manifest.artifact.mediaType,
      }));
      const view = toScanView(result);
      setScan(view);
      if (view.ok) setBytes(new Uint8Array(input.slice(0)));
    } catch (error) {
      setScan({ ok: false, sha256: "", hardErrors: [error instanceof Error ? error.message : "Artifact could not be inspected."], warnings: [], checks: [] });
    } finally {
      setBusy(false);
    }
  }, [release]);

  const externalArtifact = Boolean(release && !release.manifest.artifact.url.startsWith("/"));
  const sourceFileName = release ? fileNameFromUrl(release.manifest.artifact.url) : "artifact";

  useEffect(() => {
    if (!release || externalArtifact) return;
    const controller = new AbortController();
    const load = async () => {
      setBusy(true);
      try {
        const response = await fetch(release.manifest.artifact.url, { cache: "no-store", redirect: "error", signal: controller.signal });
        if (!response.ok) throw new Error("Catalog artifact could not be loaded.");
        const declaredSize = Number(response.headers.get("content-length") ?? 0);
        if (declaredSize && declaredSize !== release.manifest.artifact.sizeBytes) throw new Error("Artifact size does not match the catalog record.");
        await inspectBytes(await response.arrayBuffer(), sourceFileName);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setScan({ ok: false, sha256: "", hardErrors: [error instanceof Error ? error.message : "Catalog artifact could not be loaded."], warnings: [], checks: [] });
        setBusy(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [externalArtifact, inspectBytes, release, sourceFileName]);

  if (!release) return null;
  const item = release.manifest.release;
  const maxBytes = release.manifest.artifact.mediaType === "image/png" ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
  const canDownload = Boolean(bytes && scan?.ok && reviewed && handoffUnderstood && !busy);
  const downloadExtension = release.manifest.artifact.mediaType === "image/png" ? ".agent.png" : ".agent.json";
  const scanState = busy && !scan ? "active" : scan?.ok ? "done" : scan ? "blocked" : "pending";
  const reviewState = reviewed && handoffUnderstood ? "done" : scan?.ok ? "active" : "pending";
  const downloadState = downloaded ? "done" : canDownload ? "active" : "pending";

  const selectFile = async (file?: File) => {
    if (!file) return;
    setDownloaded(false);
    setSelectedFileName(file.name);
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith(".agent.json") && !lowerName.endsWith(".agent.png")) {
      setBytes(null);
      setScan({ ok: false, sha256: "", checks: [], warnings: [], hardErrors: ["Choose a .agent.json or .agent.png file."] });
      return;
    }
    if (file.size < 1 || file.size > maxBytes) {
      setBytes(null);
      setScan({ ok: false, sha256: "", checks: [], warnings: [], hardErrors: [`Artifact must be between 1 byte and ${maxBytes / 1024 / 1024} MiB.`] });
      return;
    }
    await inspectBytes(await file.arrayBuffer(), file.name);
  };

  const download = async () => {
    if (!bytes || !scan?.ok) return;
    setBusy(true);
    const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: release.manifest.artifact.mediaType });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `${item.id}-${item.version}${downloadExtension}`.replace(/[^a-zA-Z0-9._-]/g, "-");
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
    setBusy(false);
    setDownloaded(true);
    onNotice({ tone: "success", message: "Verified download started. Check your browser, then drag the stopped file into Buzz Desktop." });
    void (async () => {
      try {
        const response = await fetch("/api/downloads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ releaseKey: release.key }) });
        const data = await response.json() as { downloadCount?: number };
        if (response.ok && Number.isFinite(data.downloadCount)) {
          const downloadCount = Number(data.downloadCount);
          onCounted(release.key, downloadCount);
          window.dispatchEvent(new CustomEvent("hivebuzz:download-count", { detail: { releaseKey: release.key, downloadCount } }));
        }
      } catch {
        // The verified file handoff remains useful when the aggregate counter is offline.
      }
    })();
  };

  return (
    <Dialog open={Boolean(release)} onClose={onClose} title="Verify before download" eyebrow={`${item.name} · v${item.version}`} wide>
      <div className="install-layout">
        <div className="install-main">
          <div className="install-principle">
            <ShieldCheck size={21} aria-hidden="true" />
            <div><strong>Import behavior, not identity</strong><p>HiveBuzz verifies the snapshot. Buzz previews it and creates a fresh private identity on import.</p></div>
          </div>
          <ol className="verification-steps" aria-label="Verification and download progress">
            <li data-state={scanState}><span>{scanState === "done" ? <Check size={14} /> : scanState === "blocked" ? <X size={14} /> : "1"}</span><div><strong>Local scan</strong><small>{scanState === "active" ? "In progress" : scanState === "done" ? "Exact bytes and private state checked" : scanState === "blocked" ? "Blocked by local checks" : "Waiting"}</small></div></li>
            <li data-state={reviewState}><span>{reviewState === "done" ? <Check size={14} /> : "2"}</span><div><strong>Safety review</strong><small>{reviewState === "done" ? "Both confirmations complete" : scan?.ok ? "Confirm both items below" : "Waiting for scan"}</small></div></li>
            <li data-state={downloadState}><span>{downloadState === "done" ? <Check size={14} /> : "3"}</span><div><strong>Verified download</strong><small>{downloadState === "done" ? "Handoff requested" : canDownload ? "Ready" : "Locked until review"}</small></div></li>
          </ol>
          {externalArtifact || (scan && !scan.ok) ? (
            <div className="external-artifact-step">
              {externalArtifact ? <a className="button button-outline" href={release.manifest.artifact.url} target="_blank" rel="noopener noreferrer">Download source file <ExternalLink size={14} /></a> : null}
              <label className="file-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void selectFile(event.dataTransfer.files[0]); }}>
                <input type="file" accept=".agent.json,.agent.png,application/json,image/png" onChange={(event) => void selectFile(event.target.files?.[0])} />
                <Bot size={22} aria-hidden="true" />
                <span><strong>{selectedFileName || `Select ${sourceFileName}`}</strong><small>{externalArtifact ? "External URLs are never fetched automatically." : "Choose the catalog file to retry local verification."}</small></span>
              </label>
            </div>
          ) : null}
          {busy && !scan ? <div className="scan-progress" role="status"><span className="spinner" /> Local scan in progress. Verifying exact bytes without executing them…</div> : null}
          {scan ? (
            <div className="scan-results">
              {scan.checks.map((check) => <CheckRow key={check} icon={<Check size={17} />} title={check} detail="Computed locally in this browser." />)}
              {scan.warnings.map((warning) => <CheckRow key={warning} icon={<AlertTriangle size={17} />} title="Review required" detail={warning} tone="warn" />)}
              {scan.hardErrors.map((error) => <CheckRow key={error} icon={<X size={17} />} title="Download blocked" detail={error} tone="block" />)}
            </div>
          ) : null}
          {scan?.ok ? (
            <div className="review-confirmations">
              <label><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /><span><strong>I reviewed the snapshot checks.</strong><small>Static checks reduce risk but cannot prove instructions are benign.</small></span></label>
              <label><input type="checkbox" checked={handoffUnderstood} onChange={(event) => setHandoffUnderstood(event.target.checked)} /><span><strong>I will review the Buzz import preview.</strong><small>Agents page → drop file → review preview → import.</small></span></label>
            </div>
          ) : null}
        </div>
        <aside className="install-sidebar">
          <p className="section-label">Snapshot policy</p>
          <dl className="request-list">
            <div><dt>Memory</dt><dd>Excluded</dd></div><div><dt>Identity</dt><dd>Fresh on import</dd></div><div><dt>Bundled tools</dt><dd>None</dd></div><div><dt>Source allowlist</dt><dd>Excluded</dd></div><div><dt>Automatic run</dt><dd>Off</dd></div>
          </dl>
          <div className="digest-box"><span>Catalog SHA 256</span><code>{release.manifest.artifact.sha256}</code></div>
        </aside>
      </div>
      {downloaded ? (
        <div className="dialog-footer dialog-footer-install download-complete" role="status">
          <div><Check size={19} aria-hidden="true" /><p><strong>Download started</strong><br />When your browser finishes saving, open Buzz Desktop, go to Agents, drop the stopped file, then review and import it.</p></div>
          <button className="button button-dark button-large" type="button" onClick={onClose}>Done</button>
        </div>
      ) : (
        <div className="dialog-footer dialog-footer-install">
          <p><strong>Next: drag the stopped file into Buzz Desktop.</strong><br />No account, identity signature, or background install.</p>
          <button className="button button-dark button-large" type="button" disabled={!canDownload} onClick={() => void download()}><Download size={17} aria-hidden="true" /> {busy ? "Finishing…" : `Download verified ${downloadExtension}`}</button>
        </div>
      )}
    </Dialog>
  );
}

export function AgentGetButton({ release, className = "button button-dark button-large", label = "Get agent" }: { release: ReleaseRecord; className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  return (
    <>
      <button className={className} type="button" onClick={() => setOpen(true)}><ShieldCheck size={16} aria-hidden="true" /> {label}</button>
      <InstallDialog key={open ? release.key : "closed"} release={open ? release : null} onClose={() => setOpen(false)} onNotice={setNotice} onCounted={() => undefined} />
      {notice ? <div className={`notice notice-${notice.tone}`} role="status">{notice.message}</div> : null}
    </>
  );
}
