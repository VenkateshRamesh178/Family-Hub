import {
  can,
  childFolders,
  docFolderInputSchema,
  documentInputSchema,
  folderAndDescendants,
  folderPath,
  formatFileSize,
  todayIso,
  type DocAuditAction,
  type DocAuditEvent,
  type DocFolder,
  type DocumentInput,
  type FamilyDocument,
  type PurchasedItem,
} from '@family-hub/core';
import {
  ArrowLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Folder,
  FolderPlus,
  Paperclip,
  Pencil,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useSession } from '../app/family-context';
import { ExpiryBadge } from '../components/badges';
import { FileButton, canOpenInBrowser, uploadFiles, useOpenFile } from '../components/file-button';
import { Badge, Button, Card, CardTitle, EmptyState, ErrorNote, Input, Label, Select, Spinner, Textarea, ViewOnlyNote } from '../components/ui';
import { formatDate, formatDateTime } from '../lib/dates';
import {
  useDocAudit,
  useDocFolders,
  useDocMutation,
  useDocs,
  useDocTrash,
  useDocVersions,
  useMembers,
  usePurchases,
} from '../lib/queries';
import { cn } from '../lib/utils';
import { provider } from '../services';

type Tab = 'files' | 'trash' | 'activity';
const TABS: [Tab, string][] = [
  ['files', 'Files'],
  ['trash', 'Trash'],
  ['activity', 'Activity'],
];

/**
 * Where you are lives in the URL (?folder=…&doc=…&tab=…), so the back button
 * works and the calendar can link straight to a document.
 */
function usePlace() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find(([t]) => t === params.get('tab'))?.[0] ?? 'files') as Tab;
  const place = { tab, folderId: params.get('folder'), docId: params.get('doc') };
  const go = (next: Partial<typeof place>) => {
    const p = { ...place, ...next };
    const q = new URLSearchParams();
    if (p.tab !== 'files') q.set('tab', p.tab);
    if (p.folderId) q.set('folder', p.folderId);
    if (p.docId) q.set('doc', p.docId);
    setParams(q);
  };
  return { ...place, go };
}

export function DocumentsPage() {
  const { role } = useSession();
  const canEdit = can(role, 'docs', 'write');
  const { tab, go } = usePlace();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Documents</h1>
      {!canEdit && <ViewOnlyNote />}
      <div className="flex gap-2 overflow-x-auto" role="tablist">
        {TABS.map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => go({ tab: value, docId: null })}
            className={cn(
              'min-h-9 shrink-0 rounded-full border px-3 text-sm',
              tab === value
                ? 'border-brand-700 bg-brand-700 text-white'
                : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'files' && <FilesTab canEdit={canEdit} />}
      {tab === 'trash' && <TrashTab canEdit={canEdit} />}
      {tab === 'activity' && (
        <Card>
          <ActivityList />
        </Card>
      )}
    </div>
  );
}

// --- Files ----------------------------------------------------------------------------

