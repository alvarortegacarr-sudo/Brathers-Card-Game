// ==========================================
// MAIN INITIALIZATION AND EVENT HANDLERS
// ==========================================

import { state, updateCardsPerPlayer, resetGameState } from './state.js';
import * as db from './supabase.js';
import * as ui from './ui.js';
import { submitBid } from './bidding.js';
import { selectAttribute, playCard } from './playing.js';
import { endSet } from './scoring.js';

// Make functions available globally for HTML onclick handlers
window.submitBid = submitBid;
window.selectAttribute = selectAttribute;
window.playCard = playCard;
window.startNewSet = startNewSet;
window.copyCode = copyCode;
window.leaveGame = leaveGame;
window.sendChatMessage = sendChatMessage;

export async function initGame() {
    const roomCode = localStorage.getItem('currentRoom');
    state.currentPlayer = localStorage.getItem('currentPlayer');
    
    if (!roomCode) {
        redirectToLobby('No room code found');
        return;
    }

    try {
        console.log('Initializing game...');
        const room = await db.fetchRoom(roomCode);
        
        if (room.status === 'ended') {
            redirectToLobby(`Game ended: ${room.ended_reason || 'Unknown reason'}`);
            return;
        }

        state.currentRoom = room;
        state.roomId = room.id;
        state.players = room.players || [];
        updateCardsPerPlayer();
        state.isGameActive = room.status === 'playing';
        
        setupUI();
        setupChatInput();
        await updatePlayerList();
        setupRealtimeSubscription();
        setupChatSubscription();
        await loadChatHistory();
        startHeartbeat();
        
        if (room.status === 'playing') {
            state.currentPhase = room.phase || 'bidding';
            await loadGameState();
        }
        
        addLog('Connected to El Triunfo');
        addChatMessage('System', '🎴 Welcome to El Triunfo!');
        
    } catch (err) {
        console.error('Initialization error:', err);
        redirectToLobby('Failed to initialize game');
    }
}

function setupUI() {
    const roomCode = localStorage.getItem('currentRoom');
    document.getElementById('displayCode').textContent = `ROOM: ${roomCode}`;
    updateHostControls();
}

export function updateHostControls() {
    const hostControls = document.getElementById('hostControls');
    if (!hostControls) return;
    
    const isHost = localStorage.getItem('isHost') === 'true';
    
    console.log('Updating host controls:', {
        isHost,
        isGameActive: state.isGameActive,
        isStartingGame: state.isStartingGame,
        roomStatus: state.currentRoom?.status
    });
    
    // Force hide if game is active
    if (state.isGameActive || state.isStartingGame || state.currentRoom?.status === 'playing') {
        hostControls.style.display = 'none';
        return;
    }
    
    if (isHost) {
        hostControls.style.display = 'block';
        const count = state.players.length || 1;
        hostControls.innerHTML = `
            <button onclick="startNewSet()" class="btn-start" ${state.isStartingGame ? 'disabled' : ''}>
                ${state.isStartingGame ? '⏳ Starting...' : `🚀 Start Game (${count} player${count !== 1 ? 's' : ''})`}
            </button>
        `;
    } else {
        hostControls.style.display = 'none';
    }
}

async function startNewSet() {
    if (state.isStartingGame) return;
    if (state.players.length < 2) {
        alert('Need at least 2 players to start!');
        return;
    }

    console.log('Starting new set...');
    state.isStartingGame = true;
    updateHostControls();
    
    // Hide immediately
    const hostControls = document.getElementById('hostControls');
    if (hostControls) hostControls.style.display = 'none';

    try {
        // Cleanup
        await db.cleanupGameData();
        await db.resetPlayerStats();
        
        // Create turn order
        const shuffledPlayers = [...state.players].sort(() => Math.random() - 0.5);
        await db.createTurnOrder(shuffledPlayers);
        
        // Pick triunfo
        const { data: allCards } = await supabaseClient.from('cards').select('*');
        const randomCard = allCards[Math.floor(Math.random() * allCards.length)];
        state.triunfoCard = randomCard;
        
        // Deal cards
        await dealCards(allCards, shuffledPlayers);
        
        // Start game with triunfo phase
        await db.updateRoom({
            status: 'playing',
            phase: 'triunfo',
            current_set: (state.currentRoom.current_set || 0) + 1,
            current_turn: 0,
            triunfo_card_id: randomCard.id,
            current_attribute: null,
            current_round_starter: 0
        });
        
        state.isGameActive = true;
        state.currentPhase = 'triunfo';
        state.currentRoom.status = 'playing';
        
        addChatMessage('System', `🎴 Set ${(state.currentRoom.current_set || 0) + 1} started!`);
        addChatMessage('System', `👑 El Triunfo is ${randomCard.name}!`);
        
        // Transition to bidding after delay
        setTimeout(async () => {
            await db.updateRoom({ phase: 'bidding' });
            state.isStartingGame = false;
        }, 2000);
        
    } catch (err) {
        console.error('Start game error:', err);
        state.isStartingGame = false;
        state.isGameActive = false;
        updateHostControls();
        alert('Failed to start game');
    }
}

