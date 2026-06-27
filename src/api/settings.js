import { apiGet, apiPut } from './client.js';

export const getSettings = () => apiGet('/api/settings');
export const saveSettings = (settings) => apiPut('/api/settings', settings);
export const saveApiKey = (key, value) => apiPut('/api/settings/key', { key, value });
