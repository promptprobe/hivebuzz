import type { ReleaseManifest, ReleaseMetadata, ReleaseRecord, RiskLevel } from "@/lib/hive-contract";

export interface InstallableReleaseRecord {
  key: string;
  manifest: {
    release: Pick<ReleaseMetadata, "id" | "name" | "version">;
    artifact: ReleaseManifest["artifact"];
  };
}

export interface DirectoryReleaseRecord extends InstallableReleaseRecord {
  manifest: InstallableReleaseRecord["manifest"] & {
    contributorName?: string;
    release: Pick<
      ReleaseMetadata,
      "id" | "name" | "version" | "category" | "summary" | "keywords" | "recommendedHarness" | "recommendedModel"
    >;
  };
  downloadCount: number;
  riskLevel: RiskLevel;
  addedAt: number;
}

export function directoryRecordFromRelease(release: ReleaseRecord): DirectoryReleaseRecord {
  const item = release.manifest.release;
  return {
    key: release.key,
    manifest: {
      contributorName: release.manifest.contributorName,
      release: {
        id: item.id,
        name: item.name,
        version: item.version,
        category: item.category,
        summary: item.summary,
        keywords: item.keywords,
        recommendedHarness: item.recommendedHarness,
        recommendedModel: item.recommendedModel,
      },
      artifact: release.manifest.artifact,
    },
    downloadCount: release.downloadCount,
    riskLevel: release.riskLevel,
    addedAt: release.addedAt,
  };
}

export function installableRecordFromRelease(release: ReleaseRecord): InstallableReleaseRecord {
  return {
    key: release.key,
    manifest: {
      release: {
        id: release.manifest.release.id,
        name: release.manifest.release.name,
        version: release.manifest.release.version,
      },
      artifact: release.manifest.artifact,
    },
  };
}
