// ==========================================
// CARD GAME - PRODUCTION READY
// Safety features: auto-disconnect, host migration, game end detection
// ==========================================

// Get player ID
let playerId = localStorage.getItem('playerId');
if (!playerId) {
    playerId = crypto.randomUUID();
    localStorage.setItem('playerId', playerId);
}

// Global state
let currentRoom = null;
let currentPlayer = null;
let roomId = null;
let subscription = null;
let players = [];
let gameLoop = null;
let heartbeatInterval = null;
let isGameActive = false;

// ==========================================
// INITIALIZATION
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
    const roomCode = localStorage.getItem('currentRoom');
    currentPlayer = localStorage.getItem('currentPlayer');
    
    if (!roomCode) {
        redirectToLobby('No room code found');
        return;
    }

    // Check if room still exists and is valid
    const { data: room, error } = await supabaseClient
        .from('rooms')
        .select('*')
        .eq('code', roomCode)
        .single();

    if (error || !room) {
        redirectToLobby('Room not found');
        return;
    }

    if (room.status === 'ended') {
        redirectToLobby(`Game ended: ${room.ended_reason || 'Unknown reason'}`);
        return;
    }

    // Check if player is still in this room
    const { data: playerCheck } = await supabaseClient
        .from('players')
        .select('*')
        .eq('id', playerId)
        .eq('room_id', room.id)
        .single();

    if (!playerCheck) {
        redirectToLobby('You were removed from this room');
        return;
    }

    // Initialize game
    currentRoom = room;
    roomId = room.id;
    
    setupUI();
    await updatePlayerList();
    setupRealtimeSubscription();
    startGameLoop();
    
    addLog('Connected to table');
});

function setupUI() {
    const roomCode = localStorage.getItem('currentRoom');
    const isHost = localStorage.getItem('isHost') === 'true';
    
    document.getElementById('displayCode').textContent = `ROOM: ${roomCode}`;
    
    if (isHost && currentRoom?.status === 'waiting') {
        document.getElementById('hostControls').style.display = 'block';
    }
}

// ==========================================
// REALTIME SYNC
// ==========================================

