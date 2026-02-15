// ==========================================
// CARD GAME - PRODUCTION READY WITH CHAT
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
let chatSubscription = null;
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

    currentRoom = room;
    roomId = room.id;
    
    setupUI();
    setupChatInput(); // Setup chat input here
    await updatePlayerList();
    setupRealtimeSubscription();
    setupChatSubscription();
    loadChatHistory();
    startGameLoop();
    
    addLog('Connected to table');
    addChatMessage('System', 'Welcome to the table! Use the chat below to communicate.');
});

function setupUI() {
    const roomCode = localStorage.getItem('currentRoom');
    const isHost = localStorage.getItem('isHost') === 'true';
    
    document.getElementById('displayCode').textContent = `ROOM: ${roomCode}`;
    
    if (isHost && currentRoom?.status === 'waiting') {
        document.getElementById('hostControls').style.display = 'block';
    }
}

// Setup chat input listeners
function setupChatInput() {
    const chatInput = document.getElementById('chatInput');
    const sendButton = document.querySelector('.btn-chat');
    
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendChatMessage();
        });
    }
    
    if (sendButton) {
        sendButton.addEventListener('click', sendChatMessage);
    }
}

// ==========================================
// CHAT SYSTEM
// ==========================================

function setupChatSubscription() {
    chatSubscription = supabaseClient
        .channel(`chat:${roomId}`)
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` },
            (payload) => {
                const msg = payload.new;
                if (msg.player_id !== playerId) {
                    addChatMessage(msg.player_name, msg.message, false);
                }
            }
        )
        .subscribe();
}

async function loadChatHistory() {
    const { data: messages } = await supabaseClient
        .from('chat_messages')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true })
        .limit(50);
    
    if (messages) {
        messages.forEach(msg => {
            if (msg.player_id !== playerId) {
                addChatMessage(msg.player_name, msg.message, false);
            }
        });
    }
}

async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    if (!input) return;
    
    const message = input.value.trim();
    if (!message) return;
    
    // Clear input immediately for better UX
    input.value = '';
    
    // Add to UI immediately
    addChatMessage('You', message, true);
    
    // Send to database
    const { error } = await supabaseClient
        .from('chat_messages')
        .insert([{
            room_id: roomId,
            player_id: playerId,
            player_name: currentPlayer,
            message: message
        }]);
    
    if (error) {
        console.error('Failed to send message:', error);
        addChatMessage('System', 'Failed to send message', false);
    }
}

function addChatMessage(sender, message, isOwn = false) {
    const chatLog = document.getElementById('chatLog');
    if (!chatLog) return;
    
    const entry = document.createElement('div');
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    let senderClass = 'chat-sender';
    if (sender === 'System') senderClass += ' system';
    if (isOwn) senderClass += ' own';
    
    entry.className = 'chat-entry';
    entry.innerHTML = `
        <span class="chat-time">[${time}]</span>
        <span class="${senderClass}">${escapeHtml(sender)}:</span>
        <span class="chat-text">${escapeHtml(message)}</span>
    `;
    
    chatLog.appendChild(entry);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
                    addChatMessage('System', `${payload.new.name} joined the table`);
                } else if (payload.eventType === 'DELETE') {
                    const playerName = payload.old?.name || 'A player';
                    addLog(`${playerName} left the table`);
                    addChatMessage('System', `${playerName} left the table`);
                    await checkGameEndConditions();
                }
            }
        )
        .on('postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
            async (payload) => {
                currentRoom = payload.new;
                
                if (payload.old.status === 'waiting' && payload.new.status === 'playing') {
                    document.getElementById('gameStatus').textContent = 'Game in progress';
                    document.getElementById('hostControls').style.display = 'none';
                    addLog('Game started!');
                    addChatMessage('System', '🎮 Game started! Good luck!');
                    isGameActive = true;
                    initializeGame();
                }
                
                if (payload.new.status === 'ended') {
                    isGameActive = false;
                    endGame(payload.new.ended_reason);
                }
                
                if (payload.old.host_id !== payload.new.host_id) {
                    const { data: newHost } = await supabaseClient
                        .from('players')
                        .select('name')
                        .eq('id', payload.new.host_id)
                        .single();
                    
                    addLog(`${newHost?.name || 'New host'} is now the host`);
                    addChatMessage('System', `👑 ${newHost?.name || 'New host'} is now the host`);
                    
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

    const ul = document.getElementById('playersUl');
    if (ul) {
        ul.innerHTML = '';
        players.forEach(p => {
            const li = document.createElement('li');
            let badges = '';
            if (p.id === currentRoom?.host_id) badges += '<span class="host">👑 HOST</span>';
            if (p.id === playerId) badges += '<span class="you"> YOU</span>';
            
            li.innerHTML = `<span>${p.name} (Seat ${p.seat_number})</span><div>${badges}</div>`;
            ul.appendChild(li);
        });
    }

    const playerListHeader = document.querySelector('.player-list h3');
    if (playerListHeader) {
        playerListHeader.textContent = `Players (${players.length}/5)`;
    }
    
    const status = document.getElementById('gameStatus');
    if (status && !isGameActive) {
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
    heartbeatInterval = setInterval(async () => {
        await supabaseClient
            .from('players')
            .update({ last_seen: new Date().toISOString() })
            .eq('id', playerId);
    }, 3000);
    
    gameLoop = setInterval(async () => {
        await cleanupDisconnectedPlayers();
        await checkGameEndConditions();
    }, 5000);
}

async function cleanupDisconnectedPlayers() {
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
    
    if (activePlayers.length === 0) {
        await endGameServer('empty');
        return;
    }
    
    const hostStillHere = activePlayers.some(p => p.id === room.host_id);
    if (!hostStillHere && room.status === 'playing') {
        await endGameServer('host_left');
        return;
    }
    
    if (activePlayers.length === 1 && room.status === 'playing') {
        await endGameServer('insufficient_players');
        return;
    }
    
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
    addChatMessage('System', message);
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
    if (!container) return;
    
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
    if (!log) return;
    
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
    if (gameLoop) clearInterval(gameLoop);
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    
    if (subscription) await subscription.unsubscribe();
    if (chatSubscription) await chatSubscription.unsubscribe();
    
    if (currentRoom?.host_id === playerId && isGameActive) {
        await endGameServer('host_left');
    }
    
    await supabaseClient.from('players').delete().eq('id', playerId);
    
    redirectToLobby();
}

window.addEventListener('beforeunload', async () => {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (gameLoop) clearInterval(gameLoop);
    
    await supabaseClient.from('players').delete().eq('id', playerId);
});