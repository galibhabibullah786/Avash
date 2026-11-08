import { useState, useEffect, useCallback } from 'react';
import { z } from 'zod';
import { fetchApi } from '../../lib/apiClient';
import { useSession } from '../auth/useSession';
import type { HospitalDto } from '@avash/types';
import { hospitalsResponseSchema, hospitalDtoSchema } from '@avash/types';

export interface BloodInventoryRow {
  id: number;
  blood_group: string;
  units_available: number;
  platelet_units: number;
}

export function useManageResources() {
  const { accessToken } = useSession();
  const [hospitals, setHospitals] = useState<HospitalDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formState, setFormState] = useState<Partial<HospitalDto> | null>(null);
  
  const [bloodInventory, setBloodInventory] = useState<BloodInventoryRow[]>([]);
  const [selectedHospitalForBlood, setSelectedHospitalForBlood] = useState<HospitalDto | null>(null);

  const loadHospitals = useCallback(async () => {
    setLoading(true);
    const res = await fetchApi(
      `/api/resources/hospitals?bbox=88,20,93,27&_t=${Date.now()}`,
      hospitalsResponseSchema,
      { accessToken: accessToken || undefined }
    );
    if (!res.ok) {
      setError(res.error);
    } else {
      setError(null);
      setHospitals(res.data.hospitals || []);
    }
    setLoading(false);
  }, [accessToken]);

  useEffect(() => {
    loadHospitals();
  }, [loadHospitals]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!formState) return;

    const trimmedName = formState.name?.trim() ?? '';
    if (!trimmedName) {
      alert('Please enter a valid hospital name');
      return;
    }
    
    const lat = Number(formState.lat);
    const lng = Number(formState.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      alert('Please enter valid numeric latitude (-90 to 90) and longitude (-180 to 180)');
      return;
    }

    const isEdit = !!formState.id;
    const method = isEdit ? 'PATCH' : 'POST';
    const path = isEdit ? `/api/resources/hospitals/${formState.id}` : '/api/resources/hospitals';
    
    const payload = {
      name: trimmedName,
      lat,
      lng,
      address: formState.address ? formState.address.trim() : null,
      phone: formState.phone ? formState.phone.trim() : null,
      verified: formState.verified ?? true,
    };

    const res = await fetchApi(path, hospitalDtoSchema, {
      method,
      body: payload,
      accessToken: accessToken || undefined,
    });

    if (!res.ok) {
      alert(res.error);
      return;
    }
    
    // Immediate state synchronization so UI updates without manual reload
    const saved = res.data;
    setHospitals((prev) => {
      const exists = prev.some((h) => h.id === saved.id);
      if (exists) {
        return prev.map((h) => (h.id === saved.id ? saved : h));
      }
      return [saved, ...prev];
    });

    setError(null);
    setFormState(null);
    loadHospitals();
  }

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this hospital?')) return;
    
    const res = await fetchApi(`/api/resources/hospitals/${id}`, z.any(), { 
      method: 'DELETE',
      accessToken: accessToken || undefined,
    });
    
    if (!res.ok) {
      alert(res.error);
      return;
    }
    setHospitals((prev) => prev.filter((h) => h.id !== id));
    if (selectedHospitalForBlood?.id === id) {
      setSelectedHospitalForBlood(null);
    }
    setError(null);
    loadHospitals();
  }

  async function loadBloodInventory(hospital: HospitalDto) {
    setSelectedHospitalForBlood(hospital);
    
    const res = await fetchApi(
      `/api/resources/hospitals/${hospital.id}/blood`, 
      z.object({ inventory: z.any() }),
      { accessToken: accessToken || undefined }
    );
    
    if (!res.ok) {
      alert(res.error);
      setSelectedHospitalForBlood(null);
      return;
    }
    
    setBloodInventory((res.data.inventory || []).sort((a: BloodInventoryRow, b: BloodInventoryRow) => a.blood_group.localeCompare(b.blood_group)));
  }

  async function handleUpdateBlood(e: React.FormEvent, row: BloodInventoryRow) {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    const rawUnits = formData.get('units') as string;
    const rawPlatelets = formData.get('platelets') as string;
    const units = parseInt(rawUnits, 10);
    const platelets = parseInt(rawPlatelets, 10);

    if (Number.isNaN(units) || units < 0 || units > 500) {
      alert('Please enter valid blood units (0 to 500)');
      return;
    }
    if (Number.isNaN(platelets) || platelets < 0 || platelets > 500) {
      alert('Please enter valid platelet units (0 to 500)');
      return;
    }
    
    const res = await fetchApi(`/api/resources/blood/${row.id}`, z.any(), {
      method: 'PATCH',
      body: { unitsAvailable: units, plateletUnits: platelets },
      accessToken: accessToken || undefined,
    });
    
    if (!res.ok) {
      alert(res.error);
      return;
    }
    
    setBloodInventory(prev => prev.map(item => item.id === row.id ? { ...item, units_available: units, platelet_units: platelets } : item));
  }

  return {
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
  };
}
