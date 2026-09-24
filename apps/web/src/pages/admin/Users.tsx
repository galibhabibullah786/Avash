import { appRoleSchema, type AppRole } from '@avash/types';
import { useState } from 'react';
import { useSession } from '../../features/auth/SessionProvider';
import { useManagedUsers } from '../../features/admin/useManagedUsers';
import { useAssignRole } from '../../features/admin/useAssignRole';
import { ROLE_LABELS } from '../../features/dashboard/roleDashboards';
import { useListQuery } from '../../hooks/useListQuery';
import { DataTable, type DataTableColumn } from '../../components/DataTable';
import '../../features/dashboard/dashboard.css';

const ROLE_OPTIONS: readonly AppRole[] = appRoleSchema.options;

/** Admin API's `listUsers` has no sortable columns (baseline fact 3). */
const SORTABLE: readonly string[] = [];

interface ManagedUserRow {
  id: string;
  email: string | null;
  role: AppRole;
  createdAt: string;
  lastSignInAt: string | null;
}

/**
 * The in-app role assignment mechanism. Before this existed,
 * `app_metadata.role` could only be set by hand in the Supabase dashboard.
 *
 * The <select> writes immediately on change rather than behind a Save
 * button: there is exactly one field, the change is reversible from the
 * same control, and the table refetches from the server afterwards — so
 * what is displayed is always the role that actually stuck, never an
 * optimistic guess.
 */
export default function AdminUsers() {
  const { accessToken, user } = useSession();
  const { query, setPage, setPageSize } = useListQuery(SORTABLE);
  const usersQuery = useManagedUsers(accessToken, { page: query.page, pageSize: query.pageSize });
  const assign = useAssignRole();

  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  const handleRoleChange = (userId: string, nextRole: string) => {
    const parsed = appRoleSchema.safeParse(nextRole);
    if (!parsed.success || !accessToken) {
      return;
    }
    setPendingUserId(userId);
    assign?.mutate?.(
      { userId, role: parsed.data, accessToken },
      { onSettled: () => setPendingUserId(null) }
    );
  };

  const rows: ManagedUserRow[] = usersQuery?.data?.items ?? [];
  const page = usersQuery?.data?.page ?? {
    page: query.page,
    pageSize: query.pageSize,
    total: null,
    hasNext: false,
    sort: null,
    dir: 'asc' as const,
  };

  const columns: DataTableColumn<ManagedUserRow>[] = [
    {
      key: 'email',
      header: 'Email',
      render: (managed) => (
        <span data-testid="admin-users-email">
          {managed?.email ?? '(no email)'}
          {managed?.id === user?.id ? ' (you)' : ''}
        </span>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (managed) => {
        const isSelf = managed?.id === user?.id;
        return (
          // aria-label rather than a visually-hidden <label>: the column
          // header already names the control for a sighted user, and this
          // gives a screen reader the row context the header alone can't.
          <select
            aria-label={`Role for ${managed?.email ?? 'this account'}`}
            className="admin-users__role-select"
            data-testid="admin-users-role-select"
            value={managed.role}
            // An admin cannot demote themselves — the API refuses it
            // (409) to avoid a project with zero admins and no way back
            // in. Disabling the control says so before the round trip
            // rather than after.
            disabled={isSelf || pendingUserId === managed.id}
            onChange={(event) => handleRoleChange(managed.id, event?.target?.value ?? '')}
          >
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role] ?? role}
              </option>
            ))}
          </select>
        );
      },
    },
    {
      key: 'createdAt',
      header: 'Joined',
      render: (managed) => (managed?.createdAt ? new Date(managed.createdAt).toLocaleDateString() : '—'),
    },
    {
      key: 'lastSignInAt',
      header: 'Last sign-in',
      render: (managed) => (managed?.lastSignInAt ? new Date(managed.lastSignInAt).toLocaleDateString() : 'Never'),
    },
  ];

  return (
    <main className="page page--wide">
      <h1 className="page__title">Users &amp; roles</h1>
      <p className="page__description">
        A role change takes effect on the user’s next sign-in — the claim is baked into their session
        token when it is issued, so an already-signed-in user keeps their current role until then.
        Every change is written to the audit trail.
      </p>

      {usersQuery?.isLoading ? (
        <p data-testid="admin-users-loading">Loading…</p>
      ) : usersQuery?.isError ? (
        <div className="alert alert--error" data-testid="admin-users-error">
          Unable to load the user list right now.
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          page={page}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          emptyMessage="No accounts yet."
          note="The user directory cannot be searched or sorted — the Admin API this route is backed by does not support it."
          data-testid="admin-users"
        />
      )}

      {assign?.isError ? (
        <p className="field__error" role="alert" data-testid="admin-users-assign-error">
          {assign.error?.message ?? 'Could not change that role. Please try again.'}
        </p>
      ) : null}

      {assign?.isSuccess && !assign?.isPending ? (
        <p className="alert" role="status" data-testid="admin-users-assign-success">
          Role updated.
        </p>
      ) : null}
    </main>
  );
}
