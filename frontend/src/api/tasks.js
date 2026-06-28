import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from './client.js';

export const getTasks = () => apiGet('/api/tasks');
export const addTask = (item) => apiPost('/api/tasks', item);
export const updateTask = (id, updates) => apiPut(`/api/tasks/${id}`, updates);
export const removeTask = (id) => apiDelete(`/api/tasks/${id}`);
export const toggleTask = (id) => apiPatch(`/api/tasks/${id}/toggle`);
