import type React from 'react';
import type { HospitalDto } from '@avash/types';
import { Spinner } from '@avash/ui';

interface HospitalFormModalProps {
  formState: Partial<HospitalDto>;
  isSaving: boolean;
  onSave: (e: React.FormEvent) => Promise<void>;
  onCancel: () => void;
  onChange: (updated: Partial<HospitalDto>) => void;
}

export function HospitalFormModal({
  formState,
  isSaving,
  onSave,
  onCancel,
  onChange,
}: HospitalFormModalProps) {
  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
      <form
        onSubmit={onSave}
        className="bg-[var(--color-surface)] p-6 rounded-xl shadow-2xl space-y-4 border border-[var(--color-border)] w-full max-w-2xl max-h-[90vh] overflow-y-auto my-auto"
      >
      <h2 className="text-xl font-semibold text-[var(--color-text)]">
        {formState.id ? 'Edit' : 'Add'} Hospital
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-muted)] mb-1">Name</label>
          <input
            type="text"
            required
            value={formState.name || ''}
            onChange={(e) => onChange({ ...formState, name: e.target.value })}
            className="w-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] rounded p-2 focus:ring focus:ring-[var(--color-primary)]/20 outline-none transition"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-muted)] mb-1">Address</label>
          <input
            type="text"
            value={formState.address || ''}
            onChange={(e) => onChange({ ...formState, address: e.target.value })}
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
            onChange={(e) => onChange({ ...formState, lat: e.target.value as unknown as number })}
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
            onChange={(e) => onChange({ ...formState, lng: e.target.value as unknown as number })}
            className="w-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] rounded p-2 focus:ring focus:ring-[var(--color-primary)]/20 outline-none transition"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-muted)] mb-1">Phone</label>
          <input
            type="text"
            value={formState.phone || ''}
            onChange={(e) => onChange({ ...formState, phone: e.target.value })}
            className="w-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] rounded p-2 focus:ring focus:ring-[var(--color-primary)]/20 outline-none transition"
          />
        </div>
        <div className="flex items-center pt-6">
          <input
            type="checkbox"
            checked={formState.verified ?? true}
            onChange={(e) => onChange({ ...formState, verified: e.target.checked })}
            className="h-5 w-5 rounded border-[var(--color-border)] text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
            id="verified"
          />
          <label htmlFor="verified" className="ml-2 block text-sm font-medium text-[var(--color-text)]">
            Verified
          </label>
        </div>
      </div>
      <div className="flex justify-end space-x-3 pt-4">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-[var(--color-border)] rounded text-[var(--color-text)] hover:bg-[var(--color-surface-subtle)] transition"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSaving}
          className="bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white px-4 py-2 rounded shadow transition font-semibold inline-flex items-center gap-2 disabled:opacity-50"
        >
          {isSaving && <Spinner label="Saving…" className="spinner--button" />}
          {isSaving ? 'Saving…' : 'Save Hospital'}
        </button>
      </div>
    </form>
  </div>
  );
}
