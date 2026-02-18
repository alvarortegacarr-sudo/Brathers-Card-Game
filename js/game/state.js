// ==========================================
// GLOBAL STATE MANAGEMENT
// ==========================================

import { CARD_DISTRIBUTION } from './config.js';

export const state = {
    playerId: localStorage.getItem('playerId') || crypto.randomUUID(),
    currentRoom: null,
    currentPlayer: localStorage.getItem('currentPlayer'),
    roomId: null,
    players: [],
    myHand: [],
    isGameActive: false,
    currentPhase: 'waiting',
    myPosition: 0,
    triunfoCard: null,
    currentAttribute: null,
    cardsPerPlayer: 0,
    hasBidded: false,
    myTurnOrder: null,
    isStartingGame: false,
    subscriptions: {
        room: null,
        chat: null
    },
    heartbeatInterval: null
};

// Initialize playerId if new
if (!localStorage.getItem('playerId')) {
    localStorage.setItem('playerId', state.playerId);
}

export function updateCardsPerPlayer() {
    state.cardsPerPlayer = CARD_DISTRIBUTION[state.players.length] || 8;
}

export function resetGameState() {
    state.isGameActive = false;
    state.currentPhase = 'waiting';
    state.hasBidded = false;
    state.myHand = [];
    state.triunfoCard = null;
    state.currentAttribute = null;
    state.isStartingGame = false;
}