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
      '/api/resources/hospitals?bbox=88,20,93,27',
      hospitalsResponseSchema,
      { accessToken: accessToken || undefined }
    );
    if (!res.ok) {
      setError(res.error);
    } else {
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
    
    const isEdit = !!formState.id;
    const method = isEdit ? 'PATCH' : 'POST';
    const path = isEdit ? `/api/resources/hospitals/${formState.id}` : '/api/resources/hospitals';
    
    const payload = {
      name: formState.name,
      lat: Number(formState.lat),
      lng: Number(formState.lng),
      address: formState.address || null,
      phone: formState.phone || null,
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
    const units = parseInt(formData.get('units') as string, 10);
    const platelets = parseInt(formData.get('platelets') as string, 10);
    
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
    handleUpdateBlood
  };
}
