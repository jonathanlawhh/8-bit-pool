/**
 * Browser localStorage persistence for turn action history, saved matches, and AI config.
 */

import { DEFAULT_AI_CONFIG } from './ai.js';

const KEY_ACTIVE_MATCH = 'neon8ball_active_match_v1';
const KEY_SAVED_MATCHES = 'neon8ball_saved_matches_v1';
const KEY_AI_CONFIG = 'neon8ball_ai_config_v1';
const MAX_SAVED_MATCHES = 30;

function safeGet(key) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function createMatchRecord(gameState, balls, turnHistory = [], id = null) {
  return {
    id: id || `match_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    modeId: gameState.modeId || 'standard',
    opponentType: gameState.opponentType || 'human',
    gameState: { ...gameState, groups: { ...gameState.groups } },
    balls: balls.map((b) => ({
      id: b.id,
      type: b.type,
      x: Number(b.x.toFixed(3)),
      y: Number(b.y.toFixed(3)),
      pocketed: b.pocketed,
      pocketId: b.pocketId,
    })),
    turnHistory,
  };
}

export function saveActiveMatch(record) {
  record.updatedAt = new Date().toISOString();
  safeSet(KEY_ACTIVE_MATCH, record);
  // Also upsert into saved matches list once at least 1 turn has been played
  if (record.turnHistory && record.turnHistory.length > 0) {
    upsertSavedMatch(record);
  }
}

export function loadActiveMatch() {
  return safeGet(KEY_ACTIVE_MATCH);
}

export function listSavedMatches() {
  const list = safeGet(KEY_SAVED_MATCHES);
  return Array.isArray(list) ? list : [];
}

export function upsertSavedMatch(record) {
  const list = listSavedMatches();
  const idx = list.findIndex((m) => m.id === record.id);
  const compact = {
    ...record,
    updatedAt: new Date().toISOString(),
  };
  if (idx >= 0) {
    list[idx] = compact;
  } else {
    list.unshift(compact);
  }
  const trimmed = list.slice(0, MAX_SAVED_MATCHES);
  safeSet(KEY_SAVED_MATCHES, trimmed);
  return trimmed;
}

export function deleteSavedMatch(matchId) {
  const list = listSavedMatches().filter((m) => m.id !== matchId);
  safeSet(KEY_SAVED_MATCHES, list);
  return list;
}

export function clearAllSavedMatches() {
  safeSet(KEY_SAVED_MATCHES, []);
}

export function saveAIConfig(config) {
  safeSet(KEY_AI_CONFIG, { ...DEFAULT_AI_CONFIG, ...config });
}

export function loadAIConfig() {
  const saved = safeGet(KEY_AI_CONFIG);
  return saved ? { ...DEFAULT_AI_CONFIG, ...saved } : { ...DEFAULT_AI_CONFIG };
}
