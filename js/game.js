// ==========================================
// EL TRIUNFO CARD GAME
// Complete implementation with bidding, turns, and scoring
// ==========================================

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
let myHand = [];
let gameLoop = null;
let heartbeatInterval = null;
let isGameActive = false;
let currentPhase = 'waiting'; // waiting, bidding, triunfo, playing, scoring
let myPosition = 0;
let triunfoCard = null;
let currentAttribute = null;
let cardsPerPlayer = 0;

const ATTRIBUTES = ['car', 'cul', 'tet', 'fis', 'per'];
const ATTRIBUTE_NAMES = { car: 'CAR', cul: 'CUL', tet: 'TET', fis: 'FIS', per: 'PER' };
const WINNING_SCORE = 50;

const CARD_DISTRIBUTION = { 2: 20, 3: 13, 4: 10, 5: 8 };

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
        .select('*, players(*), turn_order(*)')
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

    currentRoom = room;
    roomId = room.id;
    players = room.players || [];
    
    setupUI();
    setupChatInput();
    await updatePlayerList();
    setupRealtimeSubscription();
    setupChatSubscription();
    loadChatHistory();
    startGameLoop();
    
    if (room.status === 'playing') {
        isGameActive = true;
        currentPhase = room.phase || 'bidding';
        cardsPerPlayer = CARD_DISTRIBUTION[players.length] || 8;
        await loadMyHand();
        await loadGameState();
        updateGameUI();
    }
    
    addLog('Connected to El Triunfo');
    addChatMessage('System', '🎴 Welcome to El Triunfo! Bid wisely, play smartly!');
});

function setupUI() {
    const roomCode = localStorage.getItem('currentRoom');
    const isHost = localStorage.getItem('isHost') === 'true';
    
    document.getElementById('displayCode').textContent = `ROOM: ${roomCode}`;
    
    if (isHost && currentRoom?.status === 'waiting') {
        document.getElementById('hostControls').style.display = 'block';
        document.getElementById('hostControls').innerHTML = `
            <button onclick="startNewSet()" class="btn-start">🚀 Start New Set</button>
        `;
    }
}

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
// GAME FLOW - START NEW SET
// ==========================================

async function startNewSet() {
    if (players.length < 2) {
        alert('Need at least 2 players!');
        return;
    }

    // Reset for new set
    await supabaseClient.from('player_hands').delete().eq('room_id', roomId);
    await supabaseClient.from('current_turn_plays').delete().eq('room_id', roomId);
    await supabaseClient.from('turn_order').delete().eq('room_id', roomId);
    
    // Reset player stats for this set
    for (const player of players) {
        await supabaseClient
            .from('players')
            .update({ 
                predicted_rounds: null, 
                won_rounds: 0, 
                has_bid: false 
            })
            .eq('id', player.id);
    }

    // Deal cards
    await dealCards();
    
    // Create turn order (random start, then clockwise)
    const shuffledPlayers = [...players].sort(() => Math.random() - 0.5);
    for (let i = 0; i < shuffledPlayers.length; i++) {
        await supabaseClient
            .from('turn_order')
            .insert({
                room_id: roomId,
                player_id: shuffledPlayers[i].id,
                position: i
            });
    }

    // Start bidding phase
    await supabaseClient
        .from('rooms')
        .update({
            status: 'playing',
            phase: 'bidding',
            current_set: (currentRoom.current_set || 0) + 1,
            current_turn: 0,
            triunfo_card_id: null,
            current_attribute: null,
            game_data: {
                dealer: shuffledPlayers[0].id,
                bids_complete: false
            }
        })
        .eq('id', roomId);

    addChatMessage('System', `🎴 Set ${(currentRoom.current_set || 0) + 1} started! Cards dealt.`);
}

async function dealCards() {
    const { data: allCards } = await supabaseClient.from('cards').select('*');
    if (!allCards || allCards.length < 40) {
        alert('Error: Need 40 cards in deck!');
        return;
    }

    const shuffled = [...allCards].sort(() => Math.random() - 0.5);
    cardsPerPlayer = CARD_DISTRIBUTION[players.length] || 8;
    
    let cardIndex = 0;
    for (const player of players) {
        const playerCards = shuffled.slice(cardIndex, cardIndex + cardsPerPlayer);
        cardIndex += cardsPerPlayer;
        
        for (const card of playerCards) {
            await supabaseClient
                .from('player_hands')
                .insert({
                    room_id: roomId,
                    player_id: player.id,
                    card_id: card.id
                });
        }
    }
    
    addChatMessage('System', `📦 ${cardsPerPlayer} cards dealt to each player!`);
}

