import {
  FOLDER_KEYS,
  FOLDER_NAMES,
  READER_ROLE,
  slugifyRoleId,
  type FolderAccess,
  type Member,
  type RoleDefinition,
} from '@family-hub/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '../app/family-context';
import { Badge, Button, Card, CardTitle, ErrorNote, Input, Label, Select, Spinner } from '../components/ui';
import { cn } from '../lib/utils';
import { provider } from '../services';

const membersKey = ['members'] as const;
const rolesKey = ['roles'] as const;

export function AdminPage() {
  const [tab, setTab] = useState<'members' | 'roles'>('members');
  return (
    <div className="space-y-4">
      <div role="tablist" className="grid grid-cols-2 rounded-lg bg-slate-200 p-1 dark:bg-slate-800">
        {(['members', 'roles'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              'min-h-10 rounded-md text-sm font-medium capitalize',
              tab === t ? 'bg-white shadow-sm dark:bg-slate-950' : 'text-slate-600 dark:text-slate-400',
            )}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'members' ? <MembersTab /> : <RolesTab />}
    </div>
  );
}

// --- Members ---------------------------------------------------------------

function MembersTab() {
  const session = useSession();
  const qc = useQueryClient();
  const members = useQuery({ queryKey: membersKey, queryFn: () => provider.listMembers() });
  const roles = useQuery({ queryKey: rolesKey, queryFn: () => provider.listRoles() });
  const invalidate = () => qc.invalidateQueries({ queryKey: membersKey });

  if (members.isPending || roles.isPending) return <Spinner />;
  if (members.isError || roles.isError) return <ErrorNote error={members.error ?? roles.error} />;

  return (
    <div className="space-y-4">
      <InviteForm roles={roles.data} onDone={invalidate} />
      <Card className="space-y-1">
        <CardTitle>Members</CardTitle>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          <li className="flex items-center justify-between gap-2 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{session.me.displayName}</p>
              <p className="truncate text-xs text-slate-500">{session.me.email}</p>
            </div>
            <Badge tone="brand">Admin (owner)</Badge>
          </li>
          {members.data.map((m) => (
            <MemberRow key={m.email} member={m} roles={roles.data} onDone={invalidate} />
          ))}
        </ul>
        {members.data.length === 0 && <p className="py-2 text-sm text-slate-500">No one else yet — invite someone above.</p>}
      </Card>
    </div>
  );
}

function InviteForm({ roles, onDone }: { roles: RoleDefinition[]; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState(READER_ROLE.id);
  const invite = useMutation({
    mutationFn: () => provider.inviteMember({ email, roleId }),
    onSuccess: () => {
      setEmail('');
      onDone();
    },
  });

  return (
    <Card>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          invite.mutate();
        }}
      >
        <CardTitle>Invite a family member</CardTitle>
        <div>
          <Label htmlFor="invite-email">Their Google account email</Label>
          <Input
            id="invite-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="invite-role">Role</Label>
          <Select id="invite-role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" loading={invite.isPending}>
          <UserPlus className="size-4" aria-hidden />
          Send invite
        </Button>
        {invite.isSuccess && (
          <p className="text-sm text-green-700 dark:text-green-400">
            Invited. Google will email them a link to the shared folder.
          </p>
        )}
        <ErrorNote error={invite.error} />
      </form>
    </Card>
  );
}

function MemberRow({ member, roles, onDone }: { member: Member; roles: RoleDefinition[]; onDone: () => void }) {
  const change = useMutation({
    mutationFn: (roleId: string) => provider.changeMemberRole(member.email, roleId),
    onSuccess: onDone,
  });
  const remove = useMutation({
    mutationFn: () => provider.removeMember(member.email),
    onSuccess: onDone,
  });

  return (
    <li className="space-y-2 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-medium">{member.email}</p>
        <Badge tone={member.status === 'active' ? 'ok' : 'warn'}>{member.status}</Badge>
      </div>
      <div className="flex items-center gap-2">
        <Select
          aria-label={`Role for ${member.email}`}
          value={member.roleId}
          disabled={change.isPending}
          onChange={(e) => change.mutate(e.target.value)}
          className="flex-1"
        >
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
        <Button
          variant="danger"
          size="sm"
          loading={remove.isPending}
          aria-label={`Remove ${member.email}`}
          onClick={() => {
            if (confirm(`Remove ${member.email}? They will lose access to the family folder.`)) remove.mutate();
          }}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </div>
      <ErrorNote error={change.error ?? remove.error} />
    </li>
  );
}

