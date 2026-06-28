import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import agentRoutes from './routes/agent.js';
import portfolioRoutes from './routes/portfolio.js';
import remindersRoutes from './routes/reminders.js';
import eventsRoutes from './routes/events.js';
import tasksRoutes from './routes/tasks.js';
import settingsRoutes from './routes/settings.js';
import { startScheduler } from './scheduler.js';

const app = express();
const PORT = process.env.PORT || 3001;

const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:5173',
  'http://localhost:5173',
  'http://localhost:4173',
];

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.use('/api', agentRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/reminders', remindersRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/settings', settingsRoutes);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`[server] Desk Bot backend running on http://localhost:${PORT}`);
  startScheduler();
});
