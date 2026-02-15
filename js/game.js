// ==========================================
// EL TRIUNFO CARD GAME - FIXED VERSION
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
let currentRoundPlays = []; // Track plays in current round

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
        cardsPerPlayer = CARD_DISTRIBUTION[players.length] || 8;
        
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
            await loadGameState();
        }
        
        addLog('Connected to El Triunfo');
        addChatMessage('System', '🎴 Welcome to El Triunfo!');
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

        // Create turn order first
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

        // Pick El Triunfo BEFORE dealing cards
        const { data: allCards } = await supabaseClient.from('cards').select('*');
        const randomCard = allCards[Math.floor(Math.random() * allCards.length)];
        triunfoCard = randomCard;
        
        // Deal cards
        await dealCards(allCards);
        
        // Start with triunfo revealed, then bidding
        await supabaseClient
            .from('rooms')
            .update({
                status: 'playing',
                phase: 'triunfo',
                current_set: (currentRoom.current_set || 0) + 1,
                current_turn: 0,
                triunfo_card_id: randomCard.id,
                current_attribute: null,
                current_round_starter: 0 // Track who starts each round
            })
            .eq('id', roomId);

        addChatMessage('System', `🎴 Set ${(currentRoom.current_set || 0) + 1} started!`);
        addChatMessage('System', `👑 El Triunfo is ${randomCard.name}! All its attributes are 99!`);
        
        // Move to bidding after showing triunfo briefly
        setTimeout(async () => {
            await supabaseClient
                .from('rooms')
                .update({ phase: 'bidding' })
                .eq('id', roomId);
            addChatMessage('System', `Place your bids! How many rounds will you win?`);
        }, 2000);
        
    } catch (err) {
        console.error('Start game error:', err);
        alert('Failed to start game');
    }
}

async function dealCards(allCards) {
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
    
    // Load hand immediately for all players
    await loadMyHand();
    addChatMessage('System', `📦 ${cardsPerPlayer} cards dealt to each player!`);
}

async function loadMyHand() {
    try {
        const { data: hand, error } = await supabaseClient
            .from('player_hands')
            .select('*, cards(*)')
            .eq('room_id', roomId)
            .eq('player_id', playerId);
        
        if (error) {
            console.error('Load hand error:', error);
            return;
        }
        
        // Filter out played cards client-side to avoid DB column issues
        const unplayed = hand ? hand.filter(h => !h.played) : [];
        myHand = unplayed.map(h => ({ ...h.cards, hand_id: h.id, hand_record_id: h.id }));
        renderHand(myHand);
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
            
            // Load current plays to know game state
            const { data: currentPlays } = await supabaseClient
                .from('current_turn_plays')
                .select('*')
                .eq('room_id', roomId);
            currentRoundPlays = currentPlays || [];
            
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
            // All bid, start playing
            await supabaseClient
                .from('rooms')
                .update({
                    phase: 'playing',
                    current_turn: 1,
                    current_attribute: null,
                    current_round_starter: 0
                })
                .eq('id', roomId);
            addChatMessage('System', `🎮 Round 1 begins! First player selects attribute and plays card.`);
        } else {
            renderHand(myHand);
        }
    } catch (err) {
        console.error('Submit bid error:', err);
    }
}

// ==========================================
// PLAYING PHASE
// ==========================================

async function selectAttribute(attribute) {
    if (currentPhase !== 'playing') return;
    
    try {
        // Check if it's my turn to select (I must be the round starter and haven't selected yet)
        const roundStarter = currentRoom.current_round_starter || 0;
        if (myPosition !== roundStarter) {
            alert('Only the round starter can select the attribute!');
            return;
        }
        
        if (currentAttribute) {
            alert('Attribute already selected for this round!');
            return;
        }
        
        currentAttribute = attribute;
        
        await supabaseClient
            .from('rooms')
            .update({ current_attribute: attribute })
            .eq('id', roomId);
        
        addChatMessage('System', `${currentPlayer} selected ${ATTRIBUTE_NAMES[attribute]}! Now play your card!`);
    } catch (err) {
        console.error('Select attribute error:', err);
    }
}

