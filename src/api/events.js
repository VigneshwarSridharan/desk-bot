import { apiGet, apiPost, apiPut, apiDelete } from './client.js';

export const getEvents = () => apiGet('/api/events');
export const addEvent = (item) => apiPost('/api/events', item);
export const updateEvent = (id, updates) => apiPut(`/api/events/${id}`, updates);
export const removeEvent = (id) => apiDelete(`/api/events/${id}`);
