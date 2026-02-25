// ==========================================
// BRA - CLEAN REBUILD
// ==========================================

const ATTRIBUTES = ['car', 'cul', 'tet', 'fis', 'per'];
const ATTR_NAMES = { car: 'CAR', cul: 'CUL', tet: 'TET', fis: 'FIS', per: 'PER' };
const CARDS_PER_PLAYER = { 2: 20, 3: 13, 4: 10, 5: 8 };

// Game State
const state = {
    playerId: localStorage.getItem('playerId') || crypto.randomUUID(),
    playerName: localStorage.getItem('currentPlayer'),
    roomCode: localStorage.getItem('currentRoom'),
    isHost: localStorage.getItem('isHost') === 'true',
    mySeat: parseInt(localStorage.getItem('seatNumber')) || 1,
    
    roomId: null,
    players: [],          // { id, name, seat_number, bid, rounds_won, total_score }
    phase: 'waiting',     // waiting, dealing, triunfo, bidding, playing, scoring
    cardsPerPlayer: 0,
    totalRounds: 0,
    
    myHand: [],           // Cards in hand
    triunfoCard: null,    // The 99 card
    discardedCard: null,  // For 3 players
    
    currentRound: 0,      // Which round we're on (1 to totalRounds)
    currentSeat: 0,       // Whose turn it is (seat number)
    starterSeat: 0,       // Who starts this round (selects attribute)
    currentAttribute: null,
    hasPlayedThisRound: false,
    hasBid: false,
    
    allCards: [],         // Cache of the 40 cards from DB
    playsThisRound: []    // Cards played this round
};

// Initialize player ID
if (!localStorage.getItem('playerId')) {
    localStorage.setItem('playerId', state.playerId);
}

// ==========================================
// INITIALIZATION
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
    if (!state.roomCode) {
        window.location.href = 'index.html';
        return;
    }

    document.getElementById('roomCode').textContent = `ROOM: ${state.roomCode}`;
    
    // Enter key for chat
    document.getElementById('chatInput')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChat();
    });

    try {
        // Get room and players
        const { data: room, error: roomError } = await supabaseClient
            .from('rooms')
            .select('*, players(*)')
            .eq('code', state.roomCode)
            .single();

        if (roomError || !room) {
            alert('Room not found');
            window.location.href = 'index.html';
            return;
        }

        state.roomId = room.id;
        state.players = room.players.sort((a, b) => a.seat_number - b.seat_number);
        state.phase = room.status === 'playing' ? (room.phase || 'dealing') : 'waiting';
        
        updatePlayerCount();
        updateSeatDisplay();
        updateHostControls();

        // Setup realtime subscriptions
        setupRealtime();

        // If game already in progress, load state
        if (room.status === 'playing') {
            await loadGameState(room);
        }

        addChat('System', 'Welcome to Bra! 🎴');
        
    } catch (err) {
        console.error('Init error:', err);
        alert('Failed to initialize game');
    }
});

// ==========================================
// GAME START
// ==========================================

