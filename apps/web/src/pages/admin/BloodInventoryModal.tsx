import { useState, useEffect, type FormEvent } from 'react';
import { Spinner } from '@avash/ui';
import type { BloodInventoryRow } from '../../features/resources/useManageResources';

const ALL_BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

interface BloodGroupState {
  units: number;
  platelets: number;
}

interface BloodInventoryModalProps {
  hospital: { id: string; name: string };
  bloodInventory: BloodInventoryRow[];
  loadingBlood: boolean;
  updatingBlood: boolean;
  onClose: () => void;
  onUpdateAllBlood: (
    items: Array<{ bloodGroup: string; unitsAvailable: number; plateletUnits: number }>
  ) => Promise<void>;
}

export function BloodInventoryModal({
  hospital,
  bloodInventory,
  loadingBlood,
  updatingBlood,
  onClose,
  onUpdateAllBlood,
}: BloodInventoryModalProps) {
  const [formData, setFormData] = useState<Record<string, BloodGroupState>>(() => {
    const initial: Record<string, BloodGroupState> = {};
    for (const bg of ALL_BLOOD_GROUPS) {
      const found = bloodInventory.find((r) => r.blood_group === bg);
      initial[bg] = {
        units: found?.units_available ?? 0,
        platelets: found?.platelet_units ?? 0,
      };
    }
    return initial;
  });

  useEffect(() => {
    setFormData((prev) => {
      const next = { ...prev };
      for (const bg of ALL_BLOOD_GROUPS) {
        const found = bloodInventory.find((r) => r.blood_group === bg);
        if (found) {
          next[bg] = {
            units: found.units_available,
            platelets: found.platelet_units,
          };
        }
      }
      return next;
    });
  }, [bloodInventory]);

  const handleChange = (bg: string, field: 'units' | 'platelets', value: string) => {
    const num = parseInt(value, 10);
    const safeNum = Number.isNaN(num) || num < 0 ? 0 : Math.min(num, 500);
    setFormData((prev) => ({
      ...prev,
      [bg]: {
        ...(prev[bg] ?? { units: 0, platelets: 0 }),
        [field]: safeNum,
      },
    }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const items = ALL_BLOOD_GROUPS.map((bg) => ({
      bloodGroup: bg,
      unitsAvailable: formData[bg]?.units ?? 0,
      plateletUnits: formData[bg]?.platelets ?? 0,
    }));
    await onUpdateAllBlood(items);
  };

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="blood-modal-title"
        className="bg-[var(--color-surface)] p-6 rounded-xl shadow-2xl border border-[var(--color-border)] relative w-full max-w-4xl max-h-[90vh] overflow-y-auto my-auto"
      >
      <button
        onClick={onClose}
        disabled={updatingBlood}
        className="absolute top-4 right-4 p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] rounded text-sm font-semibold"
        aria-label="Close blood inventory modal"
      >
        ✕ Close
      </button>

      <div className="mb-4 pr-16">
        <h2 id="blood-modal-title" className="text-xl font-semibold text-[var(--color-text)]">
          Inventory for {hospital.name}
        </h2>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          Update blood and platelet supplies across all 8 blood groups below.
        </p>
      </div>

      {loadingBlood && (
        <div className="p-4 flex items-center justify-center gap-2 text-sm text-[var(--color-text-muted)]">
          <Spinner label="Loading blood inventory…" />
          <span>Loading blood inventory…</span>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {ALL_BLOOD_GROUPS.map((bg) => {
            const current = formData[bg] ?? { units: 0, platelets: 0 };
            return (
              <div
                key={bg}
                className="border border-[var(--color-border)] rounded-lg p-4 bg-[var(--color-surface-subtle)] shadow-sm flex flex-col justify-between"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bold text-lg text-[var(--color-heading)] px-2.5 py-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)]">
                    {bg}
                  </span>
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded ${
                      current.units === 0
                        ? 'bg-[var(--color-danger-light)] text-[var(--color-danger)]'
                        : current.units <= 2
                        ? 'bg-[var(--color-warning-light)] text-[var(--color-warning)]'
                        : 'bg-[var(--color-safe-light)] text-[var(--color-safe)]'
                    }`}
                  >
                    {current.units === 0 ? 'মজুদ শূন্য' : current.units <= 2 ? 'স্বল্প' : 'পর্যাপ্ত'}
                  </span>
                </div>

                <div className="space-y-3">
                  <label className="flex justify-between items-center text-sm text-[var(--color-text)]">
                    <span className="text-[var(--color-text-muted)] font-medium">রক্ত (ব্যাগ):</span>
                    <input
                      name={`units_${bg}`}
                      type="number"
                      min="0"
                      max="500"
                      value={current.units}
                      onChange={(e) => handleChange(bg, 'units', e.target.value)}
                      className="w-24 px-2 py-1 border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] rounded text-right tabular-nums focus:ring-1 focus:ring-[var(--color-primary)] outline-none"
                      aria-label={`${bg} Blood Units`}
                    />
                  </label>

                  <label className="flex justify-between items-center text-sm text-[var(--color-text)]">
                    <span className="text-[var(--color-text-muted)] font-medium">প্লাটিলেট (ব্যাগ):</span>
                    <input
                      name={`platelets_${bg}`}
                      type="number"
                      min="0"
                      max="500"
                      value={current.platelets}
                      onChange={(e) => handleChange(bg, 'platelets', e.target.value)}
                      className="w-24 px-2 py-1 border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] rounded text-right tabular-nums focus:ring-1 focus:ring-[var(--color-primary)] outline-none"
                      aria-label={`${bg} Platelet Units`}
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex flex-col sm:flex-row items-center justify-end gap-3 pt-4 border-t border-[var(--color-border)]">
          <button
            type="button"
            onClick={onClose}
            disabled={updatingBlood}
            className="w-full sm:w-auto px-5 py-2.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-subtle)] font-medium text-sm transition min-h-[44px]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={updatingBlood || loadingBlood}
            data-testid="update-all-blood-btn"
            className="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-[var(--color-primary)] text-white hover:opacity-90 font-semibold text-sm transition min-h-[44px] inline-flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
          >
            {updatingBlood && <Spinner label="Updating…" className="spinner--button" />}
            {updatingBlood ? 'Updating Inventory…' : 'Update Blood Inventory'}
          </button>
        </div>
      </form>
    </div>
  </div>
  );
}
