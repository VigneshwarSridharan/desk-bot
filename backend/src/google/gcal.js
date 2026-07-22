// Google Calendar sync per ENGINEERING.md §3.3 / PRD F3.
//
// Runs on the ingestion schedule (not the display cycle). Pulls `now … +7d`
// per connected account and upserts into `events` with source:'gcal'.
// Deletions in Google are reconciled by re-listing the window each run.
// Calendar is authoritative: a matching email-derived event (same title,
// date within ±1h) is dropped in favor of the gcal row.
//
// `sourceRef` is stored as `${accountId}:${googleEventId}` — the `events`
// table has no accountId column, so this keeps reconciliation scoped to the
// account being synced without touching another account's rows.

import axios from 'axios';
import crypto from 'node:crypto';
import db from '../store/db.js';
import { getAccessToken } from './auth.js';

const CALENDAR_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const SYNC_WINDOW_DAYS = 7;
const DEDUP_WINDOW_MS = 60 * 60 * 1000;

function windowRange() {
  const timeMin = new Date();
  const timeMax = new Date(timeMin.getTime() + SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return { timeMin, timeMax };
}

function parseGoogleEvent(event) {
  const allDay = !!event.start?.date;
  const date = allDay ? event.start.date : event.start.dateTime.slice(0, 10);
  const time = allDay ? null : event.start.dateTime.slice(11, 16);
  return {
    title: event.summary || '(untitled event)',
    date,
    time,
    description: event.description || '',
  };
}

function toEpoch(date, time) {
  return new Date(`${date}T${time || '00:00'}:00`).getTime();
}

// Calendar wins: drop any email-extracted event that matches this gcal event
// by title and falls within the dedup window, so the two never coexist.
function dropConflictingEmailEvents(title, date, time) {
  const target = toEpoch(date, time);
  const candidates = db.prepare(`
    SELECT id, date, time FROM events
    WHERE source = 'email' AND lower(trim(title)) = lower(trim(?))
      AND date BETWEEN date(?, '-1 day') AND date(?, '+1 day')
  `).all(title, date, date);
  for (const candidate of candidates) {
    if (Math.abs(toEpoch(candidate.date, candidate.time) - target) <= DEDUP_WINDOW_MS) {
      db.prepare('DELETE FROM events WHERE id = ?').run(candidate.id);
    }
  }
}

async function fetchGoogleEvents(accessToken, timeMin, timeMax) {
  const { data } = await axios.get(CALENDAR_EVENTS_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    },
  });
  return data.items || [];
}

function upsertGcalEvent(sourceRef, { title, date, time, description }) {
  const existing = db.prepare('SELECT id FROM events WHERE sourceRef = ?').get(sourceRef);
  if (existing) {
    db.prepare(`
      UPDATE events SET title = ?, date = ?, time = ?, description = ? WHERE id = ?
    `).run(title, date, time, description, existing.id);
  } else {
    db.prepare(`
      INSERT INTO events (id, title, date, time, description, type, source, sourceRef)
      VALUES (?, ?, ?, ?, ?, 'event', 'gcal', ?)
    `).run(crypto.randomUUID(), title, date, time, description, sourceRef);
  }
}

/** Syncs one connected account's calendar. Returns a summary of the run. */
export async function syncAccountCalendar(accountId) {
  const accessToken = await getAccessToken(accountId);
  const { timeMin, timeMax } = windowRange();
  const googleEvents = await fetchGoogleEvents(accessToken, timeMin, timeMax);

  const seenRefs = new Set();
  for (const gEvent of googleEvents) {
    if (gEvent.status === 'cancelled' || !gEvent.id) continue;
    const sourceRef = `${accountId}:${gEvent.id}`;
    seenRefs.add(sourceRef);
    const parsed = parseGoogleEvent(gEvent);
    dropConflictingEmailEvents(parsed.title, parsed.date, parsed.time);
    upsertGcalEvent(sourceRef, parsed);
  }

  const staleRows = db.prepare(`
    SELECT id, sourceRef FROM events
    WHERE source = 'gcal' AND sourceRef LIKE ? AND date >= ? AND date <= ?
  `).all(`${accountId}:%`, timeMin.toISOString().slice(0, 10), timeMax.toISOString().slice(0, 10));
  let removed = 0;
  for (const row of staleRows) {
    if (!seenRefs.has(row.sourceRef)) {
      db.prepare('DELETE FROM events WHERE id = ?').run(row.id);
      removed += 1;
    }
  }

  return { accountId, synced: googleEvents.length, removed };
}

/** Syncs every connected account's calendar; one account's failure never blocks the others. */
export async function syncAllCalendars() {
  const accounts = db.prepare("SELECT id FROM mail_accounts WHERE status = 'connected'").all();
  const results = [];
  for (const { id } of accounts) {
    try {
      results.push(await syncAccountCalendar(id));
    } catch (err) {
      console.error(`[gcal] sync failed for account ${id}: ${err.message}`);
      results.push({ accountId: id, error: err.message });
    }
  }
  return results;
}