async function startGame() {
    if (state.players.length < 2) {
        alert('Need at least 2 players');
        return;
    }

    state.cardsPerPlayer = CARDS_PER_PLAYER[state.players.length];
    state.totalRounds = state.cardsPerPlayer;

    try {
        // Clear previous game data
        await supabaseClient.from('player_hands').delete().eq('room_id', state.roomId);
        await supabaseClient.from('current_turn_plays').delete().eq('room_id', state.roomId);
        
        // Reset players
        for (const p of state.players) {
            await supabaseClient
                .from('players')
            .update({ 
            predicted_rounds: null, 
            won_rounds: 0
            })
                .eq('id', p.id);
        }

        // Fetch and shuffle cards
        const { data: allCards } = await supabaseClient.from('cards').select('*');
        state.allCards = allCards;
        
        const shuffled = [...allCards].sort(() => Math.random() - 0.5);
        
        // Pick triunfo
        const triunfoIndex = Math.floor(Math.random() * shuffled.length);
        const triunfo = shuffled[triunfoIndex];
        state.triunfoCard = triunfo;
        
        // Remove triunfo from deck for dealing
        const deck = shuffled.filter((_, i) => i !== triunfoIndex);
        
        // Handle 3-player discard
        let discarded = null;
        if (state.players.length === 3) {
            discarded = deck.pop(); // Remove last card
            state.discardedCard = discarded;
        }

        // Deal cards
        let cardIndex = 0;
        for (const player of state.players) {
            const playerCards = deck.slice(cardIndex, cardIndex + state.cardsPerPlayer);
            cardIndex += state.cardsPerPlayer;
            
            for (const card of playerCards) {
                await supabaseClient.from('player_hands').insert({
                    room_id: state.roomId,
                    player_id: player.id,
                    card_id: card.id,
                    played: false
                });
            }
        }

        // Update room to playing status
        await supabaseClient
            .from('rooms')
            .update({
                status: 'playing',
                phase: 'triunfo',
                triunfo_card_id: triunfo.id,
                discarded_card_id: discarded?.id || null,
                current_round: 0,
                starter_seat: 1,  // Host starts
                current_seat: 0,
                current_attribute: null
            })
            .eq('id', state.roomId);

        addChat('System', `🎴 El Triunfo is ${triunfo.name}!`);
        if (discarded) {
            addChat('System', `🗑️ Discarded: ${discarded.name}`);
        }

    } catch (err) {
        console.error('Start game error:', err);
        alert('Failed to start game');
    }
}

// ==========================================
// PHASE HANDLERS
// ==========================================

function enterPhase(phase) {
    state.phase = phase;
    
    switch(phase) {
        case 'triunfo':
            showTriunfo();
            setTimeout(() => {
                supabaseClient
                    .from('rooms')
                    .update({ phase: 'bidding', current_seat: 1 })
                    .eq('id', state.roomId);
            }, 3000);
            break;
            
        case 'bidding':
            renderBidding();
            break;
            
        case 'playing':
            state.currentRound = 1;
            state.starterSeat = 1;
            state.currentSeat = 1;
            state.hasBid = false;
            loadMyHand().then(() => {
                renderHand();
                updateTurnIndicator();
            });
            break;
            
        case 'scoring':
            calculateScores();
            break;
    }
    
    updatePhaseInfo();
}

function showTriunfo() {
    const triunfoDiv = document.getElementById('triunfo');
    triunfoDiv.querySelector('.card-name').textContent = state.triunfoCard.name;
    triunfoDiv.classList.remove('hidden');
    
    if (state.discardedCard) {
        const discardDiv = document.getElementById('discarded');
        discardDiv.querySelector('.card-name').textContent = state.discardedCard.name;
        discardDiv.classList.remove('hidden');
    }
    
    updatePhaseInfo('El Triunfo revealed!');
}

// ==========================================
// BIDDING
// ==========================================

function renderBidding() {
    const container = document.getElementById('handContainer');
    const isMyTurn = state.currentSeat === state.mySeat;
    const myPlayer = state.players.find(p => p.id === state.playerId);
    
    if (myPlayer?.has_bid) {
        container.innerHTML = `
            <div class="waiting-message">
                <h3>Bid placed: ${myPlayer.bid}</h3>
                <p>Waiting for others...</p>
            </div>
        `;
        return;
    }
    
    if (!isMyTurn) {
        const currentPlayer = state.players.find(p => p.seat_number === state.currentSeat);
        container.innerHTML = `
            <div class="waiting-message">
                <p>Waiting for ${currentPlayer?.name || 'player'} to bid...</p>
            </div>
        `;
        return;
    }
    
    // Calculate restriction for last bidder
    const bidsPlaced = state.players
        .filter(p => p.has_bid && p.seat_number !== state.mySeat)
        .reduce((sum, p) => sum + (p.bid || 0), 0);
    
    const isLastBidder = state.currentSeat === Math.max(...state.players.map(p => p.seat_number));
    const maxBid = state.totalRounds;
    
    let html = `
        <div class="bidding-panel">
            <h3>How many rounds will you win?</h3>
            <div class="bid-buttons">
    `;
    
    for (let i = 0; i <= maxBid; i++) {
        const isRestricted = isLastBidder && (bidsPlaced + i === maxBid);
        html += `
            <button class="bid-btn" onclick="placeBid(${i})" ${isRestricted ? 'disabled' : ''}>
                ${i}
            </button>
        `;
    }
    
    html += '</div></div>';
    container.innerHTML = html;
}

