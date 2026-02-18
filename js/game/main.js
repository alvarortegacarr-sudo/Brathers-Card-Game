// ==========================================
// MAIN INITIALIZATION AND EVENT HANDLERS
// ==========================================

import { state, updateCardsPerPlayer, resetGameState } from './state.js';
import * as db from './supabase.js';
import * as ui from './ui.js';
import { submitBid } from './bidding.js';
import { selectAttribute, playCard } from './playing.js';
import { endSet } from './scoring.js';
import { supabaseClient } from './supabase.js';

// Export functions for game.js to expose globally
export { submitBid, selectAttribute, playCard, endSet };

export async function initGame() {
    console.log('=== INIT GAME START ===');
    
    const roomCode = localStorage.getItem('currentRoom');
    state.currentPlayer = localStorage.getItem('currentPlayer');
    
    console.log('Room code:', roomCode);
    console.log('Player:', state.currentPlayer);
    
    if (!roomCode) {
        redirectToLobby('No room code found');
        return;
    }

    try {
        console.log('Fetching room...');
        const room = await db.fetchRoom(roomCode);
        console.log('Room fetched:', room.id, 'Status:', room.status);
        
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
        
        console.log('=== INIT GAME COMPLETE ===');
        
    } catch (err) {
        console.error('Initialization error:', err);
        redirectToLobby('Failed to initialize game: ' + err.message);
    }
}

function setupUI() {
    const roomCode = localStorage.getItem('currentRoom');
    document.getElementById('displayCode').textContent = `ROOM: ${roomCode}`;
    
    const startBtn = document.getElementById('startBtn');
    if (startBtn) {
        startBtn.addEventListener('click', startNewSet);
    }
    
    updateHostControls();
}

export function updateHostControls() {
    const hostControls = document.getElementById('hostControls');
    if (!hostControls) return;
    
    const isHost = localStorage.getItem('isHost') === 'true';
    
    if (state.isGameActive || state.isStartingGame || state.currentRoom?.status === 'playing') {
        hostControls.style.display = 'none';
        return;
    }
    
    if (isHost) {
        hostControls.style.display = 'block';
        const count = state.players.length || 1;
        const btn = hostControls.querySelector('#startBtn');
        if (btn) {
            btn.disabled = state.isStartingGame;
            btn.textContent = state.isStartingGame ? '⏳ Starting...' : `🚀 Start Game (${count} player${count !== 1 ? 's' : ''})`;
        }
    } else {
        hostControls.style.display = 'none';
    }
}

export async function startNewSet() {
    console.log('=== START NEW SET ===');
    
    if (state.isStartingGame) return;
    if (state.players.length < 2) {
        alert('Need at least 2 players!');
        return;
    }

    state.isStartingGame = true;
    updateHostControls();
    
    const hostControls = document.getElementById('hostControls');
    if (hostControls) hostControls.style.display = 'none';

    try {
        console.log('Cleaning up...');
        await db.cleanupGameData();
        await db.resetPlayerStats();
        
        console.log('Creating turn order...');
        const shuffledPlayers = [...state.players].sort(() => Math.random() - 0.5);
        await db.createTurnOrder(shuffledPlayers);
        
        console.log('Fetching cards...');
        const { data: allCards, error: cardsError } = await supabaseClient.from('cards').select('*');
        if (cardsError) throw cardsError;
        
        console.log('Picking triunfo...');
        const randomCard = allCards[Math.floor(Math.random() * allCards.length)];
        state.triunfoCard = randomCard;
        
        console.log('Dealing cards...');
        await dealCards(allCards, shuffledPlayers);
        
        console.log('Updating room to playing...');
        await db.updateRoom({
            status: 'playing',
            phase: 'triunfo',
            current_set: (state.currentRoom.current_set || 0) + 1,
            current_turn: 0,
            triunfo_card_id: randomCard.id,
            current_attribute: null,
            game_data: { round_starter: 0 }
        });
        
        state.isGameActive = true;
        state.currentPhase = 'triunfo';
        state.currentRoom.status = 'playing';
        
        console.log('Success! Game started.');
        addChatMessage('System', `🎴 Set started! El Triunfo is ${randomCard.name}!`);
        
        setTimeout(async () => {
            console.log('Transitioning to bidding...');
            await db.updateRoom({ phase: 'bidding' });
            state.isStartingGame = false;
        }, 2000);
        
    } catch (err) {
        console.error('START GAME ERROR:', err);
        state.isStartingGame = false;
        state.isGameActive = false;
        updateHostControls();
        alert('Failed to start game: ' + err.message);
    }
}

async function dealCards(allCards, shuffledPlayers) {
    const shuffled = [...allCards].sort(() => Math.random() - 0.5);
    updateCardsPerPlayer();
    
    let cardIndex = 0;
    for (const player of shuffledPlayers) {
        const playerCards = shuffled.slice(cardIndex, cardIndex + state.cardsPerPlayer);
        cardIndex += state.cardsPerPlayer;
        console.log(`Dealing ${playerCards.length} cards to player ${player.name} (${player.id})`);
        await db.dealCardsToPlayer(player.id, playerCards);
    }
    
    // Load my hand immediately after dealing
    await loadMyHand();
    addChatMessage('System', `📦 ${state.cardsPerPlayer} cards dealt!`);
}