async function loadMyHand() {
    const { data: hand } = await supabaseClient
        .from('player_hands')
        .select('*, cards(*)')
        .eq('room_id', roomId)
        .eq('player_id', playerId)
        .eq('played', false);
    
    if (hand) {
        myHand = hand.map(h => ({ ...h.cards, hand_id: h.id }));
    }
}

async function loadGameState() {
    const { data: room } = await supabaseClient
        .from('rooms')
        .select('*, triunfo:cards!triunfo_card_id(*)')
        .eq('id', roomId)
        .single();
    
    if (room) {
        currentPhase = room.phase;
        triunfoCard = room.triunfo;
        currentAttribute = room.current_attribute;
        
        const { data: turnOrder } = await supabaseClient
            .from('turn_order')
            .select('*')
            .eq('room_id', roomId)
            .order('position');
        
        if (turnOrder) {
            const myTurnEntry = turnOrder.find(t => t.player_id === playerId);
            myPosition = myTurnEntry ? myTurnEntry.position : 0;
        }
    }
}

// ==========================================
// BIDDING PHASE
// ==========================================

async function submitBid(bid) {
    if (currentPhase !== 'bidding') return;
    
    await supabaseClient
        .from('players')
        .update({ 
            predicted_rounds: bid, 
            has_bid: true 
        })
        .eq('id', playerId);
    
    addChatMessage('System', `You bid ${bid} rounds!`);
    
    // Check if all players have bid
    const { data: allPlayers } = await supabaseClient
        .from('players')
        .select('*')
        .eq('room_id', roomId);
    
    const allBidded = allPlayers.every(p => p.has_bid);
    
    if (allBidded) {
        await revealTriunfo();
    }
}

async function revealTriunfo() {
    // Pick random card from deck as El Triunfo
    const { data: allCards } = await supabaseClient.from('cards').select('*');
    const randomCard = allCards[Math.floor(Math.random() * allCards.length)];
    
    await supabaseClient
        .from('rooms')
        .update({
            phase: 'triunfo',
            triunfo_card_id: randomCard.id
        })
        .eq('id', roomId);
    
    addChatMessage('System', `👑 EL TRIUNFO is revealed: ${randomCard.name}!`);
    addChatMessage('System', `All its attributes are now 99!`);
    
    // Start playing after 3 seconds
    setTimeout(async () => {
        await supabaseClient
            .from('rooms')
            .update({
                phase: 'playing',
                current_turn: 1,
                current_attribute: null
            })
            .eq('id', roomId);
        
        addChatMessage('System', `🎮 Turn 1 begins! First player selects attribute.`);
    }, 3000);
}

// ==========================================
// PLAYING PHASE
// ==========================================

async function selectAttribute(attribute) {
    if (currentPhase !== 'playing') return;
    
    const { data: turnOrder } = await supabaseClient
        .from('turn_order')
        .select('*, players(*)')
        .eq('room_id', roomId)
        .order('position');
    
    const currentTurnPlayer = turnOrder[(currentRoom.current_turn - 1) % players.length];
    
    if (currentTurnPlayer.player_id !== playerId) {
        alert('Not your turn to select attribute!');
        return;
    }
    
    await supabaseClient
        .from('rooms')
        .update({ current_attribute: attribute })
        .eq('id', roomId);
    
    addChatMessage('System', `${currentPlayer} selected ${ATTRIBUTE_NAMES[attribute]}!`);
}