// --- Roles -----------------------------------------------------------------

function RolesTab() {
  const roles = useQuery({ queryKey: rolesKey, queryFn: () => provider.listRoles() });
  const [editing, setEditing] = useState<RoleDefinition | null>(null);

  if (roles.isPending) return <Spinner />;
  if (roles.isError) return <ErrorNote error={roles.error} />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Every member can view everything in the family folder. A role decides which areas they can also change.
        Vault access is granted separately (coming in Phase 4).
      </p>
      {roles.data.map((r) => (
        <Card key={r.id} className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle>{r.name}</CardTitle>
            {r.builtIn ? (
              <Badge>Built-in</Badge>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
                Edit
              </Button>
            )}
          </div>
          {r.description && <p className="text-sm text-slate-500">{r.description}</p>}
          <FolderGrid folders={r.folders} />
        </Card>
      ))}
      {editing ? (
        <RoleEditor initial={editing} onClose={() => setEditing(null)} />
      ) : (
        <Button
          variant="secondary"
          onClick={() => setEditing({ id: '', name: '', builtIn: false, folders: { ...READER_ROLE.folders } })}
        >
          New custom role
        </Button>
      )}
    </div>
  );
}

function FolderGrid({
  folders,
  onChange,
}: {
  folders: RoleDefinition['folders'];
  onChange?: (k: (typeof FOLDER_KEYS)[number], v: FolderAccess) => void;
}) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
      {FOLDER_KEYS.map((k) => (
        <li key={k} className="flex items-center justify-between gap-2">
          <span className="text-slate-600 dark:text-slate-400">{FOLDER_NAMES[k]}</span>
          {onChange && k !== 'meta' ? (
            <Select
              aria-label={`Access to ${FOLDER_NAMES[k]}`}
              className="min-h-9 w-auto py-0 text-sm"
              value={folders[k]}
              onChange={(e) => onChange(k, e.target.value as FolderAccess)}
            >
              <option value="reader">View</option>
              <option value="writer">Edit</option>
            </Select>
          ) : (
            <Badge tone={folders[k] === 'writer' ? 'ok' : 'neutral'}>{folders[k] === 'writer' ? 'Edit' : 'View'}</Badge>
          )}
        </li>
      ))}
    </ul>
  );
}

function RoleEditor({ initial, onClose }: { initial: RoleDefinition; onClose: () => void }) {
  const qc = useQueryClient();
  const [role, setRole] = useState(initial);
  const isNew = !initial.id;
  const done = () => {
    void qc.invalidateQueries({ queryKey: rolesKey });
    onClose();
  };
  const save = useMutation({
    mutationFn: async () => {
      const id = role.id || slugifyRoleId(role.name);
      if (isNew && qc.getQueryData<RoleDefinition[]>(rolesKey)?.some((r) => r.id === id)) {
        throw new Error('A role with that name already exists.');
      }
      return provider.saveCustomRole({ ...role, id });
    },
    onSuccess: done,
  });
  const del = useMutation({ mutationFn: () => provider.deleteCustomRole(role.id), onSuccess: done });

  return (
    <Card className="space-y-3">
      <CardTitle>{isNew ? 'New custom role' : `Edit ${initial.name}`}</CardTitle>
      <div>
        <Label htmlFor="role-name">Name</Label>
        <Input
          id="role-name"
          value={role.name}
          maxLength={40}
          onChange={(e) => setRole({ ...role, name: e.target.value })}
        />
      </div>
      <FolderGrid folders={role.folders} onChange={(k, v) => setRole({ ...role, folders: { ...role.folders, [k]: v } })} />
      <p className="text-xs text-slate-500">_meta is always view-only: only the admin manages members and roles.</p>
      <div className="flex flex-wrap gap-2">
        <Button loading={save.isPending} disabled={!role.name.trim()} onClick={() => save.mutate()}>
          Save
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        {!isNew && (
          <Button variant="danger" loading={del.isPending} onClick={() => del.mutate()}>
            Delete role
          </Button>
        )}
      </div>
      <ErrorNote error={save.error ?? del.error} />
    </Card>
  );
}
