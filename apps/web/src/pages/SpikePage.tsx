import {
  ChangesPoller,
  cleanupHeartbeats,
  probeAccess,
  writeHeartbeat,
  type ObservedChange,
  type ProbeResult,
} from '@family-hub/drive-provider';
import { CheckCircle2, ClipboardCopy, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAuth } from '../app/auth-context';
import { useSession } from '../app/family-context';
import { Badge, Button, Card, CardTitle, ErrorNote, Label, Select } from '../components/ui';
import { errorMessage } from '../lib/utils';
import { auth, client, deviceId } from '../services';

/**
 * Phase 0 spike (plan §7). Run on two devices signed in as two different
 * accounts (admin + invited member), then copy the report into docs/phase-0-results.md.
 */
export function SpikePage() {
  const session = useSession();
  const device = deviceId();
  const [probes, setProbes] = useState<ProbeResult[] | null>(null);
  const [changes, setChanges] = useState<ObservedChange[]>([]);
  const [writes, setWrites] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);

  const report = () => ({
    at: new Date().toISOString(),
    device,
    account: session.me.email,
    role: session.role.id,
    scopes: auth.scopes,
    userAgent: navigator.userAgent,
    token: auth.events,
    access: probes,
    heartbeatsWritten: writes.length,
    changesObserved: changes,
    latency: stats(changes),
    driveRequests: client.requestCount,
  });

  return (
    <div className="space-y-4">
      <Card className="space-y-1">
        <CardTitle>Phase 0 — Drive feasibility</CardTitle>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Run this on two phones signed in as different accounts (admin + invited member). Device{' '}
          <code>{device}</code>, role <Badge tone="brand">{session.role.name}</Badge>
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navigator.clipboard.writeText(JSON.stringify(report(), null, 2))}
        >
          <ClipboardCopy className="size-4" aria-hidden /> Copy report as JSON
        </Button>
      </Card>

      <AccessSection probes={probes} setProbes={setProbes} setError={setError} />
      <SyncSection
        changes={changes}
        setChanges={setChanges}
        writes={writes}
        setWrites={setWrites}
        setError={setError}
      />
      <TokenSection />
      <ErrorNote error={error} />
    </div>
  );
}