async function playCard(cardId) {
    if (currentPhase !== 'playing') return;
    if (!currentAttribute) {
        alert('Wait for attribute to be selected!');
        return;
    }
    
    const card = myHand.find(c => c.id === cardId);
    if (!card) return;
    
    // Check if it's my turn to play
    const { data: currentPlays } = await supabaseClient
        .from('current_turn_plays')
        .select('*')
        .eq('room_id', roomId);
    
    const { data: turnOrder } = await supabaseClient
        .from('turn_order')
        .select('*')
        .eq('room_id', roomId)
        .order('position');
    
    const playsThisTurn = currentPlays.filter(p => 
        p.created_at > new Date(Date.now() - 60000).toISOString()
    );
    
    const expectedPlayerIndex = playsThisTurn.length;
    const expectedPlayer = turnOrder[expectedPlayerIndex % players.length];
    
    if (expectedPlayer.player_id !== playerId) {
        alert('Not your turn to play!');
        return;
    }
    
    // Calculate value (99 if it's El Triunfo)
    let value = card[currentAttribute];
    if (triunfoCard && card.id === triunfoCard.id) {
        value = 99;
    }
    
    // Play card
    await supabaseClient
        .from('current_turn_plays')
        .insert({
            room_id: roomId,
            player_id: playerId,
            card_id: cardId,
            attribute: currentAttribute,
            value: value
        });
    
    // Mark card as played
    await supabaseClient
        .from('player_hands')
        .update({ played: true })
        .eq('room_id', roomId)
        .eq('player_id', playerId)
        .eq('card_id', cardId);
    
    myHand = myHand.filter(c => c.id !== cardId);
    renderHand(myHand);
    
    addChatMessage('System', `${currentPlayer} played ${card.name} (${value} ${ATTRIBUTE_NAMES[currentAttribute]})`);
    
    // Check if turn is complete
    if (playsThisTurn.length + 1 >= players.length) {
        setTimeout(resolveTurn, 1000);
    }
}

async function resolveTurn() {
    const { data: plays } = await supabaseClient
        .from('current_turn_plays')
        .select('*, players(*), cards(*)')
        .eq('room_id', roomId)
        .order('played_at', { ascending: false })
        .limit(players.length);
    
    if (!plays || plays.length < players.length) return;
    
    // Find winner (highest value)
    const winner = plays.reduce((max, play) => 
        play.value > max.value ? play : max
    );
    
    // Award round to winner
    await supabaseClient
        .from('players')
        .update({ won_rounds: winner.players.won_rounds + 1 })
        .eq('id', winner.player_id);
    
    addChatMessage('System', `🏆 ${winner.players.name} wins the round with ${winner.cards.name} (${winner.value})!`);
    
    // Clear turn plays
    await supabaseClient.from('current_turn_plays').delete().eq('room_id', roomId);
    
    // Check if set is over (no more cards)
    const { data: remainingCards } = await supabaseClient
        .from('player_hands')
        .select('*')
        .eq('room_id', roomId)
        .eq('played', false);
    
    if (!remainingCards || remainingCards.length === 0) {
        await endSet();
    } else {
        // Next turn
        const nextTurn = (currentRoom.current_turn || 0) + 1;
        await supabaseClient
            .from('rooms')
            .update({
                current_turn: nextTurn,
                current_attribute: null
            })
            .eq('id', roomId);
        
        addChatMessage('System', `Turn ${nextTurn} begins!`);
    }
}

// ==========================================
// SCORING PHASE
// ==========================================

async function endSet() {
    currentPhase = 'scoring';
    await supabaseClient.from('rooms').update({ phase: 'scoring' }).eq('id', roomId);
    
    const { data: finalPlayers } = await supabaseClient
        .from('players')
        .select('*')
        .eq('room_id', roomId);
    
    let results = [];
    
    for (const player of finalPlayers) {
        const predicted = player.predicted_rounds || 0;
        const won = player.won_rounds || 0;
        
        let points = 0;
        points += won * 2; // +2 per won round
        
        if (predicted === won) {
            points += 3; // Bonus for correct prediction
        } else {
            points -= 2; // Penalty for wrong prediction
        }
        
        const newTotal = (player.total_score || 0) + points;
        
        await supabaseClient
            .from('players')
            .update({ total_score: newTotal })
            .eq('id', player.id);
        
        results.push({
            name: player.name,
            predicted,
            won,
            points,
            total: newTotal
        });
    }
    
    // Show results
    let resultMsg = '📊 SET RESULTS:\n';
    results.sort((a, b) => b.total - a.total).forEach(r => {
        resultMsg += `${r.name}: Predicted ${r.predicted}, Won ${r.won}, +${r.points} pts (Total: ${r.total})\n`;
    });
    
    addChatMessage('System', resultMsg);
    
    // Check for winner
    const winner = results.find(r => r.total >= WINNING_SCORE);
    if (winner) {
        addChatMessage('System', `🎉 ${winner.name} WINS THE GAME with ${winner.total} points!`);
        setTimeout(() => endGame('completed'), 5000);
    } else {
        // Prepare for next set
        document.getElementById('hostControls').style.display = 'block';
        document.getElementById('hostControls').innerHTML = `
            <button onclick="startNewSet()" class="btn-start">🚀 Start Next Set</button>
        `;
        addChatMessage('System', `Host can start the next set!`);
    }
}

