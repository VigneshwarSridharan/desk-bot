import { apiGet, apiPut, apiDelete } from './client.js';

export const getConnections = () => apiGet('/api/connections');
export const startGoogleConnect = (label) =>
  apiGet(`/api/connections/google/start${label ? `?label=${encodeURIComponent(label)}` : ''}`);
export const disconnectAccount = (id, purge) =>
  apiDelete(`/api/connections/${id}${purge ? '?purge=true' : ''}`);
export const getAllowlist = (id) => apiGet(`/api/connections/${id}/allowlist`);
export const saveAllowlist = (id, entries) => apiPut(`/api/connections/${id}/allowlist`, { entries });