async function placeBid(bid) {
    try {
        await supabaseClient
            .from('players')
            .update({ predicted_rounds: bid })
            .eq('id', state.playerId);
        
        state.hasBid = true;
        
        // Move to next seat or start playing
        const maxSeat = Math.max(...state.players.map(p => p.seat_number));
        const nextSeat = state.currentSeat >= maxSeat ? 0 : state.currentSeat + 1;
        
        if (nextSeat === 0) {
            // All bid, start playing
            await supabaseClient
                .from('rooms')
                .update({ phase: 'playing', current_seat: 1 })
                .eq('id', state.roomId);
        } else {
            await supabaseClient
                .from('rooms')
                .update({ current_seat: nextSeat })
                .eq('id', state.roomId);
        }
        
        addChat('System', `${state.playerName} bid ${bid}`);
        
    } catch (err) {
        console.error('Bid error:', err);
    }
}

// ==========================================
// PLAYING
// ==========================================

async function loadMyHand() {
    try {
        const { data: handData } = await supabaseClient
            .from('player_hands')
            .select('*, cards(*)')
            .eq('room_id', state.roomId)
            .eq('player_id', state.playerId)
            .eq('played', false);
        
        state.myHand = handData.map(h => ({
            ...h.cards,
            handId: h.id
        }));
        
    } catch (err) {
        console.error('Load hand error:', err);
    }
}

