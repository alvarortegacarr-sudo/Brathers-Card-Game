// ==========================================
// EL TRIUNFO CARD GAME - POLISHED VERSION
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
let heartbeatInterval = null;
let isGameActive = false;
let currentPhase = 'waiting';
let myPosition = 0;
let triunfoCard = null;
let currentAttribute = null;
let cardsPerPlayer = 0;
let hasBidded = false;
let myTurnOrder = null;

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

    try {
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
        startHeartbeat();
        
        if (room.status === 'playing') {
            isGameActive = true;
            currentPhase = room.phase || 'bidding';
            cardsPerPlayer = CARD_DISTRIBUTION[players.length] || 8;
            await loadGameState();
        }
        
        addLog('Connected to El Triunfo');
        addChatMessage('System', '🎴 Welcome to El Triunfo! Bid wisely, play smartly!');
    } catch (err) {
        console.error('Initialization error:', err);
        redirectToLobby('Failed to initialize game');
    }
});

function setupUI() {
    const roomCode = localStorage.getItem('currentRoom');
    document.getElementById('displayCode').textContent = `ROOM: ${roomCode}`;
    updateHostControls();
}

function updateHostControls() {
    const hostControls = document.getElementById('hostControls');
    if (!hostControls) return;
    
    const isHost = localStorage.getItem('isHost') === 'true';
    
    if (isGameActive || (currentRoom && currentRoom.status === 'playing')) {
        hostControls.style.display = 'none';
        return;
    }
    
    if (isHost) {
        hostControls.style.display = 'block';
        const count = players.length || 1;
        hostControls.innerHTML = `
            <button onclick="startNewSet()" class="btn-start">
                🚀 Start Game (${count} player${count !== 1 ? 's' : ''})
            </button>
        `;
    } else {
        hostControls.style.display = 'none';
    }
}

function setupChatInput() {
    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendChatMessage();
        });
    }
}

// ==========================================
// GAME FLOW
// ==========================================

async function startNewSet() {
    if (players.length < 2) {
        alert('Need at least 2 players to start!');
        return;
    }

    const hostControls = document.getElementById('hostControls');
    if (hostControls) hostControls.style.display = 'none';

    try {
        // Clean up previous game data
        await supabaseClient.from('player_hands').delete().eq('room_id', roomId);
        await supabaseClient.from('current_turn_plays').delete().eq('room_id', roomId);
        await supabaseClient.from('turn_order').delete().eq('room_id', roomId);
        
        // Reset player stats
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
        
        // Create turn order
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

        // Start game
        await supabaseClient
            .from('rooms')
            .update({
                status: 'playing',
                phase: 'bidding',
                current_set: (currentRoom.current_set || 0) + 1,
                current_turn: 0,
                triunfo_card_id: null,
                current_attribute: null
            })
            .eq('id', roomId);

        addChatMessage('System', `🎴 Set ${(currentRoom.current_set || 0) + 1} started! ${cardsPerPlayer} cards dealt.`);
    } catch (err) {
        console.error('Start game error:', err);
        alert('Failed to start game');
    }
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
                    card_id: card.id,
                    played: false
                });
        }
    }
    
    addChatMessage('System', `📦 ${cardsPerPlayer} cards dealt to each player!`);
}

async function loadMyHand() {
    try {
        const { data: hand, error } = await supabaseClient
            .from('player_hands')
            .select('*, cards(*)')
            .eq('room_id', roomId)
            .eq('player_id', playerId)
            .eq('played', false);
        
        if (error) {
            console.error('Load hand error:', error);
            return;
        }
        
        if (hand) {
            myHand = hand.map(h => ({ ...h.cards, hand_id: h.id }));
            renderHand(myHand);
        }
    } catch (err) {
        console.error('Load hand exception:', err);
    }
}