function FilesTab({ canEdit }: { canEdit: boolean }) {
  const { folderId, docId, go } = usePlace();
  const docs = useDocs();
  const folders = useDocFolders();
  const purchases = usePurchases();
  const [search, setSearch] = useState('');
  const [panel, setPanel] = useState<null | 'new-folder' | 'edit-folder'>(null);
  const upload = useDocMutation((files: File[]) => uploadFiles(files, { folderId }));

  if (docs.isPending || folders.isPending) return <Spinner />;
  if (docs.isError) return <ErrorNote error={docs.error} />;
  if (folders.isError) return <ErrorNote error={folders.error} />;

  const purchaseNames = new Map((purchases.data ?? []).map((p) => [p.id, p.itemName]));
  const open = docId ? docs.data.find((d) => d.id === docId) : undefined;
  if (open) {
    return (
      <DocumentDetail
        doc={open}
        folders={folders.data}
        purchases={purchases.data ?? []}
        canEdit={canEdit}
        onBack={() => go({ docId: null, folderId: open.folderId })}
      />
    );
  }

  const path = folderPath(folders.data, folderId);
  const current = path.at(-1) ?? null;
  const q = search.trim().toLowerCase();
  const shownDocs = q
    ? docs.data.filter((d) => d.title.toLowerCase().includes(q) || d.file?.filename.toLowerCase().includes(q))
    : docs.data.filter((d) => d.folderId === (current?.id ?? null));
  const shownFolders = q ? [] : childFolders(folders.data, current?.id ?? null);

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <FileButton multiple size="sm" onFiles={(files) => upload.mutate(files)} loading={upload.isPending}>
            <Upload className="size-4" aria-hidden />
            {upload.isPending ? 'Uploading…' : 'Upload'}
          </FileButton>
          <Button size="sm" variant="secondary" onClick={() => setPanel(panel === 'new-folder' ? null : 'new-folder')}>
            <FolderPlus className="size-4" aria-hidden />
            New folder
          </Button>
          {current && (
            <Button size="sm" variant="ghost" onClick={() => setPanel(panel === 'edit-folder' ? null : 'edit-folder')}>
              <Pencil className="size-4" aria-hidden />
              Edit folder
            </Button>
          )}
        </div>
      )}
      <ErrorNote error={upload.error} />

      {panel === 'new-folder' && (
        <FolderForm
          title={current ? `New folder in ${current.name}` : 'New folder'}
          folders={folders.data}
          initial={{ name: '', parentId: current?.id ?? null }}
          onCancel={() => setPanel(null)}
          onSave={async (input) => {
            await provider.docs.createFolder(input);
            setPanel(null);
          }}
        />
      )}
      {panel === 'edit-folder' && current && (
        <FolderForm
          key={current.id}
          title={`Edit ${current.name}`}
          folders={folders.data}
          editing={current}
          initial={{ name: current.name, parentId: current.parentId }}
          onCancel={() => setPanel(null)}
          onSave={async (input) => {
            await provider.docs.updateFolder(current.id, input);
            setPanel(null);
          }}
          onDelete={async () => {
            await provider.docs.deleteFolder(current.id);
            setPanel(null);
            go({ folderId: current.parentId });
          }}
        />
      )}

      <Input
        type="search"
        placeholder="Search all documents"
        aria-label="Search all documents"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {!q && (
        <nav aria-label="Folder" className="flex flex-wrap items-center gap-1 text-sm">
          <Crumb onClick={() => go({ folderId: null })} active={!current}>
            All documents
          </Crumb>
          {path.map((f) => (
            <span key={f.id} className="flex items-center gap-1">
              <ChevronRight className="size-4 text-slate-400" aria-hidden />
              <Crumb onClick={() => go({ folderId: f.id })} active={f.id === current?.id}>
                {f.name}
              </Crumb>
            </span>
          ))}
        </nav>
      )}

      {shownFolders.length === 0 && shownDocs.length === 0 ? (
        <Card>
          <EmptyState>
            {q
              ? 'No documents match.'
              : current
                ? 'This folder is empty.'
                : canEdit
                  ? 'No documents yet. Upload passports, insurance policies, certificates and anything else the family needs to find.'
                  : 'No documents yet.'}
          </EmptyState>
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {shownFolders.map((f) => (
              <li key={f.id}>
                <button type="button" className={rowClass} onClick={() => go({ folderId: f.id })}>
                  <Folder className="size-5 shrink-0 text-amber-600" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                  <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden />
                </button>
              </li>
            ))}
            {shownDocs.map((d) => (
              <li key={d.id}>
                <button type="button" className={rowClass} onClick={() => go({ docId: d.id })}>
                  <DocSummary
                    doc={d}
                    purchaseName={d.purchaseId ? purchaseNames.get(d.purchaseId) : undefined}
                    folderName={q ? folderPath(folders.data, d.folderId).map((f) => f.name).join(' / ') : undefined}
                  />
                  <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

const rowClass = 'flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50';

function Crumb({ children, active, onClick }: { children: ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn('min-h-9 rounded px-1', active ? 'font-semibold' : 'text-brand-700 underline dark:text-brand-500')}
    >
      {children}
    </button>
  );
}

function DocSummary({ doc, purchaseName, folderName }: { doc: FamilyDocument; purchaseName?: string; folderName?: string }) {
  const today = todayIso();
  return (
    <>
      <FileText className="size-5 shrink-0 text-brand-700 dark:text-brand-500" aria-hidden />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="block truncate font-medium">{doc.title}</span>
        <span className="block truncate text-xs text-slate-500">
          {folderName ? `${folderName} · ` : ''}
          {doc.file ? `${doc.file.filename} · ${formatFileSize(doc.file.size)}` : 'No file'}
        </span>
        {(doc.expiryDate || purchaseName) && (
          <span className="flex flex-wrap gap-1">
            <ExpiryBadge expiryDate={doc.expiryDate} today={today} />
            {purchaseName && (
              <Badge>
                <Paperclip className="mr-1 size-3" aria-hidden />
                {purchaseName}
              </Badge>
            )}
          </span>
        )}
      </span>
    </>
  );
}

// --- One document ------------------------------------------------------------------------

function DocumentDetail({
  doc,
  folders,
  purchases,
  canEdit,
  onBack,
}: {
  doc: FamilyDocument;
  folders: DocFolder[];
  purchases: PurchasedItem[];
  canEdit: boolean;
  onBack: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const open = useOpenFile();
  const replace = useDocMutation((file: File) => provider.docs.replaceFile(doc.id, file));
  const trash = useDocMutation(() => provider.docs.trash(doc.id));
  const purchase = purchases.find((p) => p.id === doc.purchaseId);
  const where = folderPath(folders, doc.folderId).map((f) => f.name).join(' / ') || 'All documents';

  return (
    <div className="space-y-3">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="size-4" aria-hidden />
        {where}
      </Button>

      {editing ? (
        <DocumentForm
          doc={doc}
          folders={folders}
          purchases={purchases}
          onCancel={() => setEditing(false)}
          onSave={async (patch) => {
            await provider.docs.update(doc.id, patch);
            setEditing(false);
          }}
        />
      ) : (
        <Card className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="break-words">{doc.title}</CardTitle>
              {doc.file && (
                <p className="text-xs text-slate-500">
                  {doc.file.filename} · {formatFileSize(doc.file.size)} · uploaded {formatDateTime(doc.file.uploadedAt)}
                  {doc.file.uploadedBy ? ` by ${doc.file.uploadedBy}` : ''}
                </p>
              )}
            </div>
            {canEdit && (
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <ExpiryBadge expiryDate={doc.expiryDate} today={todayIso()} />
            {purchase && (
              <Badge>
                <Paperclip className="mr-1 size-3" aria-hidden />
                For {purchase.itemName}
              </Badge>
            )}
          </div>
          {doc.notes && <p className="text-sm whitespace-pre-line text-slate-600 dark:text-slate-400">{doc.notes}</p>}

          <div className="flex flex-wrap gap-2">
            {canOpenInBrowser(doc) && (
              <Button size="sm" onClick={() => open.mutate({ id: doc.id, inline: true })}>
                <ExternalLink className="size-4" aria-hidden />
                Open
              </Button>
            )}
            <Button size="sm" variant={canOpenInBrowser(doc) ? 'secondary' : 'primary'} onClick={() => open.mutate({ id: doc.id })}>
              <Download className="size-4" aria-hidden />
              Download
            </Button>
            {canEdit && (
              <>
                <FileButton size="sm" variant="secondary" loading={replace.isPending} onFiles={([f]) => f && replace.mutate(f)}>
                  <Upload className="size-4" aria-hidden />
                  Replace file
                </FileButton>
                <Button
                  size="sm"
                  variant="danger"
                  loading={trash.isPending}
                  onClick={() => trash.mutate(undefined, { onSuccess: onBack })}
                >
                  <Trash2 className="size-4" aria-hidden />
                  Move to trash
                </Button>
              </>
            )}
          </div>
          <ErrorNote error={open.error ?? replace.error ?? trash.error} />
        </Card>
      )}

      <Versions doc={doc} canEdit={canEdit} />
      <Card className="space-y-2">
        <CardTitle>Activity</CardTitle>
        <ActivityList documentId={doc.id} />
      </Card>
    </div>
  );
}

function Versions({ doc, canEdit }: { doc: FamilyDocument; canEdit: boolean }) {
  const versions = useDocVersions(doc.id);
  const open = useOpenFile();
  const restore = useDocMutation((versionId: string) => provider.docs.restoreVersion(doc.id, versionId));
  if (!versions.data || versions.data.length < 2) return <ErrorNote error={versions.error} />;

  return (
    <Card className="space-y-2">
      <CardTitle>Earlier versions</CardTitle>
      <p className="text-xs text-slate-500">Replacing the file keeps the old one here, so you can go back to it.</p>
      <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-800">
        {versions.data.map((v) => {
          const current = v.id === doc.file?.id;
          return (
            <li key={v.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate">{v.filename}</span>
                <span className="block text-xs text-slate-500">
                  {formatDateTime(v.uploadedAt)} · {formatFileSize(v.size)}
                  {v.uploadedBy ? ` · ${v.uploadedBy}` : ''}
                </span>
              </span>
              {current ? (
                <Badge tone="brand">Current</Badge>
              ) : (
                <>
                  <Button size="sm" variant="ghost" onClick={() => open.mutate({ id: doc.id, versionId: v.id })}>
                    <Download className="size-4" aria-label="Download this version" />
                  </Button>
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={restore.isPending && restore.variables === v.id}
                      disabled={restore.isPending}
                      onClick={() => restore.mutate(v.id)}
                    >
                      <RotateCcw className="size-4" aria-hidden />
                      Restore
                    </Button>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      <ErrorNote error={open.error ?? restore.error} />
    </Card>
  );
}

/** Folders as select options, indented to show nesting. */
function folderOptions(folders: readonly DocFolder[], exclude: Set<string> = new Set()) {
  const out: { id: string; label: string }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const f of childFolders(folders, parentId)) {
      if (exclude.has(f.id)) continue;
      out.push({ id: f.id, label: `${'  '.repeat(depth)}${depth ? '└ ' : ''}${f.name}` });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function DocumentForm({
  doc,
  folders,
  purchases,
  onSave,
  onCancel,
}: {
  doc: FamilyDocument;
  folders: DocFolder[];
  purchases: PurchasedItem[];
  onSave: (patch: DocumentInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    title: doc.title,
    notes: doc.notes,
    folderId: doc.folderId ?? '',
    expiryDate: doc.expiryDate ?? '',
    purchaseId: doc.purchaseId ?? '',
  });
  const save = useDocMutation(onSave);
  const [invalid, setInvalid] = useState<Error | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Card>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = documentInputSchema.safeParse({
            ...form,
            folderId: form.folderId || null,
            expiryDate: form.expiryDate || null,
            purchaseId: form.purchaseId || null,
          });
          setInvalid(parsed.success ? null : new Error(parsed.error.issues[0]?.message ?? 'Please check the form.'));
          if (parsed.success) save.mutate(parsed.data);
        }}
      >
        <CardTitle>Edit details</CardTitle>
        <div>
          <Label htmlFor="d-title">Title</Label>
          <Input id="d-title" value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={200} required />
        </div>
        <div>
          <Label htmlFor="d-folder">Folder</Label>
          <Select id="d-folder" value={form.folderId} onChange={(e) => set('folderId', e.target.value)}>
            <option value="">All documents (top level)</option>
            {folderOptions(folders).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="d-expiry">Expires on (optional)</Label>
          <Input id="d-expiry" type="date" value={form.expiryDate} onChange={(e) => set('expiryDate', e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">Expiry dates show on the calendar and the dashboard.</p>
        </div>
        <div>
          <Label htmlFor="d-purchase">Receipt or warranty for (optional)</Label>
          <Select id="d-purchase" value={form.purchaseId} onChange={(e) => set('purchaseId', e.target.value)}>
            <option value="">Not linked to a purchase</option>
            {purchases.map((p) => (
              <option key={p.id} value={p.id}>
                {p.itemName} · {formatDate(p.boughtDate)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="d-notes">Notes</Label>
          <Textarea id="d-notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} maxLength={2000} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={save.isPending}>
            Save
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={save.isPending}>
            Cancel
          </Button>
        </div>
        <ErrorNote error={invalid ?? save.error} />
      </form>
    </Card>
  );
}

function FolderForm({
  title,
  folders,
  editing,
  initial,
  onSave,
  onCancel,
  onDelete,
}: {
  title: string;
  folders: DocFolder[];
  editing?: DocFolder;
  initial: { name: string; parentId: string | null };
  onSave: (input: { name: string; parentId: string | null }) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
}) {
  const [name, setName] = useState(initial.name);
  const [parentId, setParentId] = useState(initial.parentId ?? '');
  const [invalid, setInvalid] = useState<Error | null>(null);
  const save = useDocMutation(onSave);
  const remove = useDocMutation(onDelete ?? (async () => {}));
  // A folder can't move into itself or anything inside it.
  const exclude = editing ? folderAndDescendants(folders, editing.id) : new Set<string>();

  return (
    <Card>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = docFolderInputSchema.safeParse({ name, parentId: parentId || null });
          setInvalid(parsed.success ? null : new Error(parsed.error.issues[0]?.message ?? 'Please check the form.'));
          if (parsed.success) save.mutate({ name: parsed.data.name, parentId: parsed.data.parentId ?? null });
        }}
      >
        <CardTitle>{title}</CardTitle>
        <div>
          <Label htmlFor="f-name">Name</Label>
          <Input id="f-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus />
        </div>
        {editing && (
          <div>
            <Label htmlFor="f-parent">Inside</Label>
            <Select id="f-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">All documents (top level)</option>
              {folderOptions(folders, exclude).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={save.isPending} disabled={remove.isPending}>
            Save
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={save.isPending || remove.isPending}>
            Cancel
          </Button>
          {onDelete && (
            <Button
              type="button"
              variant="danger"
              loading={remove.isPending}
              disabled={save.isPending}
              onClick={() => {
                if (confirm(`Delete the folder "${initial.name}"? It must be empty.`)) remove.mutate();
              }}
            >
              Delete folder
            </Button>
          )}
        </div>
        <ErrorNote error={invalid ?? save.error ?? remove.error} />
      </form>
    </Card>
  );
}

// --- Trash ------------------------------------------------------------------------------

function TrashTab({ canEdit }: { canEdit: boolean }) {
  const trash = useDocTrash();
  const restore = useDocMutation((id: string) => provider.docs.restore(id));
  const purge = useDocMutation((id: string) => provider.docs.purge(id));

  if (trash.isPending) return <Spinner />;
  if (trash.isError) return <ErrorNote error={trash.error} />;
  if (trash.data.length === 0)
    return (
      <Card>
        <EmptyState>The trash is empty.</EmptyState>
      </Card>
    );

  const busy = restore.isPending || purge.isPending;
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">Documents stay here until someone deletes them for good.</p>
      <Card className="p-0">
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {trash.data.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{d.title}</span>
                <span className="block truncate text-xs text-slate-500">
                  {d.file?.filename} · deleted {d.deletedAt ? formatDateTime(d.deletedAt) : ''}
                </span>
              </span>
              {canEdit && (
                <>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => restore.mutate(d.id)}>
                    <RotateCcw className="size-4" aria-hidden />
                    Restore
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    onClick={() => {
                      if (confirm(`Delete "${d.title}" and all its versions for good? This can't be undone.`)) purge.mutate(d.id);
                    }}
                  >
                    Delete for good
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <ErrorNote error={restore.error ?? purge.error} />
    </div>
  );
}

// --- Activity ---------------------------------------------------------------------------

const VERBS: Record<DocAuditAction, string> = {
  upload: 'uploaded',
  replace: 'replaced the file of',
  restore_version: 'restored an earlier version of',
  update: 'edited',
  download: 'opened',
  trash: 'moved to the trash',
  restore: 'restored',
  purge: 'deleted for good',
};

function ActivityList({ documentId }: { documentId?: string }) {
  const audit = useDocAudit(documentId);
  const members = useMembers();
  const names = new Map((members.data ?? []).map((m) => [m.email, m.displayName ?? m.email]));

  if (audit.isPending) return <p className="text-sm text-slate-500">Loading…</p>;
  if (audit.isError) return <ErrorNote error={audit.error} />;
  if (audit.data.length === 0) return <p className="text-sm text-slate-500">Nothing yet.</p>;

  return (
    <ul className="space-y-2 text-sm">
      {audit.data.map((e: DocAuditEvent) => (
        <li key={e.id}>
          <span className="font-medium">{names.get(e.actorEmail) ?? e.actorEmail}</span> {VERBS[e.action]}
          {!documentId && <span className="font-medium"> {e.documentTitle}</span>}
          {e.detail && <span className="text-slate-500"> · {e.detail}</span>}
          <span className="block text-xs text-slate-500">{formatDateTime(e.at)}</span>
        </li>
      ))}
    </ul>
  );
}
