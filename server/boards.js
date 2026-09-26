// Runs one Tracker per distinct set of board settings, only while someone is watching.
// Users with identical settings share a board; boards stop ~2 minutes after their last viewer
// leaves, and an airport's timetable is shared by every board showing that airport.
import crypto from 'node:crypto';
import { Tracker } from './tracker.js';

const IDLE_MS = 2 * 60_000;

/** Stable key for settings that affect what a board shows. */
function boardKey(s) {
  const home = s.home ? [s.home.lat.toFixed(4), s.home.lon.toFixed(4)] : null;
  const view = s.mode === 'visible' ? s.view : null;
  return crypto.createHash('sha256').update(JSON.stringify([s.airport.icao, s.mode, home, view])).digest('hex');
}

export class BoardManager {
  /**
   * @param {object} base      shared settings (pollSeconds, searchRadiusNm, timezone, planespotters, ...)
   * @param {TimetableService} timetables
   */
  constructor(base, timetables) {
    this.base = base;
    this.timetables = timetables;
    this.boards = new Map();
    this.sweeper = setInterval(() => this.sweep(), 30_000);
    this.sweeper.unref();
  }

  /** The running board for these settings, started on first use. */
  async get(settings) {
    const key = boardKey(settings);
    let board = this.boards.get(key);
    if (!board) {
      const config = { ...this.base, ...settings };
      const tracker = new Tracker(config, this.timetables.forAirport(settings.airport));
      board = { key, tracker, airport: settings.airport.icao, lastUsed: Date.now() };
      this.boards.set(key, board);
      tracker.start();
      console.log(`[boards] started ${settings.airport.iata || settings.airport.icao} (${settings.mode}); ${this.boards.size} active`);
    }
    board.lastUsed = Date.now();
    await board.tracker.ready();
    return board.tracker;
  }

  sweep() {
    const now = Date.now();
    for (const [key, board] of this.boards) {
      if (now - board.lastUsed < IDLE_MS) continue;
      board.tracker.stop();
      this.boards.delete(key);
      if (![...this.boards.values()].some((b) => b.airport === board.airport)) this.timetables.release(board.airport);
      console.log(`[boards] stopped idle board; ${this.boards.size} active`);
    }
  }

  stats() {
    return { activeBoards: this.boards.size, airports: [...new Set([...this.boards.values()].map((b) => b.airport))] };
  }
}
