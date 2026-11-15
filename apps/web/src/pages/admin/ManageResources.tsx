import { useManageResources } from '../../features/resources/useManageResources';
import { Spinner } from '@avash/ui';
import { BloodInventoryModal } from './BloodInventoryModal';
import { HospitalFormModal } from './HospitalFormModal';

export default function ManageResources() {
  const {
    hospitals,
    paginatedHospitals,
    loading,
    error,
    formState,
    setFormState,
    bloodInventory,
    selectedHospitalForBlood,
    setSelectedHospitalForBlood,
    handleSave,
    handleDelete,
    loadBloodInventory,
    handleUpdateAllBlood,
    loadHospitals,
    isSaving,
    deletingId,
    updatingBlood,
    loadingBlood,
    currentPage,
    totalPages,
    pageSize,
    setPageSize,
    totalCount,
    setCurrentPage,
  } = useManageResources();

  if (loading && hospitals.length === 0) {
    return (
      <div className="p-8 flex justify-center items-center gap-3">
        <Spinner label="Loading hospitals…" />
        <span>Loading hospitals…</span>
      </div>
    );
  }

  if (error && hospitals.length === 0) {
    return (
      <div className="p-4 text-red-600 flex flex-col items-start gap-3">
        <p>{error}</p>
        <button
          type="button"
          onClick={loadHospitals}
          className="px-4 py-2 bg-[var(--color-primary)] text-white rounded font-semibold transition"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-6">
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-600 rounded flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={loadHospitals}
            className="px-3 py-1 bg-red-600 text-white rounded text-sm font-semibold hover:bg-red-700 transition"
          >
            Retry
          </button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Manage Resources</h1>
        <button
          onClick={() => setFormState({ name: '', lat: 23.81, lng: 90.41, verified: true })}
          className="bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white px-4 py-2 rounded shadow transition font-semibold"
        >
          Add Hospital
        </button>
      </div>

      {formState && (
        <HospitalFormModal
          formState={formState}
          isSaving={isSaving}
          onSave={handleSave}
          onCancel={() => setFormState(null)}
          onChange={setFormState}
        />
      )}

      {selectedHospitalForBlood && (
        <BloodInventoryModal
          hospital={selectedHospitalForBlood}
          bloodInventory={bloodInventory}
          loadingBlood={loadingBlood}
          updatingBlood={updatingBlood}
          onClose={() => setSelectedHospitalForBlood(null)}
          onUpdateAllBlood={handleUpdateAllBlood}
        />
      )}

      <div className="bg-[var(--color-surface)] shadow rounded-lg border border-[var(--color-border)] overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--color-border)]">
          <thead className="bg-[var(--color-surface-subtle)]">
            <tr>
              <th className="px-6 py-4 text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Hospital</th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Contact</th>
              <th className="px-6 py-4 text-right text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-[var(--color-surface)] divide-y divide-[var(--color-border)]">
            {paginatedHospitals.map(h => (
              <tr key={h.id} className="hover:bg-[var(--color-surface-subtle)] transition">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="font-medium text-[var(--color-text)]">{h.name}</div>
                  <div className="text-sm text-[var(--color-text-muted)]">{h.lat.toFixed(4)}, {h.lng.toFixed(4)}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-[var(--color-text)]">{h.phone || 'No phone'}</div>
                  <div className="text-sm text-[var(--color-text-muted)] truncate max-w-xs">{h.address || 'No address'}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-3">
                  <button onClick={() => loadBloodInventory(h)} className="text-[var(--color-danger)] hover:underline font-semibold px-2 py-1 rounded">Blood Inventory</button>
                  <button onClick={() => setFormState(h)} className="text-[var(--color-primary)] hover:underline font-semibold px-2 py-1 rounded">Edit</button>
                  <button
                    onClick={() => handleDelete(h.id)}
                    disabled={deletingId === h.id}
                    className="text-[var(--color-text-muted)] hover:text-[var(--color-danger)] font-semibold px-2 py-1 rounded inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    {deletingId === h.id && <Spinner label="Deleting…" className="spinner--button" />}
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {paginatedHospitals.length === 0 && (
              <tr><td colSpan={3} className="px-6 py-8 text-center text-[var(--color-text-muted)]">No hospitals found. Add one to get started.</td></tr>
            )}
          </tbody>
        </table>
        {totalCount > 0 && (
          <div className="p-4 border-t border-[var(--color-border)] flex items-center justify-between flex-wrap gap-4">
            <span className="text-sm text-[var(--color-text-muted)]">
              Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, totalCount)} of {totalCount} hospitals
            </span>
            <div className="flex items-center space-x-3">
              <label className="text-xs text-[var(--color-text-muted)] flex items-center gap-1.5">
                <span>Per page:</span>
                <select
                  aria-label="Hospitals per page"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-2 py-1 text-sm text-[var(--color-text)]"
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
              </label>
              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="px-3 py-1 border border-[var(--color-border)] rounded text-sm disabled:opacity-40 hover:bg-[var(--color-surface-subtle)] transition"
                >
                  Previous
                </button>
                <span className="text-sm px-2 text-[var(--color-text)]">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="px-3 py-1 border border-[var(--color-border)] rounded text-sm disabled:opacity-40 hover:bg-[var(--color-surface-subtle)] transition"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