function AccessSection({
  probes,
  setProbes,
  setError,
}: {
  probes: ProbeResult[] | null;
  setProbes: (p: ProbeResult[]) => void;
  setError: (e: unknown) => void;
}) {
  const { family } = useSession();
  const [busy, setBusy] = useState(false);
  return (
    <Card className="space-y-3">
      <CardTitle>Q1 + Q4 · What can this account access?</CardTitle>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        With <code>drive.file</code>, a member picks only the root folder. Does that cover subfolders and files other
        members created? Do <code>canShare</code> values show re-sharing is blocked for Editors?
      </p>
      <Button
        size="sm"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setProbes(await probeAccess(client, family));
          } catch (e) {
            setError(e);
          }
          setBusy(false);
        }}
      >
        Run access probe
      </Button>
      {probes && (
        <ul className="space-y-2 text-sm">
          {probes.map((p) => (
            <li key={p.label} className="flex gap-2">
              {p.ok ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600" aria-label="ok" />
              ) : (
                <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" aria-label="failed" />
              )}
              <div className="min-w-0">
                <p className="font-medium">{p.label}</p>
                <p className="break-words text-xs text-slate-500">{p.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SyncSection({
  changes,
  setChanges,
  writes,
  setWrites,
  setError,
}: {
  changes: ObservedChange[];
  setChanges: (fn: (c: ObservedChange[]) => ObservedChange[]) => void;
  writes: string[];
  setWrites: (fn: (w: string[]) => string[]) => void;
  setError: (e: unknown) => void;
}) {
  const { family, me } = useSession();
  const { reportError } = useAuth();
  const device = deviceId();
  const [intervalMs, setIntervalMs] = useState(5000);
  const [polling, setPolling] = useState(false);
  const [autoWrite, setAutoWrite] = useState(false);
  const pollerRef = useRef<ChangesPoller | null>(null);

  useEffect(() => () => pollerRef.current?.stop(), []);

  useEffect(() => {
    if (!autoWrite) return;
    const t = setInterval(() => void write(), 30_000);
    return () => clearInterval(t);
  }, [autoWrite]);

  async function write() {
    try {
      const { writtenAt } = await writeHeartbeat(client, family.folders.chat, device, me.email);
      setWrites((w) => [...w, writtenAt]);
    } catch (e) {
      reportError(e);
      setError(e);
    }
  }

  async function togglePolling() {
    if (polling) {
      pollerRef.current?.stop();
      setPolling(false);
      return;
    }
    pollerRef.current ??= new ChangesPoller(
      client,
      device,
      (c) => setChanges((prev) => [...c, ...prev].slice(0, 200)),
      (e) => {
        reportError(e);
        setError(e);
      },
    );
    await pollerRef.current.start(intervalMs);
    setPolling(true);
  }

  const s = useMemo(() => stats(changes), [changes]);

  return (
    <Card className="space-y-3">
      <CardTitle>Q2 · Do devices see each other's writes?</CardTitle>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Start polling on both devices, then write heartbeats on one. Latency is measured against the writer's clock,
        so keep both phones on automatic time.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="poll-interval">Poll every</Label>
          <Select
            id="poll-interval"
            value={intervalMs}
            disabled={polling}
            onChange={(e) => setIntervalMs(Number(e.target.value))}
            className="w-28"
          >
            {[2000, 5000, 15000, 60000].map((ms) => (
              <option key={ms} value={ms}>
                {ms / 1000}s
              </option>
            ))}
          </Select>
        </div>
        <Button size="sm" variant={polling ? 'secondary' : 'primary'} onClick={togglePolling}>
          {polling ? 'Stop polling' : 'Start polling'}
        </Button>
        <Button size="sm" variant="secondary" onClick={write}>
          Write heartbeat
        </Button>
        <Button size="sm" variant={autoWrite ? 'primary' : 'secondary'} onClick={() => setAutoWrite((v) => !v)}>
          {autoWrite ? 'Auto-write on (30s)' : 'Auto-write off'}
        </Button>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center text-sm">
        <Stat label="Seen" value={String(s.count)} />
        <Stat label="Median" value={s.median != null ? `${(s.median / 1000).toFixed(1)}s` : '—'} />
        <Stat label="p90" value={s.p90 != null ? `${(s.p90 / 1000).toFixed(1)}s` : '—'} />
      </dl>
      <p className="text-xs text-slate-500">
        Heartbeats written here: {writes.length} · Drive requests this session: {client.requestCount} · polls:{' '}
        {pollerRef.current?.polls ?? 0}
      </p>
      {changes.length > 0 && (
        <ul className="max-h-60 space-y-1 overflow-y-auto text-xs">
          {changes.map((c, i) => (
            <li key={`${c.fileId}-${i}`} className="flex justify-between gap-2">
              <span className="truncate">
                {c.by ?? 'unknown'} · device {c.fromDevice ?? '?'}
              </span>
              <span className="shrink-0 tabular-nums">
                {c.latencyMs != null ? `${(c.latencyMs / 1000).toFixed(1)}s` : '—'}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={async () => {
          try {
            const n = await cleanupHeartbeats(client, device);
            alert(`Deleted ${n} heartbeat file(s) from this device.`);
          } catch (e) {
            setError(e);
          }
        }}
      >
        Delete this device's heartbeat files
      </Button>
    </Card>
  );
}

function TokenSection() {
  const snapshot = useSyncExternalStore(
    (fn) => auth.subscribe(fn),
    () => auth.events.length + ':' + (auth.current?.expiresAt ?? 0),
  );
  const [now, setNow] = useState(Date.now());
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  void snapshot;

  const token = auth.current;
  const left = token ? Math.max(0, Math.round((token.expiresAt - now) / 1000)) : 0;

  return (
    <Card className="space-y-3">
      <CardTitle>Q3 · How reliable is token renewal?</CardTitle>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Tokens last about an hour. Leave the app open past expiry, and try backgrounding it, to see whether silent
        renewal works without a popup.
      </p>
      <p className="text-sm">
        Expires in{' '}
        <span className="font-mono tabular-nums">
          {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
        </span>
        <span className="block break-all text-xs text-slate-500">Scopes: {token?.scope ?? '—'}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            setErr(null);
            try {
              await auth.getAccessToken(true);
            } catch (e) {
              setErr(errorMessage(e));
            }
          }}
        >
          Force silent renewal
        </Button>
        <Button size="sm" variant="secondary" onClick={() => auth.signIn().catch((e) => setErr(errorMessage(e)))}>
          Renew with popup
        </Button>
      </div>
      {err && <p className="text-sm text-red-700 dark:text-red-400">{err}</p>}
      {auth.events.length > 0 && (
        <ul className="space-y-1 text-xs">
          {[...auth.events].reverse().map((e, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span>
                {new Date(e.at).toLocaleTimeString()} · {e.kind}
              </span>
              <span className={e.ok ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}>
                {e.ok ? `ok in ${e.ms}ms` : (e.error ?? 'failed')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-100 p-2 dark:bg-slate-800">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function stats(changes: ObservedChange[]) {
  const lat = changes
    .map((c) => c.latencyMs)
    .filter((x): x is number => x != null)
    .sort((a, b) => a - b);
  const pick = (q: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(q * lat.length))]! : null);
  return { count: changes.length, median: pick(0.5), p90: pick(0.9) };
}
