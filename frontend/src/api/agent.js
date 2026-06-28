import { apiGet, apiPost } from './client.js';

export const triggerCycle = () => apiPost('/api/cycle');
export const getLatestDisplay = () => apiGet('/api/latest');
