import { apiGet, apiPost, apiPut, apiDelete } from './client.js';

export const getPortfolio = () => apiGet('/api/portfolio');
export const addHolding = (item) => apiPost('/api/portfolio/holding', item);
export const updateHolding = (id, updates) => apiPut(`/api/portfolio/holding/${id}`, updates);
export const removeHolding = (id) => apiDelete(`/api/portfolio/holding/${id}`);
export const addToWatchlist = (item) => apiPost('/api/portfolio/watchlist', item);
export const removeFromWatchlist = (id) => apiDelete(`/api/portfolio/watchlist/${id}`);
