let currentRoom = null;
let currentPlayer = null;
let roomId = null;
let subscription = null;
let players = [];

// Initialize on load
document.addEventListener('DOMContentLoaded', async () => {
    const roomCode = localStorage.getItem('currentRoom');
    currentPlayer = localStorage.getItem('currentPlayer');
    const isHost = localStorage.getItem('isHost') === 'true';
    
    if (!roomCode) {
        window.location.href = 'index.html';
        return;
    }

    document.getElementById('displayCode').textContent = `ROOM: ${roomCode}`;
    
    if (isHost) {
        document.getElementById('hostControls').style.display = 'block';
    }

    await loadRoom(roomCode);
    setupRealtimeSubscription();
    startHeartbeat();
});

async function loadRoom(code) {
    const { data: room, error } = await supabase
        .from('rooms')
        .select('*')
        .eq('code', code)
        .single();

    if (error || !room) {
        alert('Room not found');
        leaveGame();
        return;
    }

    currentRoom = room;
    roomId = room.id;
    await updatePlayerList();
}

async function updatePlayerList() {
    const { data: playersData, error } = await supabase
        .from('players')
        .select('*')
        .eq('room_id', roomId)
        .order('seat_number');

    if (error) return;

    players = playersData;
    
    // Update seats on table
    document.querySelectorAll('.seat').forEach(seat => {
        const seatNum = parseInt(seat.id.split('-')[1]);
        const player = players.find(p => p.seat_number === seatNum);
        
        const slot = seat.querySelector('.player-slot');
        
        if (player) {
            slot.classList.remove('empty');
            slot.classList.add('active');
            slot.querySelector('.avatar').textContent = player.name.charAt(0).toUpperCase();
            slot.querySelector('.name').textContent = player.name;
            
            if (player.id === playerId) {
                slot.style.borderColor = '#48bb78';
            }
        } else {
            slot.classList.add('empty');
            slot.classList.remove('active');
            slot.querySelector('.avatar').textContent = '?';
            slot.querySelector('.name').textContent = 'Empty';
            slot.style.borderColor = 'rgba(255,255,255,0.1)';
        }
    });

    // Update side panel list
    const ul = document.getElementById('playersUl');
    ul.innerHTML = '';
    players.forEach(p => {
        const li = document.createElement('li');
        let badges = '';
        if (p.id === currentRoom.host_id) badges += '<span class="host">👑 HOST</span>';
        if (p.id === playerId) badges += '<span class="you"> YOU</span>';
        
        li.innerHTML = `
            <span>${p.name} (Seat ${p.seat_number})</span>
            <div>${badges}</div>
        `;
        ul.appendChild(li);
    });

    document.querySelector('.player-list h3').textContent = `Players (${players.length}/5)`;
    
    // Update status
    const status = document.getElementById('gameStatus');
    if (players.length < 2) {
        status.textContent = 'Waiting for more players...';
        status.style.color = '#ecc94b';
    } else {
        status.textContent = 'Ready to start';
        status.style.color = '#48bb78';
    }
}

function setupRealtimeSubscription() {
    // Subscribe to players changes
    subscription = supabase
        .channel(`room:${roomId}`)
        .on('postgres_changes', 
            { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` },
            (payload) => {
                updatePlayerList();
                if (payload.eventType === 'INSERT') {
                    addLog(`${payload.new.name} joined the table`);
                } else if (payload.eventType === 'DELETE') {
                    addLog('A player left the table');
                }
            }
        )
        .on('postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
            (payload) => {
                if (payload.new.status === 'playing') {
                    document.getElementById('gameStatus').textContent = 'Game in progress';
                    document.getElementById('hostControls').style.display = 'none';
                    addLog('Game started!');
                    // Initialize your card game logic here
                    initializeGame();
                }
            }
        )
        .subscribe();
}

function addLog(message) {
    const log = document.getElementById('gameLog');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
}

async function startGame() {
    if (players.length < 2) {
        alert('Need at least 2 players to start');
        return;
    }

    const { error } = await supabase
        .from('rooms')
        .update({ status: 'playing' })
        .eq('id', roomId);

    if (error) {
        alert('Failed to start game');
    }
}

// Placeholder for your game logic
function initializeGame() {
    // This is where you'll implement:
    // - Deck creation and shuffling
    // - Card dealing
    // - Turn management
    // - Win conditions
    // etc.
    
    console.log('Game initialized - Add your card game logic here');
    
    // Example: Deal cards to all players
    dealInitialCards();
}

function dealInitialCards() {
    // Example implementation - replace with your game rules
    const suits = ['♠', '♥', '♦', '♣'];
    const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    
    // Create deck
    let deck = [];
    for (let suit of suits) {
        for (let value of values) {
            deck.push({ suit, value, color: (suit === '♥' || suit === '♦') ? 'red' : 'black' });
        }
    }
    
    // Shuffle
    deck = deck.sort(() => Math.random() - 0.5);
    
    // Deal to current player (example: 2 cards)
    const mySeat = parseInt(localStorage.getItem('seatNumber'));
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
    // Handle player actions (check, call, raise, fold, etc.)
    console.log('Action:', action);
    addLog(`You chose to ${action}`);
    
    // Broadcast to other players via Supabase
    broadcastAction(action);
}

async function broadcastAction(action) {
    const { error } = await supabase
        .from('game_state')
        .insert([{
            room_id: roomId,
            player_id: playerId,
            data: { action, timestamp: new Date().toISOString() }
        }]);
}

function copyCode() {
    const code = localStorage.getItem('currentRoom');
    navigator.clipboard.writeText(code);
    alert('Room code copied!');
}

async function leaveGame() {
    if (subscription) {
        await subscription.unsubscribe();
    }
    
    // Remove player from room
    await supabase
        .from('players')
        .delete()
        .eq('id', playerId);
    
    // Clear session
    localStorage.removeItem('currentRoom');
    localStorage.removeItem('currentPlayer');
    localStorage.removeItem('isHost');
    localStorage.removeItem('seatNumber');
    
    window.location.href = 'index.html';
}

// Keep connection alive
function startHeartbeat() {
    setInterval(async () => {
        await supabase
            .from('players')
            .update({ is_connected: true })
            .eq('id', playerId);
    }, 30000);
}

// Handle page unload
window.addEventListener('beforeunload', async () => {
    await supabase
        .from('players')
        .delete()
        .eq('id', playerId);
});