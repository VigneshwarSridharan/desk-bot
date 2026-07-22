import { apiGet, apiPatch } from './client.js';

export const getBills = () => apiGet('/api/bills');
export const markBillPaid = (id) => apiPatch(`/api/bills/${id}`, { status: 'paid' });
export const updateBill = (id, updates) => apiPatch(`/api/bills/${id}`, updates);
