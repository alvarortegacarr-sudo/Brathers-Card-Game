// ==========================================
// EL TRIUNFO CARD GAME - FIXED HOST VERSION
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
let currentPhase = 'waiting';
let myPosition = 0;
let triunfoCard = null;
let currentAttribute = null;
let cardsPerPlayer = 0;
let hasBidded = false;

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
    document.getElementById('displayCode').textContent = `ROOM: ${roomCode}`;
    
    // Show host controls immediately if I'm host (don't wait for currentRoom)
    const isHost = localStorage.getItem('isHost') === 'true';
    const hostControls = document.getElementById('hostControls');
    
    if (hostControls && isHost) {
        hostControls.style.display = 'block';
        hostControls.innerHTML = `
            <button onclick="startNewSet()" class="btn-start">
                🚀 Start Game (1 player)
            </button>
        `;
    }
}

function updateHostControls() {
    const hostControls = document.getElementById('hostControls');
    if (!hostControls) return;
    
    const isHost = localStorage.getItem('isHost') === 'true';
    
    // Only hide if game started, otherwise show with updated count
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
    }
}

function updateHostControls() {
    const hostControls = document.getElementById('hostControls');
    if (!hostControls) return;
    
    const isHost = localStorage.getItem('isHost') === 'true';
    
    // Only hide if game started, otherwise show with updated count
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
        alert('Need at least 2 players to start!');
        return;
    }

    // Hide host controls
    const hostControls = document.getElementById('hostControls');
    if (hostControls) hostControls.style.display = 'none';

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

    // Deal cards first
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

    // Start bidding phase AFTER cards are dealt
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

    addChatMessage('System', `🎴 Set ${(currentRoom.current_set || 0) + 1} started! ${cardsPerPlayer} cards dealt.`);
    addChatMessage('System', `Place your bids! How many rounds will you win?`);
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
    
    // Load my hand immediately so I can see cards before bidding
    await loadMyHand();
    renderHand(myHand);
    
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
    if (hasBidded) return;
    
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
        renderHand(myHand); // Refresh to show "waiting for others"
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
    
    addChatMessage('System', `${currentPlayer} selected ${ATTRIBUTE_NAMES[attribute]}! Everyone play a card!`);
    renderHand(myHand); // Refresh to show play button
}