async function loadGameState() {
    try {
        const { data: room } = await supabaseClient
            .from('rooms')
            .select('*, triunfo:cards!triunfo_card_id(*)')
            .eq('id', roomId)
            .single();
        
        if (room) {
            currentPhase = room.phase;
            triunfoCard = room.triunfo;
            currentAttribute = room.current_attribute;
            currentRoom = room;
            
            const { data: me } = await supabaseClient
                .from('players')
                .select('has_bid, predicted_rounds')
                .eq('id', playerId)
                .single();
            
            hasBidded = me?.has_bid || false;
            
            const { data: turnOrder } = await supabaseClient
                .from('turn_order')
                .select('*')
                .eq('room_id', roomId)
                .order('position');
            
            if (turnOrder) {
                myTurnOrder = turnOrder.find(t => t.player_id === playerId);
                myPosition = myTurnOrder ? myTurnOrder.position : 0;
            }
            
            // Load hand if we haven't yet
            if (myHand.length === 0) {
                await loadMyHand();
            } else {
                renderHand(myHand);
            }
            
            updateGameUI();
        }
    } catch (err) {
        console.error('Load game state error:', err);
    }
}

// ==========================================
// BIDDING PHASE
// ==========================================

async function submitBid(bid) {
    if (currentPhase !== 'bidding') return;
    if (hasBidded) return;
    
    try {
        await supabaseClient
            .from('players')
            .update({ 
                predicted_rounds: bid, 
                has_bid: true 
            })
            .eq('id', playerId);
        
        hasBidded = true;
        addChatMessage('System', `You bid ${bid} rounds!`);
        
        // Check if all players have bid
        const { data: allPlayers } = await supabaseClient
            .from('players')
            .select('*')
            .eq('room_id', roomId);
        
        const allBidded = allPlayers.every(p => p.has_bid);
        
        if (allBidded) {
            await revealTriunfo();
        } else {
            renderHand(myHand);
        }
    } catch (err) {
        console.error('Submit bid error:', err);
    }
}

async function revealTriunfo() {
    try {
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
    } catch (err) {
        console.error('Reveal triunfo error:', err);
    }
}

// ==========================================
// PLAYING PHASE
// ==========================================

async function selectAttribute(attribute) {
    if (currentPhase !== 'playing') return;
    
    try {
        const { data: turnOrder } = await supabaseClient
            .from('turn_order')
            .select('*, players(*)')
            .eq('room_id', roomId)
            .order('position');
        
        const currentTurnIdx = (currentRoom.current_turn - 1) % players.length;
        const selector = turnOrder[currentTurnIdx];
        
        if (selector.player_id !== playerId) {
            alert('Not your turn to select attribute!');
            return;
        }
        
        currentAttribute = attribute;
        
        await supabaseClient
            .from('rooms')
            .update({ current_attribute: attribute })
            .eq('id', roomId);
        
        addChatMessage('System', `${currentPlayer} selected ${ATTRIBUTE_NAMES[attribute]}!`);
    } catch (err) {
        console.error('Select attribute error:', err);
    }
}

async function playCard(cardId) {
    if (currentPhase !== 'playing') return;
    if (!currentAttribute) {
        alert('Wait for attribute to be selected!');
        return;
    }
    
    const card = myHand.find(c => c.id === cardId);
    if (!card) return;
    
    try {
        const { data: currentPlays } = await supabaseClient
            .from('current_turn_plays')
            .select('*')
            .eq('room_id', roomId);
        
        const { data: turnOrder } = await supabaseClient
            .from('turn_order')
            .select('*')
            .eq('room_id', roomId)
            .order('position');
        
        const playsThisRound = currentPlays ? currentPlays.length : 0;
        const expectedPlayerIndex = playsThisRound;
        const expectedPlayer = turnOrder[expectedPlayerIndex % players.length];
        
        if (expectedPlayer.player_id !== playerId) {
            alert('Wait for your turn!');
            return;
        }
        
        let value = card[currentAttribute];
        if (triunfoCard && card.id === triunfoCard.id) {
            value = 99;
        }
        
        await supabaseClient
            .from('current_turn_plays')
            .insert({
                room_id: roomId,
                player_id: playerId,
                card_id: cardId,
                attribute: currentAttribute,
                value: value
            });
        
        await supabaseClient
            .from('player_hands')
            .update({ played: true })
            .eq('room_id', roomId)
            .eq('player_id', playerId)
            .eq('card_id', cardId);
        
        myHand = myHand.filter(c => c.id !== cardId);
        renderHand(myHand);
        
        const cardName = card.id === triunfoCard?.id ? `${card.name} 👑` : card.name;
        addChatMessage('System', `${currentPlayer} played ${cardName} (${value} ${ATTRIBUTE_NAMES[currentAttribute]})`);
        
        if (playsThisRound + 1 >= players.length) {
            setTimeout(resolveTurn, 1500);
        }
    } catch (err) {
        console.error('Play card error:', err);
    }
}