async function dealCards(allCards, shuffledPlayers) {
    const shuffled = [...allCards].sort(() => Math.random() - 0.5);
    updateCardsPerPlayer();
    
    let cardIndex = 0;
    for (const player of shuffledPlayers) {
        const playerCards = shuffled.slice(cardIndex, cardIndex + state.cardsPerPlayer);
        cardIndex += state.cardsPerPlayer;
        await db.dealCardsToPlayer(player.id, playerCards);
    }
    
    // Load my hand
    await loadMyHand();
    addChatMessage('System', `📦 ${state.cardsPerPlayer} cards dealt!`);
}

async function loadMyHand() {
    try {
        const hand = await db.fetchMyHand();
        const unplayed = hand.filter(h => !h.played);
        state.myHand = unplayed.map(h => ({ 
            ...h.cards, 
            hand_id: h.id, 
            hand_record_id: h.id 
        }));
        ui.renderHand(state.myHand);
    } catch (err) {
        console.error('Load hand error:', err);
    }
}

async function loadGameState() {
    try {
        const room = await db.fetchRoom(state.currentRoom.code);
        state.currentPhase = room.phase;
        state.triunfoCard = room.triunfo;
        state.currentAttribute = room.current_attribute;
        state.currentRoom = room;
        
        const turnOrder = await db.fetchTurnOrder();
        const myEntry = turnOrder.find(t => t.player_id === state.playerId);
        state.myPosition = myEntry ? myEntry.position : 0;
        
        const me = state.players.find(p => p.id === state.playerId);
        state.hasBidded = me?.has_bid || false;
        
        await loadMyHand();
        ui.updateGameUI();
    } catch (err) {
        console.error('Load game state error:', err);
    }
}

async function updatePlayerList() {
    try {
        state.players = await db.fetchPlayers();
        ui.updateSeats();
        ui.updatePlayerListUI();
        ui.updateScoreboard();
        updateCardsPerPlayer();
    } catch (err) {
        console.error('Update player list error:', err);
    }
}

function setupRealtimeSubscription() {
    state.subscriptions.room = supabaseClient
        .channel(`room:${state.roomId}`)
        .on('postgres_changes', 
            { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${state.roomId}` },
            async (payload) => {
                console.log('Player update:', payload.eventType, payload.new);
                
                if (payload.eventType === 'UPDATE') {
                    const idx = state.players.findIndex(p => p.id === payload.new.id);
                    if (idx >= 0) state.players[idx] = payload.new;
                    
                    if (payload.new.id === state.playerId) {
                        state.hasBidded = payload.new.has_bid;
                        if (state.currentPhase === 'bidding') {
                            ui.renderHand(state.myHand);
                        }
                    }
                } else if (payload.eventType === 'INSERT') {
                    state.players.push(payload.new);
                } else if (payload.eventType === 'DELETE') {
                    state.players = state.players.filter(p => p.id !== payload.old.id);
                }
                
                await updatePlayerList();
                
                if (payload.eventType === 'INSERT') {
                    addChatMessage('System', `${payload.new.name} joined`);
                } else if (payload.eventType === 'DELETE') {
                    addChatMessage('System', `${payload.old?.name || 'A player'} left`);
                }
                
                updateHostControls();
            }
        )
        .on('postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${state.roomId}` },
            async (payload) => {
                console.log('Room update:', payload.new.phase, '<-', payload.old.phase);
                
                state.currentRoom = payload.new;
                state.currentPhase = payload.new.phase;
                state.currentAttribute = payload.new.current_attribute;
                
                // Update game active status
                if (payload.new.status === 'playing') {
                    state.isGameActive = true;
                }
                
                // Hide host controls when game starts
                if (payload.old.status === 'waiting' && payload.new.status === 'playing') {
                    state.isStartingGame = false;
                    const hostControls = document.getElementById('hostControls');
                    if (hostControls) hostControls.style.display = 'none';
                }
                
                // Handle phase transitions
                if (payload.new.phase === 'bidding' && payload.old.phase === 'triunfo') {
                    state.currentPhase = 'bidding';
                    await loadMyHand();
                }
                
                if (payload.new.phase === 'playing' && payload.old.phase === 'bidding') {
                    state.currentPhase = 'playing';
                    await loadGameState();
                }
                
                if (payload.new.phase !== payload.old.phase) {
                    ui.renderHand(state.myHand);
                    ui.updateGameUI();
                }
                
                if (payload.new.triunfo_card_id && payload.new.triunfo_card_id !== state.triunfoCard?.id) {
                    const { data: card } = await supabaseClient
                        .from('cards')
                        .select('*')
                        .eq('id', payload.new.triunfo_card_id)
                        .single();
                    state.triunfoCard = card;
                }
                
                if (payload.new.status === 'ended') {
                    redirectToLobby(payload.new.ended_reason);
                }
                
                updateHostControls();
                ui.updateGameUI();
            }
        )
        .subscribe();
}

