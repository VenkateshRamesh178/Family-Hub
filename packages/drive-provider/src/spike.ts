/**
 * Phase 0 feasibility probes (plan §7, spike checklist). These are diagnostic
 * helpers used by the /spike screen, not part of the product data path.
 */
import type { FamilyConfig } from '@family-hub/core';
import { DriveApiError, appPropQuery, type DriveChange, type DriveClient } from './drive-client';
import { KIND_SPIKE, PROP_KIND } from './layout';

export interface ProbeResult {
  label: string;
  ok: boolean;
  detail: string;
}

async function probe(label: string, fn: () => Promise<string>): Promise<ProbeResult> {
  try {
    return { label, ok: true, detail: await fn() };
  } catch (e) {
    const detail = e instanceof DriveApiError ? `${e.status} ${e.reason}` : e instanceof Error ? e.message : String(e);
    return { label, ok: false, detail };
  }
}

/**
 * Checklist Q1 + Q4: what can *this* account see and do inside the family tree?
 * Run it as the admin and as an invited member and compare.
 */
export async function probeAccess(client: DriveClient, family: FamilyConfig): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  results.push(
    await probe('Root folder metadata', async () => {
      const f = await client.getFile(family.rootFolderId);
      return `"${f.name}", canEdit=${f.capabilities?.canEdit}, canShare=${f.capabilities?.canShare}, writersCanShare=${f.writersCanShare}`;
    }),
  );
  results.push(
    await probe('List root children', async () => {
      const kids = await client.listChildren(family.rootFolderId);
      return `${kids.length} visible: ${kids.map((k) => k.name).join(', ') || '(none)'}`;
    }),
  );
  for (const [key, id] of Object.entries(family.folders)) {
    results.push(
      await probe(`Folder ${key}/`, async () => {
        const f = await client.getFile(id);
        const kids = await client.listChildren(id);
        return `canAddChildren=${f.capabilities?.canAddChildren}, canShare=${f.capabilities?.canShare}, ${kids.length} visible file(s)`;
      }),
    );
  }
  results.push(await probe('Read _meta/members.json', async () => `${JSON.stringify(await client.readJson(family.metaFiles.members)).length} bytes`));
  results.push(await probe('Read _meta/roles.json', async () => `${JSON.stringify(await client.readJson(family.metaFiles.roles)).length} bytes`));
  results.push(
    await probe('Files created by other members (spike heartbeats)', async () => {
      const files = await client.list(`${appPropQuery(PROP_KIND, KIND_SPIKE)} and trashed = false`);
      const devices = new Set(files.map((f) => f.appProperties?.device));
      return `${files.length} heartbeat file(s) from ${devices.size} device(s)`;
    }),
  );
  return results;
}

/** Checklist Q2: write a small file other devices should notice via changes.list. */
export async function writeHeartbeat(
  client: DriveClient,
  folderId: string,
  deviceId: string,
  email: string,
): Promise<{ id: string; writtenAt: string }> {
  const writtenAt = new Date().toISOString();
  const f = await client.createJson(
    `spike-${deviceId}-${Date.now()}.json`,
    folderId,
    { deviceId, email, writtenAt },
    { [PROP_KIND]: KIND_SPIKE, device: deviceId, writtenAt },
  );
  return { id: f.id, writtenAt };
}

/** Remove this device's heartbeat files. */
export async function cleanupHeartbeats(client: DriveClient, deviceId: string): Promise<number> {
  const files = await client.list(
    `${appPropQuery(PROP_KIND, KIND_SPIKE)} and ${appPropQuery('device', deviceId)} and trashed = false`,
  );
  for (const f of files) await client.deleteFile(f.id);
  return files.length;
}

export interface ObservedChange {
  seenAt: number;
  fileId: string;
  name: string;
  fromDevice?: string;
  by?: string;
  /** seenAt − writtenAt (writer's clock). Includes clock skew between devices. */
  latencyMs?: number;
  removed: boolean;
}

/** Checklist Q2: poll changes.list and report how long other devices' writes take to arrive. */
export class ChangesPoller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pageToken: string | null = null;
  polls = 0;

  constructor(
    private readonly client: DriveClient,
    private readonly ownDeviceId: string,
    private readonly onChanges: (c: ObservedChange[]) => void,
    private readonly onError: (e: unknown) => void,
  ) {}

  get running(): boolean {
    return this.timer !== null;
  }

  async start(intervalMs: number): Promise<void> {
    this.stop();
    this.pageToken ??= await this.client.getStartPageToken();
    const tick = async () => {
      try {
        const { changes, nextPageToken } = await this.client.listChanges(this.pageToken!);
        this.pageToken = nextPageToken;
        this.polls++;
        const observed = changes.filter(isRelevant).map((c) => this.toObserved(c));
        const foreign = observed.filter((c) => c.fromDevice !== this.ownDeviceId);
        if (foreign.length) this.onChanges(foreign);
      } catch (e) {
        this.onError(e);
      }
      if (this.timer !== null) this.timer = setTimeout(tick, intervalMs);
    };
    this.timer = setTimeout(tick, 0);
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private toObserved(c: DriveChange): ObservedChange {
    const seenAt = Date.now();
    const writtenAt = c.file?.appProperties?.writtenAt;
    return {
      seenAt,
      fileId: c.fileId,
      name: c.file?.name ?? c.fileId,
      fromDevice: c.file?.appProperties?.device,
      by: c.file?.lastModifyingUser?.emailAddress,
      latencyMs: writtenAt ? seenAt - Date.parse(writtenAt) : undefined,
      removed: c.removed,
    };
  }
}

function isRelevant(c: DriveChange): boolean {
  return c.file?.appProperties?.[PROP_KIND] === KIND_SPIKE;
}