async function resolveTurn() {
    try {
        const { data: plays } = await supabaseClient
            .from('current_turn_plays')
            .select('*, players(*), cards(*)')
            .eq('room_id', roomId)
            .order('played_at', { ascending: false })
            .limit(players.length);
        
        if (!plays || plays.length < players.length) return;
        
        const winner = plays.reduce((max, play) => 
            play.value > max.value ? play : max
        );
        
        await supabaseClient
            .from('players')
            .update({ won_rounds: winner.players.won_rounds + 1 })
            .eq('id', winner.player_id);
        
        const winCardName = winner.cards.id === triunfoCard?.id ? 
            `${winner.cards.name} 👑` : winner.cards.name;
        
        addChatMessage('System', `🏆 ${winner.players.name} wins with ${winCardName}!`);
        
        await supabaseClient.from('current_turn_plays').delete().eq('room_id', roomId);
        
        const { data: remainingCards } = await supabaseClient
            .from('player_hands')
            .select('*')
            .eq('room_id', roomId)
            .eq('played', false);
        
        if (!remainingCards || remainingCards.length === 0) {
            await endSet();
        } else {
            const nextTurn = (currentRoom.current_turn || 0) + 1;
            await supabaseClient
                .from('rooms')
                .update({
                    current_turn: nextTurn,
                    current_attribute: null
                })
                .eq('id', roomId);
        }
    } catch (err) {
        console.error('Resolve turn error:', err);
    }
}

// ==========================================
// SCORING
// ==========================================