function setupChatSubscription() {
    state.subscriptions.chat = supabaseClient
        .channel(`chat:${state.roomId}`)
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${state.roomId}` },
            (payload) => {
                const msg = payload.new;
                if (msg.player_id !== state.playerId) {
                    addChatMessage(msg.player_name, msg.message);
                }
            }
        )
        .subscribe();
}

async function loadChatHistory() {
    const messages = await db.fetchChatHistory();
    messages.forEach(msg => {
        if (msg.player_id !== state.playerId) {
            addChatMessage(msg.player_name, msg.message);
        }
    });
}

function setupChatInput() {
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendChatMessage();
        });
    }
}

async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    if (!input) return;
    
    const message = input.value.trim();
    if (!message) return;
    
    input.value = '';
    addChatMessage('You', message);
    await db.sendChatMessage(message);
}

export function addChatMessage(sender, message) {
    const chatLog = document.getElementById('chatLog');
    if (!chatLog) return;
    
    const entry = document.createElement('div');
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    entry.style.cssText = 'padding: 0.4rem; background: rgba(255,255,255,0.03); border-radius: 6px; line-height: 1.4; font-size: 0.85rem; margin-bottom: 0.3rem;';
    entry.innerHTML = `
        <span style="color: #a0aec0; font-size: 0.75rem;">[${time}]</span>
        <span style="font-weight: bold; color: ${sender === 'System' ? '#ffd700' : '#4299e1'};">${escapeHtml(sender)}:</span>
        <span>${escapeHtml(message)}</span>
    `;
    
    chatLog.appendChild(entry);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function addLog(message) {
    const log = document.getElementById('gameLog');
    if (!log) return;
    
    const entry = document.createElement('div');
    entry.style.cssText = 'padding: 0.4rem; margin-bottom: 0.3rem; border-left: 3px solid #4299e1; padding-left: 0.6rem; background: rgba(255,255,255,0.02); border-radius: 0 6px 6px 0; color: #a0aec0; font-size: 0.85rem;';
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
}

function startHeartbeat() {
    state.heartbeatInterval = setInterval(() => {
        db.updateLastSeen();
    }, 5000);
}

function copyCode() {
    const code = localStorage.getItem('currentRoom');
    navigator.clipboard.writeText(code).then(() => {
        addChatMessage('System', 'Room code copied!');
    });
}

async function leaveGame() {
    if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);
    if (state.subscriptions.room) await state.subscriptions.room.unsubscribe();
    if (state.subscriptions.chat) await state.subscriptions.chat.unsubscribe();
    
    await db.deletePlayer();
    redirectToLobby();
}

function redirectToLobby(message) {
    if (message) alert(message);
    localStorage.removeItem('currentRoom');
    localStorage.removeItem('currentPlayer');
    localStorage.removeItem('isHost');
    window.location.href = 'index.html';
}

// Start the game
document.addEventListener('DOMContentLoaded', initGame);

// Cleanup on unload
window.addEventListener('beforeunload', async () => {
    if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);
    await db.deletePlayer();
});