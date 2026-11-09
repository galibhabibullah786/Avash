import { useManageResources } from '../../features/resources/useManageResources';

export default function ManageResources() {
  const {
    hospitals,
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
    handleUpdateBlood,
    loadHospitals
  } = useManageResources();

  if (loading && hospitals.length === 0) return <div className="p-4">Loading...</div>;
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
        <form onSubmit={handleSave} className="bg-[var(--color-surface)] p-6 rounded-lg shadow-md space-y-4 border border-[var(--color-border)]">
          <h2 className="text-xl font-semibold text-[var(--color-text)]">{formState.id ? 'Edit' : 'Add'} Hospital</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-muted)] mb-1">Name</label>
              <input
                type="text"
                required
                value={formState.name || ''}
                onChange={e => setFormState({ ...formState, name: e.target.value })}
                className="w-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] rounded p-2 focus:ring focus:ring-[var(--color-primary)]/20 outline-none transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-muted)] mb-1">Address</label>
              <input
                type="text"
                value={formState.address || ''}
                onChange={e => setFormState({ ...formState, address: e.target.value })}
                className="w-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] rounded p-2 focus:ring focus:ring-[var(--color-primary)]/20 outline-none transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-muted)] mb-1">Latitude</label>
              <input
                type="number"
                step="any"
                required
                value={formState.lat ?? ''}
                onChange={e => setFormState({ ...formState, lat: e.target.value as unknown as number })}
                className="w-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] rounded p-2 focus:ring focus:ring-[var(--color-primary)]/20 outline-none transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-muted)] mb-1">Longitude</label>
              <input
                type="number"
                step="any"
                required
                value={formState.lng ?? ''}
                onChange={e => setFormState({ ...formState, lng: e.target.value as unknown as number })}
                className="w-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] rounded p-2 focus:ring focus:ring-[var(--color-primary)]/20 outline-none transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--color-text-muted)] mb-1">Phone</label>
              <input
                type="text"
                value={formState.phone || ''}
                onChange={e => setFormState({ ...formState, phone: e.target.value })}
                className="w-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] rounded p-2 focus:ring focus:ring-[var(--color-primary)]/20 outline-none transition"
              />
            </div>
            <div className="flex items-center pt-6">
              <input
                type="checkbox"
                checked={formState.verified ?? true}
                onChange={e => setFormState({ ...formState, verified: e.target.checked })}
                className="h-5 w-5 rounded border-[var(--color-border)] text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                id="verified"
              />
              <label htmlFor="verified" className="ml-2 block text-sm font-medium text-[var(--color-text)]">Verified</label>
            </div>
          </div>
          <div className="flex justify-end space-x-3 pt-4">
            <button type="button" onClick={() => setFormState(null)} className="px-4 py-2 border border-[var(--color-border)] rounded text-[var(--color-text)] hover:bg-[var(--color-surface-subtle)] transition">Cancel</button>
            <button type="submit" className="bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white px-4 py-2 rounded shadow transition font-semibold">Save Hospital</button>
          </div>
        </form>
      )}

      {selectedHospitalForBlood && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="blood-modal-title"
          className="bg-[var(--color-surface)] p-6 rounded-lg shadow-lg border border-[var(--color-border)] relative my-4"
        >
          <button
            onClick={() => setSelectedHospitalForBlood(null)}
            className="absolute top-4 right-4 p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] rounded text-sm font-semibold"
            aria-label="Close blood inventory modal"
          >
            ✕ Close
          </button>
          <h2 id="blood-modal-title" className="text-xl font-semibold mb-4 text-[var(--color-text)]">
            Inventory for {selectedHospitalForBlood.name}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {bloodInventory.map(row => (
              <form key={row.id} onSubmit={(e) => handleUpdateBlood(e, row)} className="border border-[var(--color-border)] rounded p-4 bg-[var(--color-surface-subtle)] shadow-sm">
                <h3 className={`font-bold text-lg mb-2 ${row.units_available === 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-heading)]'}`}>
                  {row.blood_group}
                </h3>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-[var(--color-text-muted)]">Blood</span>
                    <input name="units" type="number" defaultValue={row.units_available} min="0" className="w-20 p-1 border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] rounded text-right tabular-nums" />
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-[var(--color-text-muted)]">Platelets</span>
                    <input name="platelets" type="number" defaultValue={row.platelet_units} min="0" className="w-20 p-1 border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] rounded text-right tabular-nums" />
                  </div>
                </div>
                <button type="submit" className="mt-3 w-full bg-[var(--color-primary-light)] text-[var(--color-primary)] hover:bg-[var(--color-primary)] hover:text-white border border-[var(--color-primary)] py-1.5 rounded transition text-sm font-semibold min-h-[44px]">
                  Update
                </button>
              </form>
            ))}
          </div>
        </div>
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
            {hospitals.map(h => (
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
                  <button onClick={() => handleDelete(h.id)} className="text-[var(--color-text-muted)] hover:text-[var(--color-danger)] font-semibold px-2 py-1 rounded">Delete</button>
                </td>
              </tr>
            ))}
            {hospitals.length === 0 && (
              <tr><td colSpan={3} className="px-6 py-8 text-center text-[var(--color-text-muted)]">No hospitals found. Add one to get started.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
