import { apiGet, apiPost, apiDelete } from './client.js';

export const getIngestActivity = (limit = 50) => apiGet(`/api/ingest/activity?limit=${limit}`);
export const runIngestNow = () => apiPost('/api/ingest/run');
export const rejectFact = (ref) => apiDelete(`/api/ingest/facts/${encodeURIComponent(ref)}`);
