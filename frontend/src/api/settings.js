import { apiGet, apiPut } from './client.js';

export const getSettings = () => apiGet('/api/settings');
export const saveSettings = (settings) => apiPut('/api/settings', settings);