async function playCard(cardId) {
    if (currentPhase !== 'playing') return;
    if (!currentAttribute) {
        // If no attribute selected and it's my turn to select, show error
        const { data: turnOrder } = await supabaseClient
            .from('turn_order')
            .select('*')
            .eq('room_id', roomId)
            .order('position');
        
        const currentTurnIdx = (currentRoom.current_turn - 1) % players.length;
        const selector = turnOrder[currentTurnIdx];
        
        if (selector.player_id === playerId) {
            alert('Select an attribute first by clicking on it!');
        } else {
            alert('Wait for ' + ATTRIBUTE_NAMES[currentAttribute] + ' to be selected!');
        }
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
    
    const playsThisRound = currentPlays ? currentPlays.length : 0;
    const expectedPlayerIndex = playsThisRound;
    const expectedPlayer = turnOrder[expectedPlayerIndex % players.length];
    
    if (expectedPlayer.player_id !== playerId) {
        alert(`Wait for your turn!`);
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
    
    const cardName = card.id === triunfoCard?.id ? `${card.name} 👑` : card.name;
    addChatMessage('System', `${currentPlayer} played ${cardName} (${value} ${ATTRIBUTE_NAMES[currentAttribute]})`);
    
    // Check if turn is complete
    if (playsThisRound + 1 >= players.length) {
        setTimeout(resolveTurn, 1500);
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
    
    const winCardName = winner.cards.id === triunfoCard?.id ? 
        `${winner.cards.name} 👑` : winner.cards.name;
    
    addChatMessage('System', `🏆 ${winner.players.name} wins with ${winCardName} (${winner.value} ${ATTRIBUTE_NAMES[winner.attribute]})!`);
    
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
        const status = r.predicted === r.won ? '✓' : '✗';
        resultMsg += `${r.name}: Bid ${r.predicted}, Won ${r.won} ${status}, ${r.points > 0 ? '+' : ''}${r.points}pts (Total: ${r.total})\n`;
    });
    
    addChatMessage('System', resultMsg);
    
    // Check for winner
    const winner = results.find(r => r.total >= WINNING_SCORE);
    if (winner) {
        addChatMessage('System', `🎉 ${winner.name} WINS THE GAME with ${winner.total} points!`);
        setTimeout(() => endGame('completed'), 5000);
    } else {
        // Prepare for next set - ONLY original host can start next set
        const isHost = localStorage.getItem('isHost') === 'true';
        const hostControls = document.getElementById('hostControls');
        if (isHost && hostControls) {
            hostControls.style.display = 'block';
            hostControls.innerHTML = `<button onclick="startNewSet()" class="btn-start">🚀 Start Next Set</button>`;
        }
        addChatMessage('System', `Next set ready! Host can start when ready.`);
    }
}

// ==========================================
// UI RENDERING
// ==========================================

function renderHand(cards) {
    const container = document.querySelector('.hand-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    // BIDDING PHASE - Show cards AND bidding interface
    if (currentPhase === 'bidding') {
        if (!hasBidded) {
            // Show cards first
            const cardsDiv = document.createElement('div');
            cardsDiv.className = 'my-cards-preview';
            cardsDiv.innerHTML = '<h3 style="color: #ffd700; margin-bottom: 10px;">Your Cards:</h3>';
            
            const cardsGrid = document.createElement('div');
            cardsGrid.style.cssText = 'display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-bottom: 30px;';
            
            cards.forEach(card => {
                const miniCard = document.createElement('div');
                miniCard.className = 'mini-card';
                miniCard.innerHTML = `
                    <div style="font-size: 0.8rem; font-weight: bold; color: #ffd700;">${card.name}</div>
                    <div style="font-size: 0.6rem; color: #aaa;">
                        C:${card.car} U:${card.cul} T:${card.tet} F:${card.fis} P:${card.per}
                    </div>
                `;
                cardsGrid.appendChild(miniCard);
            });
            
            cardsDiv.appendChild(cardsGrid);
            container.appendChild(cardsDiv);
            
            // Then show bidding interface
            const bidDiv = document.createElement('div');
            bidDiv.className = 'bidding-panel';
            bidDiv.innerHTML = `
                <h2 style="color: #ffd700; margin-bottom: 20px; font-size: 1.8rem;">How many rounds will you win?</h2>
                <p style="color: #aaa; margin-bottom: 20px;">Look at your cards and make your prediction!</p>
                <div class="bid-buttons">
                    ${Array.from({length: cardsPerPlayer + 1}, (_, i) => 
                        `<button onclick="submitBid(${i})" class="btn-bid">${i}</button>`
                    ).join('')}
                </div>
            `;
            container.appendChild(bidDiv);
        } else {
            // Already bidded, waiting for others
            container.innerHTML = `
                <div class="waiting-panel">
                    <h2 style="color: #48bb78;">Bid placed!</h2>
                    <p>Waiting for other players to bid...</p>
                    <div class="spinner"></div>
                </div>
            `;
        }
        return;
    }
    
    // TRIUNFO PHASE
    if (currentPhase === 'triunfo' && triunfoCard) {
        container.innerHTML = `
            <div class="triunfo-reveal">
                <h2 style="color: #ffd700; font-size: 2.5rem; margin-bottom: 20px;">👑 EL TRIUNFO 👑</h2>
                <div class="game-card triunfo" style="transform: scale(1.2);">
                    <div class="card-header" style="font-size: 1.3rem;">${triunfoCard.name}</div>
                    <div class="card-stats" style="grid-template-columns: repeat(5, 1fr);">
                        ${ATTRIBUTES.map(attr => `
                            <div class="stat triunfo-stat">
                                <span class="stat-label">${ATTRIBUTE_NAMES[attr]}</span>
                                <span class="stat-value" style="color: #ffd700; font-size: 1.5rem;">99</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <p style="color: #ffd700; margin-top: 20px; font-size: 1.2rem;">Game starts in 3 seconds...</p>
            </div>
        `;
        return;
    }
    
    // PLAYING PHASE - Show cards with double-click to play
    if (currentPhase === 'playing') {
        const isMyTurnToSelect = checkIfMyTurnToSelect();
        
        // Show attribute selector if it's my turn
        if (isMyTurnToSelect && !currentAttribute) {
            const selectorDiv = document.createElement('div');
            selectorDiv.className = 'attribute-selector';
            selectorDiv.innerHTML = `
                <h2 style="color: #ffd700; margin-bottom: 20px;">Select an Attribute!</h2>
                <p style="color: #aaa; margin-bottom: 20px;">Choose which stat to compete on this turn</p>
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
        
        // Show current attribute if selected
        if (currentAttribute) {
            const attrDiv = document.createElement('div');
            attrDiv.className = 'current-attribute-banner';
            attrDiv.innerHTML = `
                <h2 style="color: #ffd700; margin: 0;">Playing: ${ATTRIBUTE_NAMES[currentAttribute]}</h2>
                <p style="color: #aaa; margin: 5px 0 0 0;">Double-click a card to play it!</p>
            `;
            container.appendChild(attrDiv);
        }
        
        // Show my cards
        const cardsGrid = document.createElement('div');
        cardsGrid.className = 'cards-grid';
        cardsGrid.style.cssText = 'display: flex; flex-wrap: wrap; gap: 15px; justify-content: center; margin-top: 20px;';
        
        cards.forEach((card) => {
            const isTriunfo = triunfoCard && card.id === triunfoCard.id;
            const cardEl = document.createElement('div');
            cardEl.className = `game-card ${isTriunfo ? 'triunfo-card' : ''}`;
            cardEl.style.cssText = 'width: 140px; cursor: pointer; transition: transform 0.2s; user-select: none;';
            cardEl.ondblclick = () => handleCardDoubleClick(card.id);
            
            // Highlight on hover
            cardEl.onmouseenter = () => cardEl.style.transform = 'scale(1.05)';
            cardEl.onmouseleave = () => cardEl.style.transform = 'scale(1)';
            
            let statsHtml = '';
            if (currentAttribute) {
                const value = isTriunfo ? 99 : card[currentAttribute];
                statsHtml = `
                    <div style="text-align: center; padding: 15px;">
                        <div style="font-size: 2rem; color: #ffd700; font-weight: bold;">${value}</div>
                        <div style="color: #aaa;">${ATTRIBUTE_NAMES[currentAttribute]}</div>
                    </div>
                    <div style="text-align: center; color: #48bb78; font-size: 0.8rem;">Double-click to play</div>
                `;
            } else {
                statsHtml = `
                    <div class="card-stats" style="grid-template-columns: repeat(3, 1fr); gap: 3px;">
                        ${ATTRIBUTES.map(attr => `
                            <div class="stat" style="padding: 5px;">
                                <span class="stat-label" style="font-size: 0.6rem;">${ATTRIBUTE_NAMES[attr]}</span>
                                <span class="stat-value" style="font-size: 0.9rem; ${isTriunfo ? 'color: #ffd700;' : ''}">
                                    ${isTriunfo ? 99 : card[attr]}
                                </span>
                            </div>
                        `).join('')}
                    </div>
                `;
            }
            
            cardEl.innerHTML = `
                <div class="card-header" style="font-size: 0.9rem; padding: 8px;">
                    ${card.name} ${isTriunfo ? '👑' : ''}
                </div>
                ${statsHtml}
            `;
            cardsGrid.appendChild(cardEl);
        });
        
        container.appendChild(cardsGrid);
    }
    
    // SCORING PHASE
    if (currentPhase === 'scoring') {
        container.innerHTML = `
            <div class="scoring-panel">
                <h2 style="color: #ffd700;">Set Complete!</h2>
                <p>Calculating scores...</p>
            </div>
        `;
    }
}

async function handleCardDoubleClick(cardId) {
    if (currentPhase === 'playing') {
        // If no attribute selected yet, and it's my turn to select, remind me
        if (!currentAttribute) {
            const isMyTurnToSelect = checkIfMyTurnToSelect();
            if (isMyTurnToSelect) {
                alert('Select an attribute first! Click on CAR, CUL, TET, FIS, or PER above your cards.');
                return;
            }
        }
        await playCard(cardId);
    }
}

function checkIfMyTurnToSelect() {
    if (!currentRoom || !currentRoom.current_turn) return false;
    
    const currentTurnIdx = (currentRoom.current_turn - 1) % players.length;
    return currentTurnIdx === 0; // Simplified: first player selects first turn
}

function updateGameUI() {
    const phaseIndicator = document.getElementById('phaseIndicator');
    const currentTriunfo = document.getElementById('currentTriunfo');
    
    if (phaseIndicator) {
        switch(currentPhase) {
            case 'waiting':
                phaseIndicator.textContent = 'Waiting for host to start...';
                phaseIndicator.style.color = '#ecc94b';
                break;
            case 'bidding':
                if (hasBidded) {
                    phaseIndicator.textContent = 'Bid placed! Waiting for others...';
                    phaseIndicator.style.color = '#48bb78';
                } else {
                    phaseIndicator.textContent = 'Place your bid! How many rounds will you win?';
                    phaseIndicator.style.color = '#ffd700';
                }
                break;
            case 'triunfo':
                phaseIndicator.textContent = 'El Triunfo revealed!';
                phaseIndicator.style.color = '#ff6b6b';
                break;
            case 'playing':
                if (currentAttribute) {
                    phaseIndicator.innerHTML = `Playing: <span style="color: #ffd700;">${ATTRIBUTE_NAMES[currentAttribute]}</span> | Turn ${currentRoom.current_turn}`;
                    phaseIndicator.style.color = '#48bb78';
                } else {
                    phaseIndicator.textContent = 'Select an attribute to begin!';
                    phaseIndicator.style.color = '#ffd700';
                }
                break;
            case 'scoring':
                phaseIndicator.textContent = 'Scoring...';
                phaseIndicator.style.color = '#4299e1';
                break;
        }
    }
    
    if (currentTriunfo && triunfoCard) {
        currentTriunfo.innerHTML = `👑 Triunfo: ${triunfoCard.name}`;
        currentTriunfo.style.color = '#ffd700';
    }
    
    updateScoreboard();
}

function updateScoreboard() {
    const scoreDiv = document.getElementById('scoreboard');
    if (!scoreDiv) return;
    
    let html = '<h3>Scores</h3>';
    
    // Sort by score
    const sortedPlayers = [...players].sort((a, b) => (b.total_score || 0) - (a.total_score || 0));
    
    sortedPlayers.forEach(p => {
        const isMe = p.id === playerId;
        const bidInfo = p.has_bid ? `(Bid: ${p.predicted_rounds || '?'})` : '(Bidding...)';
        const wonInfo = isGameActive ? `Won: ${p.won_rounds || 0}` : '';
        
        html += `
            <div class="score-row" style="${isMe ? 'background: rgba(72, 187, 120, 0.2);' : ''}">
                <span>${p.name} ${isMe ? '(You)' : ''}</span>
                <span>${p.total_score || 0}pts ${bidInfo} ${wonInfo}</span>
            </div>
        `;
    });
    
    scoreDiv.innerHTML = html;
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
                // Update local players array
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
                    addLog(`${payload.new.name} joined`);
                    addChatMessage('System', `${payload.new.name} joined the table`);
                } else if (payload.eventType === 'DELETE') {
                    const playerName = payload.old?.name || 'A player';
                    addLog(`${playerName} left`);
                    addChatMessage('System', `${playerName} left the table`);
                }
                
                // Update host controls when players join/leave
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
                    await loadMyHand();
                    updateGameUI();
                }
                
                if (payload.new.phase !== payload.old.phase) {
                    await loadGameState();
                    renderHand(myHand);
                    updateGameUI();
                }
                
                // Update triunfo card reference
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
    // Refresh players from database
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
            
            li.innerHTML = `<span>${p.name}</span><div>${badges}</div>`;
            ul.appendChild(li);
        });
    }
    
    updateScoreboard();
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