function setupRealtimeSubscription() {
    subscription = supabaseClient
        .channel(`room:${roomId}`)
        .on('postgres_changes', 
            { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` },
            async (payload) => {
                await updatePlayerList();
                
                if (payload.eventType === 'INSERT') {
                    addLog(`${payload.new.name} joined the table`);
                } else if (payload.eventType === 'DELETE') {
                    const playerName = payload.old?.name || 'A player';
                    addLog(`${playerName} left the table`);
                    
                    // Check if we need to end game
                    await checkGameEndConditions();
                }
            }
        )
        .on('postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
            async (payload) => {
                currentRoom = payload.new;
                
                // Game started
                if (payload.old.status === 'waiting' && payload.new.status === 'playing') {
                    document.getElementById('gameStatus').textContent = 'Game in progress';
                    document.getElementById('hostControls').style.display = 'none';
                    addLog('Game started!');
                    isGameActive = true;
                    initializeGame();
                }
                
                // Game ended
                if (payload.new.status === 'ended') {
                    isGameActive = false;
                    endGame(payload.new.ended_reason);
                }
                
                // Host changed
                if (payload.old.host_id !== payload.new.host_id) {
                    const { data: newHost } = await supabaseClient
                        .from('players')
                        .select('name')
                        .eq('id', payload.new.host_id)
                        .single();
                    
                    addLog(`${newHost?.name || 'New host'} is now the host`);
                    
                    // Update UI if we became host
                    if (payload.new.host_id === playerId) {
                        localStorage.setItem('isHost', 'true');
                        if (currentRoom.status === 'waiting') {
                            document.getElementById('hostControls').style.display = 'block';
                        }
                    }
                }
            }
        )
        .subscribe();
}

// ==========================================
// PLAYER MANAGEMENT
// ==========================================

async function updatePlayerList() {
    const { data: playersData, error } = await supabaseClient
        .from('players')
        .select('*')
        .eq('room_id', roomId)
        .order('seat_number');

    if (error) return;

    players = playersData;
    
    // Update table seats
    document.querySelectorAll('.seat').forEach(seat => {
        const seatNum = parseInt(seat.id.split('-')[1]);
        const player = players.find(p => p.seat_number === seatNum);
        const slot = seat.querySelector('.player-slot');
        
        if (player) {
            slot.classList.remove('empty');
            slot.classList.add('active');
            slot.querySelector('.avatar').textContent = player.name.charAt(0).toUpperCase();
            slot.querySelector('.name').textContent = player.name;
            slot.style.borderColor = player.id === playerId ? '#48bb78' : 'rgba(255,255,255,0.1)';
        } else {
            slot.classList.add('empty');
            slot.classList.remove('active');
            slot.querySelector('.avatar').textContent = '?';
            slot.querySelector('.name').textContent = 'Empty';
            slot.style.borderColor = 'rgba(255,255,255,0.1)';
        }
    });

    // Update side panel
    const ul = document.getElementById('playersUl');
    ul.innerHTML = '';
    players.forEach(p => {
        const li = document.createElement('li');
        let badges = '';
        if (p.id === currentRoom?.host_id) badges += '<span class="host">👑 HOST</span>';
        if (p.id === playerId) badges += '<span class="you"> YOU</span>';
        
        li.innerHTML = `<span>${p.name} (Seat ${p.seat_number})</span><div>${badges}</div>`;
        ul.appendChild(li);
    });

    document.querySelector('.player-list h3').textContent = `Players (${players.length}/5)`;
    
    // Update status
    const status = document.getElementById('gameStatus');
    if (!isGameActive) {
        if (players.length < 2) {
            status.textContent = 'Waiting for more players...';
            status.style.color = '#ecc94b';
        } else {
            status.textContent = 'Ready to start';
            status.style.color = '#48bb78';
        }
    }
}

// ==========================================
// GAME LOOP & SAFETY CHECKS
// ==========================================

function startGameLoop() {
    // Heartbeat every 3 seconds
    heartbeatInterval = setInterval(async () => {
        await supabaseClient
            .from('players')
            .update({ last_seen: new Date().toISOString() })
            .eq('id', playerId);
    }, 3000);
    
    // Cleanup check every 5 seconds
    gameLoop = setInterval(async () => {
        await cleanupDisconnectedPlayers();
        await checkGameEndConditions();
    }, 5000);
}

async function cleanupDisconnectedPlayers() {
    // Mark inactive players (not seen for 10 seconds)
    const cutoffTime = new Date(Date.now() - 10000).toISOString();
    
    const { data: inactivePlayers } = await supabaseClient
        .from('players')
        .select('id, name')
        .eq('room_id', roomId)
        .lt('last_seen', cutoffTime);
    
    if (inactivePlayers) {
        for (const player of inactivePlayers) {
            await supabaseClient.from('players').delete().eq('id', player.id);
            addLog(`${player.name} disconnected (timeout)`);
        }
    }
}

async function checkGameEndConditions() {
    const { data: room } = await supabaseClient
        .from('rooms')
        .select('*, players(*)')
        .eq('id', roomId)
        .single();
    
    if (!room || room.status === 'ended') return;
    
    const activePlayers = room.players || [];
    
    // Condition 1: No players left
    if (activePlayers.length === 0) {
        await endGameServer('empty');
        return;
    }
    
    // Condition 2: Host left during game
    const hostStillHere = activePlayers.some(p => p.id === room.host_id);
    if (!hostStillHere && room.status === 'playing') {
        await endGameServer('host_left');
        return;
    }
    
    // Condition 3: Only one player left during game
    if (activePlayers.length === 1 && room.status === 'playing') {
        await endGameServer('insufficient_players');
        return;
    }
    
    // Condition 4: Host left in lobby - transfer host
    if (!hostStillHere && room.status === 'waiting' && activePlayers.length > 0) {
        const newHost = activePlayers[0];
        await supabaseClient
            .from('rooms')
            .update({ host_id: newHost.id })
            .eq('id', roomId);
        
        if (newHost.id === playerId) {
            localStorage.setItem('isHost', 'true');
            document.getElementById('hostControls').style.display = 'block';
        }
    }
}

async function endGameServer(reason) {
    await supabaseClient
        .from('rooms')
        .update({ 
            status: 'ended', 
            ended_at: new Date().toISOString(), 
            ended_reason: reason 
        })
        .eq('id', roomId);
}

function endGame(reason) {
    isGameActive = false;
    
    let message = 'Game ended';
    switch(reason) {
        case 'empty': message = 'Game ended: All players left'; break;
        case 'host_left': message = 'Game ended: Host disconnected'; break;
        case 'insufficient_players': message = 'Game ended: Not enough players'; break;
        case 'manual': message = 'Game ended by host'; break;
    }
    
    addLog(message);
    alert(message);
    
    setTimeout(() => {
        redirectToLobby();
    }, 3000);
}

// ==========================================
// GAME ACTIONS
// ==========================================

async function startGame() {
    if (players.length < 2) {
        alert('Need at least 2 players to start');
        return;
    }

    const { error } = await supabaseClient
        .from('rooms')
        .update({ status: 'playing' })
        .eq('id', roomId);

    if (error) {
        alert('Failed to start game');
    }
}

function initializeGame() {
    console.log('Game started - Add your custom game logic here');
    dealInitialCards();
    // Add your turn system, scoring, etc. here
}

function dealInitialCards() {
    const suits = ['♠', '♥', '♦', '♣'];
    const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    
    let deck = [];
    for (let suit of suits) {
        for (let value of values) {
            deck.push({ suit, value, color: (suit === '♥' || suit === '♦') ? 'red' : 'black' });
        }
    }
    
    deck = deck.sort(() => Math.random() - 0.5);
    const myHand = deck.splice(0, 2);
    renderHand(myHand);
}

function renderHand(cards) {
    const container = document.querySelector('.hand-container');
    container.innerHTML = '';
    
    cards.forEach((card, index) => {
        const cardEl = document.createElement('div');
        cardEl.className = 'card card-dealt';
        cardEl.style.animationDelay = `${index * 0.1}s`;
        cardEl.innerHTML = `
            <div style="color: ${card.color}; font-size: 2rem;">${card.suit}</div>
            <div style="color: ${card.color}; font-size: 1.2rem; font-weight: bold;">${card.value}</div>
        `;
        container.appendChild(cardEl);
    });
}

function gameAction(action) {
    if (!isGameActive) return;
    
    console.log('Action:', action);
    addLog(`You chose to ${action}`);
    broadcastAction(action);
    // Add your turn logic here
}

async function broadcastAction(action) {
    await supabaseClient
        .from('game_state')
        .insert([{
            room_id: roomId,
            player_id: playerId,
            data: { action, timestamp: new Date().toISOString() }
        }]);
}

// ==========================================
// UTILITIES
// ==========================================

function addLog(message) {
    const log = document.getElementById('gameLog');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
}

function copyCode() {
    const code = localStorage.getItem('currentRoom');
    navigator.clipboard.writeText(code);
    alert('Room code copied!');
}

function redirectToLobby(message) {
    if (message) alert(message);
    
    localStorage.removeItem('currentRoom');
    localStorage.removeItem('currentPlayer');
    localStorage.removeItem('isHost');
    localStorage.removeItem('seatNumber');
    
    window.location.href = 'index.html';
}

// ==========================================
// CLEANUP
// ==========================================

async function leaveGame() {
    // Stop all intervals
    if (gameLoop) clearInterval(gameLoop);
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    
    // Unsubscribe from realtime
    if (subscription) {
        await subscription.unsubscribe();
    }
    
    // If host leaves during game, end it
    if (currentRoom?.host_id === playerId && isGameActive) {
        await endGameServer('host_left');
    }
    
    // Remove player
    await supabaseClient.from('players').delete().eq('id', playerId);
    
    // Cleanup local storage and redirect
    redirectToLobby();
}

// Emergency cleanup on page close
window.addEventListener('beforeunload', async (e) => {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (gameLoop) clearInterval(gameLoop);
    
    // Try to clean up (may not complete before page closes)
    await supabaseClient.from('players').delete().eq('id', playerId);
});