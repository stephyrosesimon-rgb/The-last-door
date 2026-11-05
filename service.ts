import { createHash, randomUUID } from 'node:crypto';
import { act, finish, makeGame, snapshot } from './engine.js';

// One room is one atomic record. No in-process room cache survives an invocation.
export interface RoomStore {
  getWithMetadata(key: string, options: { type: 'json'; consistency: 'strong' }): Promise<{ data: any; etag?: string } | null>;
  setJSON(key: string, value: any, options: { onlyIfNew: true; onlyIfMatch?: never } | { onlyIfMatch: string; onlyIfNew?: never }): Promise<{ modified: boolean }>;
}
type Body = Record<string, any>;
class GameError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const ROOM_NAMES = ['Foyer', 'Library', 'Conservatory', 'Workshop', 'Vault'];
const ACTIONS = ['start', 'pause', 'resume', 'move', 'inspect', 'hint', 'solve', 'chat', 'share'];
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private',
  'Netlify-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
} });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function requestID(b: Body) {
  if (typeof b.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(b.requestId)) throw new GameError('A valid request ID is required.');
  return b.requestId as string;
}
function player(name: unknown) {
  if (typeof name !== 'string' || !name.trim()) throw new GameError('Enter your name.');
  return { id: randomUUID(), token: randomUUID(), name: name.trim().slice(0, 20), location: 'Foyer',
    seals: [], score: 0, scoreAt: Date.now(), found: {}, hints: {}, cooldowns: {} };
}
function view(room: any, p: any) { return { ...snapshot(room, p), revision: room.revision, serverNow: Date.now() }; }
function authenticate(room: any, token: unknown) {
  if (typeof token !== 'string' || token.length > 100) throw new GameError('Session not found. Join again.', 401);
  const p = room.players.find((x: any) => x.token === token);
  if (!p) throw new GameError('Session not found. Join again.', 401);
  return p;
}
function validateAction(b: Body) {
  if (!ACTIONS.includes(b.action)) throw new GameError('Unknown action.');
  if (b.action === 'move' && !ROOM_NAMES.includes(b.location)) throw new GameError('Unknown room.');
  if (b.action === 'inspect' && (!Number.isInteger(b.object) || b.object < 0 || b.object > 20)) throw new GameError('Unknown object.');
  if (b.action === 'share' && !ROOM_NAMES.includes(b.room)) throw new GameError('Unknown seal.');
  if (b.action === 'solve' && (typeof b.answer !== 'string' || b.answer.length > 40)) throw new GameError('Enter a valid answer.');
  if (b.action === 'chat' && typeof b.text !== 'string') throw new GameError('Enter a message.');
}
async function createRoom(store: RoomStore, b: Body) {
  const id = requestID(b), p = player(b.name);
  // Deterministic code candidates make a lost creation response safely retryable.
  for (let attempt = 0; attempt < 12; attempt++) {
    const bytes = createHash('sha256').update(id + ':' + attempt).digest();
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const code = Array.from(bytes.subarray(0, 5), x => alphabet[x % alphabet.length]).join('');
    const key = 'rooms/' + code;
    const existing = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
    if (existing) {
      if (existing.data.creationId === id && existing.data.players[0].name === p.name) {
        return { code, token: existing.data.players[0].token };
      }
      continue;
    }
    const room = { code, creationId: id, revision: 1, status: 'lobby', host: p.id, players: [p],
      messages: [], game: makeGame(), requests: [], expiresAt: Date.now() + 86400000 };
    const result = await store.setJSON(key, room, { onlyIfNew: true });
    if (result.modified) return { code, token: p.token };
    // Another invocation may have created this exact request while we were waiting.
    const winner = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
    if (winner?.data.creationId === id && winner.data.players[0].name === p.name) return { code, token: winner.data.players[0].token };
  }
  throw new GameError('Could not reserve a room. Please try again.', 409);
}
async function transaction(store: RoomStore, b: Body) {
  const code = typeof b.code === 'string' ? b.code.trim().toUpperCase() : '';
  if (!/^[A-Z]{5}$/.test(code)) throw new GameError('Enter a five-letter room code.');
  const key = 'rooms/' + code, mutation = b.op !== 'state';
  const id = mutation ? requestID(b) : '';
  if (b.op === 'action') validateAction(b);
  const newPlayer = b.op === 'join' ? player(b.name) : null;
  const fingerprint = hash(b);
  for (let retry = 0; retry < 16; retry++) {
    const entry = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
    if (!entry || entry.data.expiresAt < Date.now()) throw new GameError('Room expired or not found. Create a new invitation.', 404);
    if (!entry.etag) throw new GameError('Room storage is unavailable. Please retry.', 503);
    const room = entry.data;
    const p = b.op === 'join' ? null : authenticate(room, b.token);
    const prior = mutation && room.requests.find((x: any) => x.id === id);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new GameError('This request ID was already used for another action.', 409);
      return b.op === 'join' ? { code, token: room.players.find((x: any) => x.id === prior.playerId).token } : { ok: true, state: view(room, p) };
    }
    const oldStatus = room.status;
    finish(room);
    if (oldStatus !== room.status) {
      // Expiry is committed before accepting any further operation, even on read-only polling.
      room.revision++;
      if (!(await store.setJSON(key, room, { onlyIfMatch: entry.etag })).modified) { await sleep(5 + retry * 5); continue; }
      if (b.op === 'state') return view(room, p);
      throw new GameError('The match has ended.');
    }
    if (b.op === 'state') return view(room, p);
    if (b.op === 'join') {
      if (room.status !== 'lobby') throw new GameError('This match has already started.');
      if (room.players.length >= 8) throw new GameError('Room is full.');
      room.players.push(newPlayer);
    } else {
      if (b.expectedLocation && b.expectedLocation !== p.location) throw new GameError('Your room changed. Please try again in the current room.');
      const oldScore = p.score;
      try { act(room, p, b); } catch (error) { throw new GameError((error as Error).message); }
      if (p.score !== oldScore) {
        // A deterministic tie-break even when two updates arrive within the same millisecond.
        p.scoreAt = Math.max(Date.now(), (room.lastScoreAt || 0) + 1); room.lastScoreAt = p.scoreAt;
      }
    }
    room.revision++;
    room.requests.push({ id, fingerprint, playerId: (newPlayer || p).id });
    // A bounded per-room receipt log prevents retries from duplicating recent actions.
    room.requests = room.requests.slice(-1024);
    const committed = await store.setJSON(key, room, { onlyIfMatch: entry.etag });
    if (committed.modified) return b.op === 'join' ? { code, token: newPlayer!.token } : { ok: true, state: view(room, p) };
    // Re-read and re-apply against the latest room. Never overwrite a conflicting winner/score.
    await sleep(5 + retry * 5 + Math.floor(Math.random() * 10));
  }
  throw new GameError('The room is busy. Please try again.', 409);
}
export async function handleGame(request: Request, store: RoomStore): Promise<Response> {
  try {
    if (request.method !== 'POST') return reply({ error: 'Use POST for game operations.' }, 405);
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return reply({ error: 'Cross-origin game requests are not allowed.' }, 403);
    if (!request.headers.get('content-type')?.includes('application/json')) throw new GameError('Send JSON.', 415);
    if (Number(request.headers.get('content-length') || 0) > 12000) throw new GameError('Request too large.', 413);
    const text = await request.text();
    if (text.length > 12000) throw new GameError('Request too large.', 413);
    let b: Body;
    try { b = JSON.parse(text); } catch { throw new GameError('Invalid JSON.'); }
    if (!b || Array.isArray(b) || typeof b !== 'object') throw new GameError('Invalid request.');
    if (!['create', 'join', 'state', 'action'].includes(b.op)) throw new GameError('Unknown operation.');
    return reply(b.op === 'create' ? await createRoom(store, b) : await transaction(store, b));
  } catch (error) {
    if (error instanceof GameError) return reply({ error: error.message }, error.status);
    console.error('Game storage request failed', error instanceof Error ? error.name : 'UnknownError');
    return reply({ error: 'Game storage is temporarily unavailable. Please retry.' }, 503);
  }
}

