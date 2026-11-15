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

const PAGE_SIZE = 10;

export function useManageResources() {
  const { accessToken } = useSession();
  const [hospitals, setHospitals] = useState<HospitalDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formState, setFormState] = useState<Partial<HospitalDto> | null>(null);
  const [bloodInventory, setBloodInventory] = useState<BloodInventoryRow[]>([]);
  const [selectedHospitalForBlood, setSelectedHospitalForBlood] = useState<HospitalDto | null>(null);

  // CRUD operation loading state trackers
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [updatingBlood, setUpdatingBlood] = useState(false);
  const [loadingBlood, setLoadingBlood] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const loadHospitals = useCallback(async () => {
    setLoading(true);
    let res = await fetchApi(
      `/api/resources/hospitals?all=true&_t=${Date.now()}`,
      hospitalsResponseSchema,
      { accessToken: accessToken || undefined }
    );
    if (!res.ok) {
      res = await fetchApi(
        `/api/resources/hospitals?bbox=88,20,93,27&_t=${Date.now()}`,
        hospitalsResponseSchema,
        { accessToken: accessToken || undefined }
      );
    }
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

    setIsSaving(true);
    const isEdit = Boolean(formState.id);
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

    setIsSaving(false);
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
  }

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this hospital?')) return;
    
    setDeletingId(id);
    const res = await fetchApi(`/api/resources/hospitals/${id}`, z.any(), { 
      method: 'DELETE',
      accessToken: accessToken || undefined,
    });
    setDeletingId(null);
    
    if (!res.ok) {
      alert(res.error);
      return;
    }
    setHospitals((prev) => {
      const next = prev.filter((h) => h.id !== id);
      const nextTotalPages = Math.max(1, Math.ceil(next.length / pageSize));
      if (currentPage > nextTotalPages) {
        setCurrentPage(nextTotalPages);
      }
      return next;
    });
    if (selectedHospitalForBlood?.id === id) {
      setSelectedHospitalForBlood(null);
    }
    setError(null);
  }

  async function loadBloodInventory(hospital: HospitalDto) {
    setSelectedHospitalForBlood(hospital);
    setLoadingBlood(true);
    
    const res = await fetchApi(
      `/api/resources/hospitals/${hospital.id}/blood`, 
      z.object({ inventory: z.any() }),
      { accessToken: accessToken || undefined }
    );
    setLoadingBlood(false);
    
    if (!res.ok) {
      alert(res.error);
      setSelectedHospitalForBlood(null);
      return;
    }
    
    const rows = (res.data.inventory || []) as BloodInventoryRow[];
    setBloodInventory(rows.sort((a, b) => a.blood_group.localeCompare(b.blood_group)));
  }

  async function handleUpdateAllBlood(
    items: Array<{ bloodGroup: string; unitsAvailable: number; plateletUnits: number }>
  ) {
    if (!selectedHospitalForBlood) return;
    setUpdatingBlood(true);

    const res = await fetchApi(
      `/api/resources/hospitals/${selectedHospitalForBlood.id}/blood`,
      z.object({ inventory: z.any() }),
      {
        method: 'PUT',
        body: { items },
        accessToken: accessToken || undefined,
      }
    );
    setUpdatingBlood(false);

    if (!res.ok) {
      alert(res.error);
      return;
    }

    const rows = (res.data.inventory || []) as BloodInventoryRow[];
    setBloodInventory(rows.sort((a, b) => a.blood_group.localeCompare(b.blood_group)));
  }

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(hospitals.length / pageSize));
  const paginatedHospitals = hospitals.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  return {
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
    // Pagination & Loading controls
    isSaving,
    deletingId,
    updatingBlood,
    updatingBloodId: null,
    loadingBlood,
    currentPage,
    totalPages,
    pageSize,
    setPageSize,
    totalCount: hospitals.length,
    setCurrentPage,
  };
}
