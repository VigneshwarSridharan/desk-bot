import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from './client.js';

export const getReminders = () => apiGet('/api/reminders');
export const addReminder = (item) => apiPost('/api/reminders', item);
export const updateReminder = (id, updates) => apiPut(`/api/reminders/${id}`, updates);
export const removeReminder = (id) => apiDelete(`/api/reminders/${id}`);
export const toggleReminder = (id) => apiPatch(`/api/reminders/${id}/toggle`);