async function endSet() {
    currentPhase = 'scoring';
    
    try {
        await supabaseClient.from('rooms').update({ phase: 'scoring' }).eq('id', roomId);
        
        const { data: finalPlayers } = await supabaseClient
            .from('players')
            .select('*')
            .eq('room_id', roomId);
        
        let results = [];
        
        for (const player of finalPlayers) {
            const predicted = player.predicted_rounds || 0;
            const won = player.won_rounds || 0;
            
            let points = won * 2;
            if (predicted === won) {
                points += 3;
            } else {
                points -= 2;
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
        
        results.sort((a, b) => b.total - a.total);
        
        let resultMsg = '📊 SET RESULTS:\n';
        results.forEach(r => {
            const status = r.predicted === r.won ? '✓' : '✗';
            resultMsg += `${r.name}: ${r.points > 0 ? '+' : ''}${r.points}pts (Total: ${r.total}) ${status}\n`;
        });
        
        addChatMessage('System', resultMsg);
        
        const winner = results.find(r => r.total >= WINNING_SCORE);
        if (winner) {
            addChatMessage('System', `🎉 ${winner.name} WINS THE GAME!`);
            setTimeout(() => endGame('completed'), 5000);
        } else {
            const isHost = localStorage.getItem('isHost') === 'true';
            const hostControls = document.getElementById('hostControls');
            if (isHost && hostControls) {
                hostControls.style.display = 'block';
                hostControls.innerHTML = `<button onclick="startNewSet()" class="btn-start">🚀 Next Set</button>`;
            }
            addChatMessage('System', `Host can start the next set!`);
        }
    } catch (err) {
        console.error('End set error:', err);
    }
}

// ==========================================
// UI RENDERING
// ==========================================

function renderHand(cards) {
    const container = document.getElementById('handContainer');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (currentPhase === 'waiting') {
        container.innerHTML = '<div class="waiting-message">Waiting for host to start...</div>';
        return;
    }
    
    if (currentPhase === 'bidding') {
        renderBiddingPhase(container, cards);
        return;
    }
    
    if (currentPhase === 'triunfo') {
        renderTriunfoPhase(container);
        return;
    }
    
    if (currentPhase === 'playing') {
        renderPlayingPhase(container, cards);
        return;
    }
    
    if (currentPhase === 'scoring') {
        container.innerHTML = '<div class="waiting-message">Calculating scores...</div>';
    }
}

function renderBiddingPhase(container, cards) {
    if (!hasBidded) {
        // Show cards preview
        const previewDiv = document.createElement('div');
        previewDiv.className = 'my-cards-preview';
        previewDiv.innerHTML = '<h3 style="color: var(--accent-gold); margin-bottom: 15px;">Your Cards</h3>';
        
        const cardsGrid = document.createElement('div');
        cardsGrid.style.cssText = 'display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-bottom: 20px;';
        
        cards.forEach(card => {
            const miniCard = document.createElement('div');
            miniCard.className = 'mini-card';
            miniCard.innerHTML = `
                <div style="font-weight: bold; color: var(--accent-gold); font-size: 0.8rem;">${card.name}</div>
                <div style="font-size: 0.65rem; color: var(--text-secondary);">
                    C:${card.car} U:${card.cul} T:${card.tet} F:${card.fis} P:${card.per}
                </div>
            `;
            cardsGrid.appendChild(miniCard);
        });
        
        previewDiv.appendChild(cardsGrid);
        container.appendChild(previewDiv);
        
        // Bidding interface
        const bidDiv = document.createElement('div');
        bidDiv.className = 'bidding-panel';
        bidDiv.innerHTML = `
            <h2>How many rounds will you win?</h2>
            <p>Look at your cards and predict!</p>
            <div class="bid-buttons">
                ${Array.from({length: cardsPerPlayer + 1}, (_, i) => 
                    `<button onclick="submitBid(${i})" class="btn-bid">${i}</button>`
                ).join('')}
            </div>
        `;
        container.appendChild(bidDiv);
    } else {
        container.innerHTML = `
            <div class="waiting-panel">
                <h2>Bid placed!</h2>
                <p>Waiting for other players...</p>
                <div class="spinner"></div>
            </div>
        `;
    }
}

function renderTriunfoPhase(container) {
    if (!triunfoCard) {
        container.innerHTML = '<div class="waiting-message">Revealing El Triunfo...</div>';
        return;
    }
    
    container.innerHTML = `
        <div class="triunfo-reveal">
            <h2 style="color: var(--accent-gold); margin-bottom: 20px;">👑 EL TRIUNFO 👑</h2>
            <div class="game-card triunfo" style="margin: 0 auto; transform: scale(1.1);">
                <div class="card-header">${triunfoCard.name}</div>
                <div class="card-stats">
                    ${ATTRIBUTES.map(attr => `
                        <div class="stat">
                            <span class="stat-label">${ATTRIBUTE_NAMES[attr]}</span>
                            <span class="stat-value" style="color: var(--accent-gold);">99</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            <p style="color: var(--accent-gold); margin-top: 20px;">Game starts in 3 seconds...</p>
        </div>
    `;
}

function renderPlayingPhase(container, cards) {
    const isMyTurnToSelect = checkIfMyTurnToSelect();
    
    if (isMyTurnToSelect && !currentAttribute) {
        const selectorDiv = document.createElement('div');
        selectorDiv.className = 'attribute-selector';
        selectorDiv.innerHTML = `
            <h3>Select an Attribute!</h3>
            <div class="attribute-buttons">
                ${ATTRIBUTES.map(attr => `
                    <button onclick="selectAttribute('${attr}')" class="btn-attribute ${attr}">
                        ${ATTRIBUTE_NAMES[attr]}
                    </button>
                `).join('')}
            </div>
        `;
        container.appendChild(selectorDiv);
    }
    
    if (currentAttribute) {
        const attrDiv = document.createElement('div');
        attrDiv.style.cssText = 'text-align: center; padding: 15px; background: rgba(255,215,0,0.1); border: 2px solid var(--accent-gold); border-radius: 10px; margin-bottom: 15px;';
        attrDiv.innerHTML = `
            <div style="font-size: 1.3rem; color: var(--accent-gold); font-weight: bold;">
                Playing: ${ATTRIBUTE_NAMES[currentAttribute]}
            </div>
            <div style="color: var(--text-secondary); font-size: 0.9rem; margin-top: 5px;">
                Double-click card to play
            </div>
        `;
        container.appendChild(attrDiv);
    }
    
    const cardsGrid = document.createElement('div');
    cardsGrid.className = 'cards-grid';
    cardsGrid.style.cssText = 'display: flex; flex-wrap: wrap; gap: 15px; justify-content: center;';
    
    cards.forEach((card) => {
        const isTriunfo = triunfoCard && card.id === triunfoCard.id;
        const cardEl = document.createElement('div');
        cardEl.className = `game-card ${isTriunfo ? 'triunfo' : ''}`;
        
        cardEl.ondblclick = () => playCard(card.id);
        cardEl.onmouseenter = () => cardEl.style.transform = 'scale(1.05) translateY(-5px)';
        cardEl.onmouseleave = () => cardEl.style.transform = 'scale(1)';
        
        let statsHtml = '';
        if (currentAttribute) {
            const value = isTriunfo ? 99 : card[currentAttribute];
            statsHtml = `
                <div style="text-align: center; padding: 20px 10px;">
                    <div style="font-size: 2.5rem; color: var(--accent-gold); font-weight: bold;">${value}</div>
                    <div style="color: var(--text-secondary); font-size: 0.9rem;">${ATTRIBUTE_NAMES[currentAttribute]}</div>
                </div>
            `;
        } else {
            statsHtml = `
                <div class="card-stats">
                    ${ATTRIBUTES.map(attr => `
                        <div class="stat">
                            <span class="stat-label">${ATTRIBUTE_NAMES[attr]}</span>
                            <span class="stat-value" style="${isTriunfo ? 'color: var(--accent-gold);' : ''}">
                                ${isTriunfo ? 99 : card[attr]}
                            </span>
                        </div>
                    `).join('')}
                </div>
            `;
        }
        
        cardEl.innerHTML = `
            <div class="card-header">${card.name} ${isTriunfo ? '👑' : ''}</div>
            ${statsHtml}
        `;
        cardsGrid.appendChild(cardEl);
    });
    
    container.appendChild(cardsGrid);
}

function checkIfMyTurnToSelect() {
    if (!currentRoom || !currentRoom.current_turn) return false;
    const currentTurnIdx = (currentRoom.current_turn - 1) % players.length;
    return currentTurnIdx === myPosition;
}

function updateGameUI() {
    const phaseIndicator = document.getElementById('phaseIndicator');
    const turnInfo = document.getElementById('turnInfo');
    const triunfoDisplay = document.getElementById('triunfoDisplay');
    
    if (phaseIndicator) {
        switch(currentPhase) {
            case 'waiting':
                phaseIndicator.textContent = 'Waiting for host...';
                phaseIndicator.style.color = '#ecc94b';
                break;
            case 'bidding':
                phaseIndicator.textContent = hasBidded ? 'Bid placed!' : 'Place your bid!';
                phaseIndicator.style.color = hasBidded ? '#48bb78' : '#ffd700';
                break;
            case 'triunfo':
                phaseIndicator.textContent = 'El Triunfo revealed!';
                phaseIndicator.style.color = '#ff6b6b';
                break;
            case 'playing':
                phaseIndicator.textContent = currentAttribute ? 
                    `Playing: ${ATTRIBUTE_NAMES[currentAttribute]}` : 'Select attribute!';
                phaseIndicator.style.color = currentAttribute ? '#48bb78' : '#ffd700';
                break;
            case 'scoring':
                phaseIndicator.textContent = 'Scoring...';
                phaseIndicator.style.color = '#4299e1';
                break;
        }
    }
    
    if (turnInfo) {
        if (currentPhase === 'playing') {
            turnInfo.textContent = `Turn ${currentRoom.current_turn || 1}`;
        } else {
            turnInfo.textContent = currentPhase.charAt(0).toUpperCase() + currentPhase.slice(1);
        }
    }
    
    if (triunfoDisplay && triunfoCard) {
        const isTriunfo = triunfoCard.id === triunfoCard.id;
        triunfoDisplay.innerHTML = `
            <div class="game-card triunfo" style="width: 100%; height: 100%; transform: scale(0.8);">
                <div class="card-header" style="font-size: 0.7rem;">${triunfoCard.name}</div>
                <div style="font-size: 1.5rem; text-align: center;">👑</div>
            </div>
        `;
    }
    
    updateScoreboard();
}

function updateScoreboard() {
    const scoreDiv = document.getElementById('scoreboard');
    if (!scoreDiv) return;
    
    const sortedPlayers = [...players].sort((a, b) => (b.total_score || 0) - (a.total_score || 0));
    
    let html = '<h3>Scores</h3>';
    sortedPlayers.forEach(p => {
        const isMe = p.id === playerId;
        const bidInfo = p.has_bid ? `(Bid: ${p.predicted_rounds !== null ? p.predicted_rounds : '?'})` : '';
        const wonInfo = isGameActive ? `Won: ${p.won_rounds || 0}` : '';
        
        html += `
            <div class="score-row" style="${isMe ? 'background: rgba(72, 187, 120, 0.2); border-radius: 4px; padding: 4px 8px;' : ''}">
                <span>${p.name} ${isMe ? '(You)' : ''}</span>
                <span>${p.total_score || 0}pts ${bidInfo} ${wonInfo}</span>
            </div>
        `;
    });
    
    scoreDiv.innerHTML = html;
    
    // Update player count
    const countEl = document.getElementById('playerCount');
    if (countEl) countEl.textContent = players.length;
}

// ==========================================
// CHAT & UTILITIES
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
    
    entry.className = `chat-entry ${sender === 'System' ? 'system' : ''}`;
    entry.innerHTML = `
        <span class="time">[${time}]</span>
        <span class="sender">${escapeHtml(sender)}:</span>
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

// ==========================================
// REALTIME & SYNC
// ==========================================

function setupRealtimeSubscription() {
    subscription = supabaseClient
        .channel(`room:${roomId}`)
        .on('postgres_changes', 
            { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` },
            async (payload) => {
                if (payload.eventType === 'UPDATE') {
                    const idx = players.findIndex(p => p.id === payload.new.id);
                    if (idx >= 0) players[idx] = payload.new;
                } else if (payload.eventType === 'INSERT') {
                    players.push(payload.new);
                } else if (payload.eventType === 'DELETE') {
                    players = players.filter(p => p.id !== payload.old.id);
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
            { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
            async (payload) => {
                currentRoom = payload.new;
                currentPhase = payload.new.phase;
                currentAttribute = payload.new.current_attribute;
                
                if (payload.old.status === 'waiting' && payload.new.status === 'playing') {
                    isGameActive = true;
                    cardsPerPlayer = CARD_DISTRIBUTION[players.length] || 8;
                    hasBidded = false;
                    myHand = [];
                    await loadGameState();
                }
                
                if (payload.new.phase !== payload.old.phase) {
                    await loadGameState();
                }
                
                if (payload.new.triunfo_card_id && payload.new.triunfo_card_id !== triunfoCard?.id) {
                    const { data: card } = await supabaseClient
                        .from('cards')
                        .select('*')
                        .eq('id', payload.new.triunfo_card_id)
                        .single();
                    triunfoCard = card;
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
    players = playersData || [];
    
    document.querySelectorAll('.seat').forEach(seat => {
        const seatNum = parseInt(seat.id.split('-')[1]);
        const player = players.find(p => p.seat_number === seatNum);
        const slot = seat.querySelector('.player-slot');
        
        if (player && slot) {
            slot.classList.remove('empty');
            slot.classList.add('active');
            slot.querySelector('.avatar').textContent = player.name.charAt(0).toUpperCase();
            slot.querySelector('.name').textContent = player.name;
            slot.style.borderColor = player.id === playerId ? '#48bb78' : 'rgba(255,255,255,0.1)';
        } else if (slot) {
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
            
            li.innerHTML = `<span>${p.name}</span><div>${badges}</div>`;
            ul.appendChild(li);
        });
    }
    
    updateScoreboard();
}

// ==========================================
// SAFETY & CLEANUP
// ==========================================

function startHeartbeat() {
    heartbeatInterval = setInterval(async () => {
        await supabaseClient
            .from('players')
            .update({ last_seen: new Date().toISOString() })
            .eq('id', playerId);
    }, 5000);
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
    navigator.clipboard.writeText(code).then(() => {
        addChatMessage('System', 'Room code copied to clipboard!');
    });
}

function redirectToLobby(message) {
    if (message) alert(message);
    localStorage.removeItem('currentRoom');
    localStorage.removeItem('currentPlayer');
    localStorage.removeItem('isHost');
    window.location.href = 'index.html';
}

async function leaveGame() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (subscription) await subscription.unsubscribe();
    if (chatSubscription) await chatSubscription.unsubscribe();
    
    await supabaseClient.from('players').delete().eq('id', playerId);
    redirectToLobby();
}

function endGame(reason) {
    isGameActive = false;
    setTimeout(() => {
        redirectToLobby(reason === 'completed' ? 'Game completed!' : 'Game ended');
    }, 3000);
}

window.addEventListener('beforeunload', async () => {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    await supabaseClient.from('players').delete().eq('id', playerId);
});