async function playCard(cardId) {
    if (currentPhase !== 'playing') return;
    
    const card = myHand.find(c => c.id === cardId);
    if (!card) return;
    
    try {
        // Get current plays
        const { data: currentPlays } = await supabaseClient
            .from('current_turn_plays')
            .select('*, players(*)')
            .eq('room_id', roomId)
            .order('played_at', { ascending: true });
        
        const playsThisRound = currentPlays ? currentPlays.length : 0;
        const roundStarter = currentRoom.current_round_starter || 0;
        
        // Determine whose turn it is
        let expectedPosition;
        if (playsThisRound === 0) {
            // First play of round - must be round starter
            expectedPosition = roundStarter;
        } else {
            // Subsequent plays - go clockwise from starter
            expectedPosition = (roundStarter + playsThisRound) % players.length;
        }
        
        if (myPosition !== expectedPosition) {
            // Find who should play
            const { data: turnOrder } = await supabaseClient
                .from('turn_order')
                .select('*, players(*)')
                .eq('room_id', roomId)
                .eq('position', expectedPosition)
                .single();
            
            const expectedPlayer = turnOrder?.players?.name || 'Another player';
            alert(`Wait for ${expectedPlayer} to play!`);
            return;
        }
        
        // If I'm the starter, I must select attribute first
        if (playsThisRound === 0 && !currentAttribute) {
            alert('Select an attribute first!');
            return;
        }
        
        // Calculate value (99 if it's El Triunfo)
        let value = card[currentAttribute];
        if (triunfoCard && card.id === triunfoCard.id) {
            value = 99;
        }
        
        // Play the card
        await supabaseClient
            .from('current_turn_plays')
            .insert({
                room_id: roomId,
                player_id: playerId,
                card_id: cardId,
                attribute: currentAttribute,
                value: value,
                total_stats: calculateTotalStats(card) // For tiebreaker
            });
        
        // Mark card as played using the hand record ID
        const handRecord = myHand.find(c => c.id === cardId);
        if (handRecord && handRecord.hand_record_id) {
            await supabaseClient
                .from('player_hands')
                .update({ played: true })
                .eq('id', handRecord.hand_record_id);
        }
        
        // Update local hand
        myHand = myHand.filter(c => c.id !== cardId);
        renderHand(myHand);
        
        const cardName = card.id === triunfoCard?.id ? `${card.name} 👑` : card.name;
        addChatMessage('System', `${currentPlayer} played ${cardName} (${value} ${ATTRIBUTE_NAMES[currentAttribute]})`);
        
        // Check if round is complete
        if (playsThisRound + 1 >= players.length) {
            setTimeout(resolveTurn, 1500);
        }
    } catch (err) {
        console.error('Play card error:', err);
    }
}

function calculateTotalStats(card) {
    return ATTRIBUTES.reduce((sum, attr) => sum + (card[attr] || 0), 0);
}