// ==========================================
// UI RENDERING
// ==========================================

function renderHand(cards) {
    const container = document.querySelector('.hand-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (currentPhase === 'bidding') {
        container.innerHTML = `
            <div class="bidding-panel">
                <h3>How many rounds will you win?</h3>
                <div class="bid-buttons">
                    ${Array.from({length: cardsPerPlayer + 1}, (_, i) => 
                        `<button onclick="submitBid(${i})" class="btn-bid">${i}</button>`
                    ).join('')}
                </div>
            </div>
        `;
        return;
    }
    
    if (currentPhase === 'triunfo' && triunfoCard) {
        container.innerHTML = `
            <div class="triunfo-reveal">
                <h2>👑 EL TRIUNFO 👑</h2>
                <div class="game-card triunfo">
                    <div class="card-header">${triunfoCard.name}</div>
                    <div class="card-stats">
                        ${ATTRIBUTES.map(attr => `
                            <div class="stat triunfo-stat">
                                <span class="stat-label">${ATTRIBUTE_NAMES[attr]}</span>
                                <span class="stat-value">99</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
        return;
    }
    
    // Playing phase - show cards
    cards.forEach((card) => {
        const isTriunfo = triunfoCard && card.id === triunfoCard.id;
        const cardEl = document.createElement('div');
        cardEl.className = `game-card ${isTriunfo ? 'triunfo-card' : ''}`;
        
        let statsHtml = '';
        if (currentAttribute) {
            // Show only the selected attribute highlighted
            statsHtml = `
                <div class="selected-attribute">
                    <span class="attr-name">${ATTRIBUTE_NAMES[currentAttribute]}</span>
                    <span class="attr-value">${isTriunfo ? 99 : card[currentAttribute]}</span>
                </div>
                <button onclick="playCard(${card.id})" class="btn-play">PLAY</button>
            `;
        } else {
            // Show all attributes (for attribute selector)
            statsHtml = ATTRIBUTES.map(attr => `
                <div class="stat" onclick="selectAndPlay('${attr}', ${card.id})">
                    <span class="stat-label">${ATTRIBUTE_NAMES[attr]}</span>
                    <span class="stat-value">${isTriunfo ? 99 : card[attr]}</span>
                </div>
            `).join('');
        }
        
        cardEl.innerHTML = `
            <div class="card-header">${card.name} ${isTriunfo ? '👑' : ''}</div>
            <div class="card-stats ${currentAttribute ? 'single' : ''}">
                ${statsHtml}
            </div>
        `;
        container.appendChild(cardEl);
    });
}

async function selectAndPlay(attribute, cardId) {
    // If I'm the attribute selector, select attribute first
    const { data: turnOrder } = await supabaseClient
        .from('turn_order')
        .select('*')
        .eq('room_id', roomId)
        .order('position');
    
    const currentTurnIdx = (currentRoom.current_turn - 1) % players.length;
    const selector = turnOrder[currentTurnIdx];
    
    if (selector.player_id === playerId && !currentAttribute) {
        await selectAttribute(attribute);
        setTimeout(() => playCard(cardId), 500);
    } else {
        playCard(cardId);
    }
}

function updateGameUI() {
    const status = document.getElementById('gameStatus');
    if (!status) return;
    
    switch(currentPhase) {
        case 'bidding':
            status.textContent = 'Place your bid! How many rounds will you win?';
            status.style.color = '#ffd700';
            break;
        case 'triunfo':
            status.textContent = 'El Triunfo revealed!';
            status.style.color = '#ff6b6b';
            break;
        case 'playing':
            if (currentAttribute) {
                status.textContent = `Playing: ${ATTRIBUTE_NAMES[currentAttribute]} | Turn ${currentRoom.current_turn}`;
            } else {
                const { data: turnOrder } = supabaseClient
                    .from('turn_order')
                    .select('*, players(*)')
                    .eq('room_id', roomId)
                    .eq('position', (currentRoom.current_turn - 1) % players.length)
                    .single().then(({ data }) => {
                        if (data) {
                            status.textContent = `${data.players.name} selects attribute...`;
                        }
                    });
            }
            status.style.color = '#48bb78';
            break;
        case 'scoring':
            status.textContent = 'Scoring...';
            status.style.color = '#4299e1';
            break;
    }
    
    // Update scores display
    updateScoreboard();
}

