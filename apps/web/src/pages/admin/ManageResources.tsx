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
    handleUpdateBlood
  } = useManageResources();

  if (loading && hospitals.length === 0) return <div className="p-4">Loading...</div>;
  if (error) return <div className="p-4 text-red-600">{error}</div>;

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Manage Resources</h1>
        <button
          onClick={() => setFormState({ name: '', lat: 23.81, lng: 90.41, verified: true })}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow transition"
        >
          Add Hospital
        </button>
      </div>

      {formState && (
        <form onSubmit={handleSave} className="bg-white p-6 rounded-lg shadow-md space-y-4 border border-gray-100">
          <h2 className="text-xl font-semibold text-gray-800">{formState.id ? 'Edit' : 'Add'} Hospital</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                required
                value={formState.name || ''}
                onChange={e => setFormState({ ...formState, name: e.target.value })}
                className="w-full border rounded p-2 focus:ring focus:ring-blue-200 outline-none transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
              <input
                type="text"
                value={formState.address || ''}
                onChange={e => setFormState({ ...formState, address: e.target.value })}
                className="w-full border rounded p-2 focus:ring focus:ring-blue-200 outline-none transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Latitude</label>
              <input
                type="number"
                step="any"
                required
                value={formState.lat || ''}
                onChange={e => setFormState({ ...formState, lat: parseFloat(e.target.value) })}
                className="w-full border rounded p-2 focus:ring focus:ring-blue-200 outline-none transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Longitude</label>
              <input
                type="number"
                step="any"
                required
                value={formState.lng || ''}
                onChange={e => setFormState({ ...formState, lng: parseFloat(e.target.value) })}
                className="w-full border rounded p-2 focus:ring focus:ring-blue-200 outline-none transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="text"
                value={formState.phone || ''}
                onChange={e => setFormState({ ...formState, phone: e.target.value })}
                className="w-full border rounded p-2 focus:ring focus:ring-blue-200 outline-none transition"
              />
            </div>
            <div className="flex items-center pt-6">
              <input
                type="checkbox"
                checked={formState.verified ?? true}
                onChange={e => setFormState({ ...formState, verified: e.target.checked })}
                className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                id="verified"
              />
              <label htmlFor="verified" className="ml-2 block text-sm font-medium text-gray-700">Verified</label>
            </div>
          </div>
          <div className="flex justify-end space-x-3 pt-4">
            <button type="button" onClick={() => setFormState(null)} className="px-4 py-2 border rounded text-gray-700 hover:bg-gray-50 transition">Cancel</button>
            <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded shadow transition">Save Hospital</button>
          </div>
        </form>
      )}

      {selectedHospitalForBlood && (
        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-100 relative">
          <button
            onClick={() => setSelectedHospitalForBlood(null)}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-700"
          >
            ✕ Close
          </button>
          <h2 className="text-xl font-semibold mb-4 text-gray-800">Inventory for {selectedHospitalForBlood.name}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {bloodInventory.map(row => (
              <form key={row.id} onSubmit={(e) => handleUpdateBlood(e, row)} className="border rounded p-4 bg-gray-50 shadow-sm">
                <h3 className="font-bold text-lg text-red-600 mb-2">{row.blood_group}</h3>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Blood</span>
                    <input name="units" type="number" defaultValue={row.units_available} min="0" className="w-20 p-1 border rounded text-right" />
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">Platelets</span>
                    <input name="platelets" type="number" defaultValue={row.platelet_units} min="0" className="w-20 p-1 border rounded text-right" />
                  </div>
                </div>
                <button type="submit" className="mt-3 w-full bg-red-50 text-red-700 border border-red-200 py-1 rounded hover:bg-red-100 transition text-sm font-medium">Update</button>
              </form>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white shadow rounded-lg border overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Hospital</th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Contact</th>
              <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {hospitals.map(h => (
              <tr key={h.id} className="hover:bg-gray-50 transition">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="font-medium text-gray-900">{h.name}</div>
                  <div className="text-sm text-gray-500">{h.lat.toFixed(4)}, {h.lng.toFixed(4)}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">{h.phone || 'No phone'}</div>
                  <div className="text-sm text-gray-500 truncate max-w-xs">{h.address || 'No address'}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-3">
                  <button onClick={() => loadBloodInventory(h)} className="text-red-600 hover:text-red-900 font-semibold px-2 py-1 rounded hover:bg-red-50">Blood Inventory</button>
                  <button onClick={() => setFormState(h)} className="text-blue-600 hover:text-blue-900 font-semibold px-2 py-1 rounded hover:bg-blue-50">Edit</button>
                  <button onClick={() => handleDelete(h.id)} className="text-gray-500 hover:text-red-600 font-semibold px-2 py-1 rounded hover:bg-gray-100">Delete</button>
                </td>
              </tr>
            ))}
            {hospitals.length === 0 && (
              <tr><td colSpan={3} className="px-6 py-8 text-center text-gray-500">No hospitals found. Add one to get started.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
