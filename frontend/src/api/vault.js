import { apiGet, apiPut, apiDelete } from './client.js';

export const getVault = () => apiGet('/api/vault');
export const saveVault = (fields) => apiPut('/api/vault', fields);
export const deleteVault = () => apiDelete('/api/vault', { confirm: 'DELETE' });
