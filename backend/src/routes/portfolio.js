import { Router } from 'express';
import {
  getPortfolio, addPortfolioItem, removePortfolioItem, updatePortfolioItem,
} from '../store/db.js';

const router = Router();

router.get('/', (req, res) => res.json(getPortfolio()));

router.post('/holding', (req, res) => {
  const id = addPortfolioItem({ ...req.body, watchlistOnly: false });
  res.json({ id });
});

router.put('/holding/:id', (req, res) => {
  updatePortfolioItem(req.params.id, req.body);
  res.json({ ok: true });
});

router.delete('/holding/:id', (req, res) => {
  removePortfolioItem(req.params.id);
  res.json({ ok: true });
});

router.post('/watchlist', (req, res) => {
  const id = addPortfolioItem({ ...req.body, watchlistOnly: true });
  res.json({ id });
});

router.delete('/watchlist/:id', (req, res) => {
  removePortfolioItem(req.params.id);
  res.json({ ok: true });
});

export default router;