function updateScoreboard() {
    const scoreDiv = document.getElementById('scoreboard');
    if (!scoreDiv) return;
    
    let html = '<h3>Scores</h3>';
    players.sort((a, b) => (b.total_score || 0) - (a.total_score || 0));
    players.forEach(p => {
        html += `
            <div class="score-row">
                <span>${p.name}</span>
                <span>${p.total_score || 0} pts</span>
                ${p.predicted_rounds !== null ? `(Bid: ${p.predicted_rounds})` : ''}
            </div>
        `;
    });
    scoreDiv.innerHTML = html;
}

// ==========================================
// CHAT & UTILITIES (same as before)
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
    
    input.value = '';
    addChatMessage('You', message, true);
    
    await supabaseClient
        .from('chat_messages')
        .insert({
            room_id: roomId,
            player_id: playerId,
            player_name: currentPlayer,
            message: message
        });
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
// REALTIME & SYNC
// ==========================================

function setupRealtimeSubscription() {
    subscription = supabaseClient
        .channel(`room:${roomId}`)
        .on('postgres_changes', 
            { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` },
            async (payload) => {
                await updatePlayerList();
                
                if (payload.eventType === 'INSERT') {
                    addLog(`${payload.new.name} joined`);
                    addChatMessage('System', `${payload.new.name} joined the table`);
                } else if (payload.eventType === 'DELETE') {
                    const playerName = payload.old?.name || 'A player';
                    addLog(`${playerName} left`);
                    addChatMessage('System', `${playerName} left the table`);
                } else if (payload.eventType === 'UPDATE') {
                    // Update scores
                    const idx = players.findIndex(p => p.id === payload.new.id);
                    if (idx >= 0) players[idx] = payload.new;
                    updateScoreboard();
                }
            }
        )
        .on('postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
            async (payload) => {
                currentRoom = payload.new;
                currentPhase = payload.new.phase;
                currentAttribute = payload.new.current_attribute;
                triunfoCard = payload.new.triunfo_card_id;
                
                if (payload.old.status === 'waiting' && payload.new.status === 'playing') {
                    isGameActive = true;
                    cardsPerPlayer = CARD_DISTRIBUTION[players.length] || 8;
                    await loadMyHand();
                    updateGameUI();
                }
                
                if (payload.new.phase !== payload.old.phase) {
                    await loadGameState();
                    renderHand(myHand);
                    updateGameUI();
                }
                
                if (payload.new.status === 'ended') {
                    endGame(payload.new.ended_reason);
                }
            }
        )
        .subscribe();
}

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
            if (p.id === currentRoom?.host_id) badges += '<span class="host">👑</span>';
            if (p.id === playerId) badges += '<span class="you">YOU</span>';
            if (p.has_bid) badges += '<span class="bid">✓</span>';
            
            li.innerHTML = `<span>${p.name} (${p.total_score || 0}pts)</span><div>${badges}</div>`;
            ul.appendChild(li);
        });
    }
}

// ==========================================
// SAFETY & CLEANUP
// ==========================================

function startGameLoop() {
    heartbeatInterval = setInterval(async () => {
        await supabaseClient
            .from('players')
            .update({ last_seen: new Date().toISOString() })
            .eq('id', playerId);
    }, 3000);
}

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
    localStorage.clear();
    window.location.href = 'index.html';
}

async function leaveGame() {
    if (gameLoop) clearInterval(gameLoop);
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (subscription) await subscription.unsubscribe();
    if (chatSubscription) await chatSubscription.unsubscribe();
    
    await supabaseClient.from('players').delete().eq('id', playerId);
    redirectToLobby();
}

window.addEventListener('beforeunload', async () => {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    await supabaseClient.from('players').delete().eq('id', playerId);
});