function renderHand() {
    const container = document.getElementById('handContainer');
    
    if (state.phase !== 'playing') return;
    
    const isStarter = state.starterSeat === state.mySeat;
    const isMyTurn = state.currentSeat === state.mySeat;
    
    let html = '';
    
    // Attribute selection (only for starter at beginning of round)
    if (isStarter && !state.currentAttribute && isMyTurn) {
        html += `
            <div class="attribute-panel">
                <h3>Select Attribute</h3>
                <div class="attribute-buttons">
                    ${ATTRIBUTES.map(attr => `
                        <button class="attr-btn ${attr}" onclick="selectAttribute('${attr}')">
                            ${ATTR_NAMES[attr]}
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
    } else if (!state.currentAttribute) {
        const starter = state.players.find(p => p.seat_number === state.starterSeat);
        html += `
            <div class="waiting-message">
                <p>Waiting for ${starter?.name} to select attribute...</p>
            </div>
        `;
    } else {
        // Show current attribute
        html += `
            <div style="text-align: center; margin-bottom: 1rem;">
                <span style="color: var(--highlight); font-size: 1.2rem; font-weight: bold;">
                    Playing: ${ATTR_NAMES[state.currentAttribute]}
                </span>
                ${!isMyTurn ? '<p>Waiting for your turn...</p>' : '<p>Double-click card to play</p>'}
            </div>
        `;
    }
    
    // Cards
    html += '<div style="display: flex; gap: 1rem; flex-wrap: wrap; justify-content: center;">';
    
    state.myHand.forEach(card => {
        const isTriunfo = card.id === state.triunfoCard.id;
        const canPlay = isMyTurn && state.currentAttribute && !state.hasPlayedThisRound;
        
        html += `
            <div class="card ${isTriunfo ? 'triunfo' : ''}" 
                 ${canPlay ? `ondblclick="playCard(${card.id})"` : ''}
                 style="${!canPlay ? 'opacity: 0.6;' : ''}">
                <div class="card-name">${card.name}</div>
                <div class="card-stats">
                    ${ATTRIBUTES.map(attr => `
                        <div class="stat ${state.currentAttribute === attr ? 'active' : ''}">
                            <span class="stat-label">${ATTR_NAMES[attr]}</span>
                            <span class="stat-value">${isTriunfo ? 99 : card[attr]}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

async function selectAttribute(attr) {
    try {
        await supabaseClient
            .from('rooms')
            .update({ current_attribute: attr })
            .eq('id', state.roomId);
        
        state.currentAttribute = attr;
        renderHand();
        addChat('System', `${state.playerName} selected ${ATTR_NAMES[attr]}`);
        
    } catch (err) {
        console.error('Select attribute error:', err);
    }
}

async function playCard(cardId) {
    if (!state.currentAttribute || state.hasPlayedThisRound) return;
    
    const card = state.myHand.find(c => c.id === cardId);
    if (!card) return;
    
    // Calculate value (99 if triunfo)
    const isTriunfo = card.id === state.triunfoCard.id;
    const value = isTriunfo ? 99 : card[state.currentAttribute];
    
    try {
        // Record play
        await supabaseClient.from('current_turn_plays').insert({
            room_id: state.roomId,
            player_id: state.playerId,
            card_id: cardId,
            attribute: state.currentAttribute,
            value: value,
            seat_number: state.mySeat
        });
        
        // Mark card as played
        await supabaseClient
            .from('player_hands')
            .update({ played: true })
            .eq('id', card.handId);
        
        // Remove from local hand
        state.myHand = state.myHand.filter(c => c.id !== cardId);
        state.hasPlayedThisRound = true;
        
        addChat('System', `${state.playerName} played ${card.name} (${value})`);
        
        // Check if round complete
        const { data: plays } = await supabaseClient
            .from('current_turn_plays')
            .select('*')
            .eq('room_id', state.roomId);
        
        if (plays.length >= state.players.length) {
            setTimeout(resolveRound, 1500);
        } else {
            // Advance to next seat
            const nextSeat = (state.currentSeat % state.players.length) + 1;
            await supabaseClient
                .from('rooms')
                .update({ current_seat: nextSeat })
                .eq('id', state.roomId);
        }
        
        renderHand();
        
    } catch (err) {
        console.error('Play card error:', err);
    }
}

// ==========================================
// ROUND RESOLUTION
// ==========================================

async function resolveRound() {
    try {
        const { data: plays } = await supabaseClient
            .from('current_turn_plays')
            .select('*, cards(*)')
            .eq('room_id', state.roomId);
        
        // Find winner (highest value, tiebreaker: highest total stats)
        const winner = plays.reduce((best, play) => {
            if (play.value > best.value) return play;
            if (play.value === best.value) {
                const playTotal = ATTRIBUTES.reduce((sum, attr) => sum + play.cards[attr], 0);
                const bestTotal = ATTRIBUTES.reduce((sum, attr) => sum + best.cards[attr], 0);
                if (playTotal > bestTotal) return play;
            }
            return best;
        });
        
        const winnerPlayer = state.players.find(p => p.id === winner.player_id);
        
        // Update winner's rounds_won
        await supabaseClient
            .from('players')
            .update({ rounds_won: (winnerPlayer.rounds_won || 0) + 1 })
            .eq('id', winner.player_id);
        
        addChat('System', `🏆 ${winnerPlayer.name} wins the round!`);
        
        // Clear plays
        await supabaseClient.from('current_turn_plays').delete().eq('room_id', state.roomId);
        
        // Check if game over (all cards played)
        const { data: remaining } = await supabaseClient
            .from('player_hands')
            .select('*')
            .eq('room_id', state.roomId)
            .eq('played', false);
        
        if (remaining.length === 0) {
            // Game over
            await supabaseClient
                .from('rooms')
                .update({ phase: 'scoring' })
                .eq('id', state.roomId);
        } else {
            // Next round
            const nextRound = state.currentRound + 1;
            await supabaseClient
                .from('rooms')
                .update({
                    current_round: nextRound,
                    starter_seat: winnerPlayer.seat_number,
                    current_seat: winnerPlayer.seat_number,
                    current_attribute: null
                })
                .eq('id', state.roomId);
            
            state.hasPlayedThisRound = false;
            await loadMyHand();
            renderHand();
        }
        
    } catch (err) {
        console.error('Resolve round error:', err);
    }
}

// ==========================================
// SCORING
// ==========================================

async function calculateScores() {
    const players = state.players;
    let scoreHtml = '<div class="score-results">';
    
    for (const p of players) {
        const bid = p.bid || 0;
        const won = p.rounds_won || 0;
        const correct = bid === won;
        
        let points = (won * 2) + (correct ? 3 : -2);
        
        // Update total score
        const newTotal = (p.total_score || 0) + points;
        await supabaseClient
            .from('players')
            .update({ total_score: newTotal })
            .eq('id', p.id);
        
        scoreHtml += `
            <div class="score-item" style="margin-bottom: 1rem; padding: 1rem; background: rgba(255,255,255,0.05); border-radius: 8px;">
                <div style="font-weight: bold; margin-bottom: 0.5rem;">${p.name}</div>
                <div style="display: flex; justify-content: space-between; font-size: 0.9rem;">
                    <span>Bid: ${bid} | Won: ${won}</span>
                    <span style="color: ${correct ? 'var(--success)' : 'var(--highlight)'}">
                        ${correct ? '✓ Exact!' : '✗ Miss'} 
                    </span>
                </div>
                <div style="margin-top: 0.5rem; font-size: 1.1rem;">
                    ${won}×2 ${correct ? '+3' : '-2'} = <strong>${points} points</strong>
                </div>
            </div>
        `;
    }
    
    scoreHtml += '</div>';
    
    document.getElementById('handContainer').innerHTML = `
        <div style="text-align: center; padding: 2rem;">
            <h2>Game Over!</h2>
            ${scoreHtml}
            ${state.isHost ? '<button onclick="resetGame()" class="start-btn" style="margin-top: 2rem;">Play Again</button>' : ''}
        </div>
    `;
    
    updateScoreboard();
}

async function resetGame() {
    await supabaseClient
        .from('rooms')
        .update({ status: 'waiting', phase: 'waiting' })
        .eq('id', state.roomId);
}

// ==========================================
// REALTIME SYNC
// ==========================================

function setupRealtime() {
    // Room changes
    supabaseClient
        .channel(`room-${state.roomId}`)
        .on('postgres_changes', 
            { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${state.roomId}` },
            async (payload) => {
                const room = payload.new;
                
                // Phase transitions
                if (payload.old.phase !== room.phase) {
                    if (room.phase === 'triunfo') {
                        // Load triunfo info
                        const { data: card } = await supabaseClient
                            .from('cards')
                            .select('*')
                            .eq('id', room.triunfo_card_id)
                            .single();
                        state.triunfoCard = card;
                        
                        if (room.discarded_card_id) {
                            const { data: discard } = await supabaseClient
                                .from('cards')
                                .select('*')
                                .eq('id', room.discarded_card_id)
                                .single();
                            state.discardedCard = discard;
                        }
                    }
                    
                    enterPhase(room.phase);
                }
                
                // Update game state
                state.currentRound = room.current_round || 0;
                state.starterSeat = room.starter_seat || 1;
                state.currentSeat = room.current_seat || 0;
                state.currentAttribute = room.current_attribute;
                
                // Refresh UI
                updateTurnIndicator();
                highlightActiveSeat();
                
                if (room.phase === 'playing') {
                    renderHand();
                    loadTablePlays();
                }
            }
        )
        .subscribe();
    
    // Player changes (bids, scores)
    supabaseClient
        .channel(`players-${state.roomId}`)
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${state.roomId}` },
            async (payload) => {
                // Refresh players
                const { data: players } = await supabaseClient
                    .from('players')
                    .select('*')
                    .eq('room_id', state.roomId)
                    .order('seat_number');
                
                state.players = players;
                updateSeatDisplay();
                updateScoreboard();
                
                if (state.phase === 'bidding') {
                    renderBidding();
                }
            }
        )
        .subscribe();
    
    // Plays (cards on table)
    supabaseClient
        .channel(`plays-${state.roomId}`)
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'current_turn_plays', filter: `room_id=eq.${state.roomId}` },
            () => {
                loadTablePlays();
            }
        )
        .subscribe();
}

async function loadTablePlays() {
    const { data: plays } = await supabaseClient
        .from('current_turn_plays')
        .select('*, players(name), cards(*)')
        .eq('room_id', state.roomId);
    
    const container = document.getElementById('playsContainer');
    if (!plays || plays.length === 0) {
        container.innerHTML = '';
        return;
    }
    
    container.innerHTML = plays.map(play => `
        <div class="played-card">
            <div class="player">${play.players.name}</div>
            <div style="font-size: 0.8rem; margin-bottom: 0.25rem;">${play.cards.name}</div>
            <div class="value">${play.value}</div>
        </div>
    `).join('');
}

async function loadGameState(room) {
    // Load triunfo
    if (room.triunfo_card_id) {
        const { data: card } = await supabaseClient
            .from('cards')
            .select('*')
            .eq('id', room.triunfo_card_id)
            .single();
        state.triunfoCard = card;
    }
    
    // Load discarded
    if (room.discarded_card_id) {
        const { data: card } = await supabaseClient
            .from('cards')
            .select('*')
            .eq('id', room.discarded_card_id)
            .single();
        state.discardedCard = card;
    }
    
    state.currentRound = room.current_round || 0;
    state.starterSeat = room.starter_seat || 1;
    state.currentSeat = room.current_seat || 0;
    state.currentAttribute = room.current_attribute;
    
    if (room.phase === 'playing') {
        await loadMyHand();
        loadTablePlays();
    }
}

// ==========================================
// UI UPDATES
// ==========================================

function updateSeatDisplay() {
    state.players.forEach(p => {
        const seatEl = document.getElementById(`seat-${p.seat_number}`);
        if (seatEl) {
            seatEl.querySelector('.seat-name').textContent = p.name;
            const bidEl = seatEl.querySelector('.seat-bid');
                if (p.predicted_rounds !== null) {
                bidEl.textContent = `Bid: ${p.predicted_rounds}`;
                bidEl.classList.add('placed');
            } else {
                bidEl.textContent = state.phase === 'bidding' ? 'Bidding...' : '-';
                bidEl.classList.remove('placed');
            }
        }
    });
    
    // Mark empty seats
    for (let i = 1; i <= 5; i++) {
        const hasPlayer = state.players.some(p => p.seat_number === i);
        if (!hasPlayer) {
            const seatEl = document.getElementById(`seat-${i}`);
            if (seatEl) {
                seatEl.querySelector('.seat-name').textContent = 'Empty';
                seatEl.querySelector('.seat-bid').textContent = '-';
            }
        }
    }
    
    updatePlayerList();
    highlightActiveSeat();
}

function highlightActiveSeat() {
    document.querySelectorAll('.seat').forEach(el => el.classList.remove('active'));
    if (state.currentSeat > 0) {
        const seatEl = document.getElementById(`seat-${state.currentSeat}`);
        if (seatEl) seatEl.classList.add('active');
    }
}

function updateTurnIndicator() {
    const indicator = document.getElementById('turn-indicator');
    
    if (state.phase === 'waiting') {
        indicator.textContent = 'Waiting for host...';
    } else if (state.phase === 'triunfo') {
        indicator.textContent = 'El Triunfo revealed!';
    } else if (state.phase === 'bidding') {
        const current = state.players.find(p => p.seat_number === state.currentSeat);
        indicator.textContent = current ? `${current.name} is bidding...` : 'Bidding...';
    } else if (state.phase === 'playing') {
        if (state.currentAttribute) {
            const current = state.players.find(p => p.seat_number === state.currentSeat);
            indicator.textContent = `Round ${state.currentRound} - ${ATTR_NAMES[state.currentAttribute]} - ${current?.name}'s turn`;
        } else {
            const starter = state.players.find(p => p.seat_number === state.starterSeat);
            indicator.textContent = `${starter?.name} selects attribute...`;
        }
    }
}

function updatePhaseInfo(msg) {
    const el = document.getElementById('phaseInfo');
    if (msg) {
        el.textContent = msg;
    } else {
        const phases = {
            waiting: 'Waiting for host...',
            triunfo: 'El Triunfo revealed!',
            bidding: 'Place your bids!',
            playing: 'Play your cards!',
            scoring: 'Calculating scores...'
        };
        el.textContent = phases[state.phase] || '';
    }
}

function updateHostControls() {
    const controls = document.getElementById('hostControls');
    if (state.isHost && state.phase === 'waiting') {
        controls.classList.remove('hidden');
        const minPlayers = controls.querySelector('.min-players');
        minPlayers.textContent = state.players.length < 2 
            ? `Need ${2 - state.players.length} more player(s)` 
            : 'Ready to start!';
    } else {
        controls.classList.add('hidden');
    }
}

function updatePlayerCount() {
    document.getElementById('playerCount')?.textContent 
        ? document.getElementById('playerCount').textContent = state.players.length 
        : null;
}

function updatePlayerList() {
    const list = document.getElementById('playerList');
    list.innerHTML = state.players.map(p => `
        <li>
            <span>${p.name} ${p.seat_number === state.mySeat ? '(You)' : ''} ${p.id === state.playerId && state.isHost ? '👑' : ''}</span>
            <span style="color: var(--text-dim);">#${p.seat_number}</span>
        </li>
    `).join('');
}

function updateScoreboard() {
    const list = document.getElementById('scoreList');
    if (!list) return;
    
    const sorted = [...state.players].sort((a, b) => (b.total_score || 0) - (a.total_score || 0));
    
    list.innerHTML = sorted.map(p => `
        <div class="score-item">
            <span class="name">${p.name}</span>
            <span class="points">${p.total_score || 0}</span>
        </div>
    `).join('');
}

// ==========================================
// CHAT & UTILS
// ==========================================

async function sendChat() {
    const input = document.getElementById('chatInput');
    const msg = input.value.trim();
    if (!msg) return;
    
    input.value = '';
    
    await supabaseClient.from('chat_messages').insert({
        room_id: state.roomId,
        player_id: state.playerId,
        player_name: state.playerName,
        message: msg
    });
}

function addChat(sender, message) {
    const log = document.getElementById('chatLog');
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isSystem = sender === 'System';
    
    const div = document.createElement('div');
    div.className = `chat-message ${isSystem ? 'system' : ''}`;
    div.innerHTML = `
        <span class="time">[${time}]</span>
        <span class="sender">${sender}:</span>
        <span>${message}</span>
    `;
    
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
}

function copyCode() {
    navigator.clipboard.writeText(state.roomCode);
    addChat('System', 'Room code copied!');
}

async function leaveGame() {
    await supabaseClient.from('players').delete().eq('id', state.playerId);
    localStorage.removeItem('currentRoom');
    localStorage.removeItem('currentPlayer');
    localStorage.removeItem('isHost');
    localStorage.removeItem('seatNumber');
    window.location.href = 'index.html';
}

// Chat subscription
supabaseClient
    .channel(`chat-${state.roomCode}`)
    .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${state.roomId}` },
        (payload) => {
            const msg = payload.new;
            if (msg.player_id !== state.playerId) {
                addChat(msg.player_name, msg.message);
            }
        }
    )
    .subscribe();

// Cleanup on unload
window.addEventListener('beforeunload', async () => {
    if (state.phase === 'waiting') {
        await supabaseClient.from('players').delete().eq('id', state.playerId);
    }
});