async function resolveTurn() {
    try {
        const { data: plays } = await supabaseClient
            .from('current_turn_plays')
            .select('*, players(*), cards(*)')
            .eq('room_id', roomId)
            .order('played_at', { ascending: true });
        
        if (!plays || plays.length < players.length) return;
        
        // Find winner with tiebreaker
        const winner = plays.reduce((max, play) => {
            if (play.value > max.value) return play;
            if (play.value === max.value) {
                // Tiebreaker: highest total stats
                const playTotal = calculateTotalStats(play.cards);
                const maxTotal = calculateTotalStats(max.cards);
                if (playTotal > maxTotal) return play;
            }
            return max;
        });
        
        // Award round to winner
        await supabaseClient
            .from('players')
            .update({ won_rounds: winner.players.won_rounds + 1 })
            .eq('id', winner.player_id);
        
        const winCardName = winner.cards.id === triunfoCard?.id ? 
            `${winner.cards.name} 👑` : winner.cards.name;
        
        addChatMessage('System', `🏆 ${winner.players.name} wins with ${winCardName}!`);
        
        // Clear turn plays
        await supabaseClient.from('current_turn_plays').delete().eq('room_id', roomId);
        
        // Check if set is over - count cards per player
        const { data: remainingByPlayer } = await supabaseClient
            .from('player_hands')
            .select('player_id, played')
            .eq('room_id', roomId);
        
        // Group by player and count unplayed
        const unplayedCounts = {};
        remainingByPlayer?.forEach(h => {
            if (!unplayedCounts[h.player_id]) unplayedCounts[h.player_id] = 0;
            if (!h.played) unplayedCounts[h.player_id]++;
        });
        
        const totalUnplayed = Object.values(unplayedCounts).reduce((a, b) => a + b, 0);
        
        if (totalUnplayed === 0) {
            await endSet();
        } else {
            // Next turn - winner starts next round
            const { data: winnerTurnOrder } = await supabaseClient
                .from('turn_order')
                .select('position')
                .eq('room_id', roomId)
                .eq('player_id', winner.player_id)
                .single();
            
            const nextStarter = winnerTurnOrder ? winnerTurnOrder.position : 0;
            const nextTurn = (currentRoom.current_turn || 0) + 1;
            
            await supabaseClient
                .from('rooms')
                .update({
                    current_turn: nextTurn,
                    current_attribute: null,
                    current_round_starter: nextStarter
                })
                .eq('id', roomId);
            
            addChatMessage('System', `Round ${nextTurn} begins! ${winner.players.name} selects attribute.`);
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
    renderHand([]); // Show scoring screen
    
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
            // Reset for next set
            isGameActive = false;
            currentPhase = 'waiting';
            hasBidded = false;
            myHand = [];
            triunfoCard = null;
            currentAttribute = null;
            
            const isHost = localStorage.getItem('isHost') === 'true';
            const hostControls = document.getElementById('hostControls');
            if (isHost && hostControls) {
                hostControls.style.display = 'block';
                hostControls.innerHTML = `<button onclick="startNewSet()" class="btn-start">🚀 Next Set</button>`;
            }
            addChatMessage('System', `Set complete! Host can start the next set.`);
            updateHostControls();
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
    
    if (currentPhase === 'triunfo') {
        renderTriunfoPhase(container);
        return;
    }
    
    if (currentPhase === 'bidding') {
        renderBiddingPhase(container, cards);
        return;
    }
    
    if (currentPhase === 'playing') {
        renderPlayingPhase(container, cards);
        return;
    }
    
    if (currentPhase === 'scoring') {
        container.innerHTML = '<div class="waiting-message"><h3>Set Complete!</h3><p>Calculating final scores...</p></div>';
    }
}

function renderTriunfoPhase(container) {
    if (!triunfoCard) {
        container.innerHTML = '<div class="waiting-message">Revealing El Triunfo...</div>';
        return;
    }
    
    container.innerHTML = `
        <div class="triunfo-reveal" style="text-align: center; padding: 20px;">
            <h2 style="color: var(--accent-gold); margin-bottom: 20px;">👑 EL TRIUNFO 👑</h2>
            <div class="game-card triunfo" style="margin: 0 auto; width: 160px;">
                <div class="card-header">${triunfoCard.name}</div>
                <div class="card-stats">
                    ${ATTRIBUTES.map(attr => `
                        <div class="stat">
                            <span class="stat-label">${ATTRIBUTE_NAMES[attr]}</span>
                            <span class="stat-value" style="color: var(--accent-gold); font-size: 1.3rem;">99</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            <p style="color: var(--text-secondary); margin-top: 20px;">Bidding begins shortly...</p>
        </div>
    `;
}

function renderBiddingPhase(container, cards) {
    if (!hasBidded) {
        // Show cards preview
        const previewDiv = document.createElement('div');
        previewDiv.style.cssText = 'margin-bottom: 20px;';
        previewDiv.innerHTML = '<h3 style="color: var(--accent-gold); margin-bottom: 15px; text-align: center;">Your Cards</h3>';
        
        const cardsGrid = document.createElement('div');
        cardsGrid.style.cssText = 'display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-bottom: 20px;';
        
        cards.forEach(card => {
            const miniCard = document.createElement('div');
            miniCard.style.cssText = 'width: 90px; background: rgba(26,35,50,0.9); border: 1px solid #4a5568; border-radius: 8px; padding: 6px; text-align: center; font-size: 0.75rem;';
            miniCard.innerHTML = `
                <div style="font-weight: bold; color: var(--accent-gold); margin-bottom: 4px;">${card.name}</div>
                <div style="color: var(--text-secondary); font-size: 0.65rem;">
                    C:${card.car} U:${card.cul} T:${card.tet}<br>F:${card.fis} P:${card.per}
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
            <p>You have ${cards.length} cards</p>
            <div class="bid-buttons">
                ${Array.from({length: cards.length + 1}, (_, i) => 
                    `<button onclick="submitBid(${i})" class="btn-bid">${i}</button>`
                ).join('')}
            </div>
        `;
        container.appendChild(bidDiv);
    } else {
        container.innerHTML = `
            <div class="waiting-panel" style="text-align: center; padding: 40px;">
                <h2 style="color: var(--accent-green);">Bid placed!</h2>
                <p>Waiting for other players...</p>
                <div class="spinner" style="width: 40px; height: 40px; border: 4px solid rgba(255,255,255,0.1); border-top-color: var(--accent-gold); border-radius: 50%; animation: spin 1s linear infinite; margin: 20px auto;"></div>
            </div>
        `;
    }
}

function renderPlayingPhase(container, cards) {
    const roundStarter = currentRoom.current_round_starter || 0;
    const isMyTurnToSelect = (myPosition === roundStarter) && !currentAttribute;
    
    if (isMyTurnToSelect) {
        const selectorDiv = document.createElement('div');
        selectorDiv.className = 'attribute-selector';
        selectorDiv.innerHTML = `
            <h3>You start this round! Select an attribute:</h3>
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
    cardsGrid.style.cssText = 'display: flex; flex-wrap: wrap; gap: 15px; justify-content: center;';
    
    cards.forEach((card) => {
        const isTriunfo = triunfoCard && card.id === triunfoCard.id;
        const cardEl = document.createElement('div');
        cardEl.className = `game-card ${isTriunfo ? 'triunfo' : ''}`;
        cardEl.style.cssText = 'width: 140px; cursor: pointer; transition: transform 0.2s;';
        
        cardEl.ondblclick = () => playCard(card.id);
        cardEl.onmouseenter = () => cardEl.style.transform = 'scale(1.05) translateY(-8px)';
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
                <div class="card-stats" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px;">
                    ${ATTRIBUTES.map(attr => `
                        <div class="stat" style="background: rgba(255,255,255,0.05); border-radius: 6px; padding: 6px 2px; text-align: center;">
                            <span class="stat-label" style="display: block; font-size: 0.6rem; color: var(--text-secondary); margin-bottom: 2px;">${ATTRIBUTE_NAMES[attr]}</span>
                            <span class="stat-value" style="display: block; font-size: 0.9rem; font-weight: bold; color: ${isTriunfo ? 'var(--accent-gold)' : 'var(--accent-green)'};">
                                ${isTriunfo ? 99 : card[attr]}
                            </span>
                        </div>
                    `).join('')}
                </div>
            `;
        }
        
        cardEl.innerHTML = `
            <div class="card-header" style="font-weight: bold; font-size: 0.9rem; text-align: center; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); color: var(--accent-gold);">
                ${card.name} ${isTriunfo ? '👑' : ''}
            </div>
            ${statsHtml}
        `;
        cardsGrid.appendChild(cardEl);
    });
    
    container.appendChild(cardsGrid);
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
            case 'triunfo':
                phaseIndicator.textContent = 'El Triunfo revealed!';
                phaseIndicator.style.color = '#ff6b6b';
                break;
            case 'bidding':
                phaseIndicator.textContent = hasBidded ? 'Bid placed!' : 'Place your bid!';
                phaseIndicator.style.color = hasBidded ? '#48bb78' : '#ffd700';
                break;
            case 'playing':
                const roundStarter = currentRoom?.current_round_starter || 0;
                const isStarter = myPosition === roundStarter;
                if (currentAttribute) {
                    phaseIndicator.textContent = `Playing: ${ATTRIBUTE_NAMES[currentAttribute]} | Round ${currentRoom?.current_turn || 1}`;
                    phaseIndicator.style.color = '#48bb78';
                } else {
                    phaseIndicator.textContent = isStarter ? 'Select an attribute and play!' : 'Waiting for attribute...';
                    phaseIndicator.style.color = isStarter ? '#ffd700' : '#ecc94b';
                }
                break;
            case 'scoring':
                phaseIndicator.textContent = 'Set Complete!';
                phaseIndicator.style.color = '#4299e1';
                break;
        }
    }
    
    if (turnInfo) {
        if (currentPhase === 'playing') {
            turnInfo.textContent = `Round ${currentRoom?.current_turn || 1}`;
        } else {
            turnInfo.textContent = currentPhase === 'triunfo' ? 'El Triunfo' : 
                                  currentPhase.charAt(0).toUpperCase() + currentPhase.slice(1);
        }
    }
    
    if (triunfoDisplay && triunfoCard) {
        triunfoDisplay.innerHTML = `
            <div class="game-card triunfo" style="width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 8px;">
                <div style="font-size: 0.7rem; color: var(--accent-gold); font-weight: bold; text-align: center;">${triunfoCard.name}</div>
                <div style="font-size: 2rem;">👑</div>
                <div style="font-size: 0.6rem; color: var(--text-secondary);">99 ALL</div>
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
    
    const countEl = document.getElementById('playerCount');
    if (countEl) countEl.textContent = players.length;
}

// ==========================================
// CHAT & UTILITIES (unchanged)
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
                    cardsPerPlayer = CARD_DISTRIBUTION[players.length] || 8;
                } else if (payload.eventType === 'DELETE') {
                    players = players.filter(p => p.id !== payload.old.id);
                    cardsPerPlayer = CARD_DISTRIBUTION[players.length] || 8;
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
                
                // Handle phase transitions
                if (payload.old.status === 'waiting' && payload.new.status === 'playing') {
                    isGameActive = true;
                    hasBidded = false;
                    myHand = [];
                    cardsPerPlayer = CARD_DISTRIBUTION[players.length] || 8;
                }
                
                if (payload.new.phase === 'bidding' && payload.old.phase === 'triunfo') {
                    // Transition from triunfo to bidding - reload hand
                    await loadMyHand();
                }
                
                if (payload.new.phase === 'playing' && payload.old.phase === 'bidding') {
                    // Transition to playing
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
        addChatMessage('System', 'Room code copied!');
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