export async function loadMyHand() {
    console.log('=== LOAD MY HAND ===');
    console.log('Player ID:', state.playerId);
    console.log('Room ID:', state.roomId);
    
    try {
        const hand = await db.fetchMyHand();
        console.log('Raw hand from DB:', hand.length, 'records');
        
        // Filter out played cards - handle both true and 1 as played
        const unplayed = hand.filter(h => {
            const isPlayed = h.played === true || h.played === 1;
            console.log(`Card ${h.card_id}: played=${h.played}, isPlayed=${isPlayed}`);
            return !isPlayed;
        });
        
        console.log('Unplayed cards:', unplayed.length);
        
        state.myHand = unplayed.map(h => ({ 
            ...h.cards, 
            hand_id: h.id, 
            hand_record_id: h.id 
        }));
        
        console.log('Final hand:', state.myHand.map(c => c.name));
        
        ui.renderHand(state.myHand);
    } catch (err) {
        console.error('Load hand error:', err);
        console.error(err.stack);
    }
}

async function loadGameState() {
    try {
        console.log('=== LOAD GAME STATE ===');
        const room = await db.fetchRoom(state.currentRoom.code);
        state.currentPhase = room.phase;
        state.triunfoCard = room.triunfo;
        state.currentAttribute = room.current_attribute;
        state.currentRoom = room;
        
        const turnOrder = await db.fetchTurnOrder();
        const myEntry = turnOrder.find(t => t.player_id === state.playerId);
        state.myPosition = myEntry ? myEntry.position : 0;
        state.myTurnOrder = myEntry;
        
        console.log('My position:', state.myPosition);
        console.log('Game data:', room.game_data);
        
        const me = state.players.find(p => p.id === state.playerId);
        state.hasBidded = me?.has_bid || false;
        
        // ALWAYS reload hand
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
    console.log('Setting up realtime for room:', state.roomId);
    
    state.subscriptions.room = supabaseClient
        .channel(`room:${state.roomId}`)
        .on('postgres_changes', 
            { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${state.roomId}` },
            async (payload) => {
                console.log('Player update:', payload.eventType);
                
                if (payload.eventType === 'UPDATE') {
                    const idx = state.players.findIndex(p => p.id === payload.new.id);
                    if (idx >= 0) state.players[idx] = payload.new;
                    
                    if (payload.new.id === state.playerId) {
                        state.hasBidded = payload.new.has_bid;
                    }
                } else if (payload.eventType === 'INSERT') {
                    state.players.push(payload.new);
                } else if (payload.eventType === 'DELETE') {
                    state.players = state.players.filter(p => p.id !== payload.old.id);
                }
                
                await updatePlayerList();
                updateHostControls();
            }
        )
        .on('postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${state.roomId}` },
            async (payload) => {
                console.log('Room update:', payload.old.phase, '->', payload.new.phase);
                
                const oldPhase = payload.old.phase;
                const newPhase = payload.new.phase;
                
                state.currentRoom = payload.new;
                state.currentPhase = newPhase;
                state.currentAttribute = payload.new.current_attribute;
                
                if (payload.new.status === 'playing') {
                    state.isGameActive = true;
                }
                
                // Transition: waiting -> playing (triunfo)
                if (payload.old.status === 'waiting' && payload.new.status === 'playing') {
                    state.isStartingGame = false;
                    document.getElementById('hostControls').style.display = 'none';
                }
                
                // Transition: triunfo -> bidding
                if (oldPhase === 'triunfo' && newPhase === 'bidding') {
                    console.log('ENTERING BIDDING PHASE - Loading hand');
                    await loadMyHand();
                }
                
                // Transition: bidding -> playing
                if (oldPhase === 'bidding' && newPhase === 'playing') {
                    console.log('ENTERING PLAYING PHASE - Loading game state');
                    state.hasBidded = false;
                    await loadGameState();
                }
                
                // Within playing phase: new round started
                if (oldPhase === 'playing' && newPhase === 'playing') {
                    if (payload.new.current_turn !== payload.old.current_turn) {
                        console.log('NEW ROUND:', payload.new.current_turn);
                        state.currentAttribute = payload.new.current_attribute;
                        // Reload hand to get fresh state
                        await loadMyHand();
                    }
                }
                
                ui.renderHand(state.myHand);
                ui.updateGameUI();
                updateHostControls();
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
                if (payload.new.player_id !== state.playerId) {
                    addChatMessage(payload.new.player_name, payload.new.message);
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

export async function sendChatMessage() {
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

export function copyCode() {
    const code = localStorage.getItem('currentRoom');
    navigator.clipboard.writeText(code).then(() => {
        addChatMessage('System', 'Room code copied!');
    });
}

export async function leaveGame() {
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

window.addEventListener('beforeunload', async () => {
    if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);
    await db.deletePlayer();
});