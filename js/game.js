// ==========================================
// BRA - COMPLETE FIXED VERSION
// ==========================================

const ATTRIBUTES = ['car', 'cul', 'tet', 'fis', 'per'];
const ATTR_NAMES = { car: 'CAR', cul: 'CUL', tet: 'TET', fis: 'FIS', per: 'PER' };
const CARDS_PER_PLAYER = { 2: 20, 3: 13, 4: 10, 5: 8 };

const state = {
    playerId: localStorage.getItem('playerId') || crypto.randomUUID(),
    playerName: localStorage.getItem('currentPlayer'),
    roomCode: localStorage.getItem('currentRoom'),
    isHost: localStorage.getItem('isHost') === 'true',
    mySeat: parseInt(localStorage.getItem('seatNumber')) || 1,
    
    roomId: null,
    players: [],
    phase: 'waiting',
    cardsPerPlayer: 0,
    totalRounds: 0,
    gameStarting: false,
    
    myHand: [],
    triunfoCard: null,
    discardedCard: null,
    
    currentSet: 0,
    currentTurn: 0,
    roundStarter: 0,
    currentAttribute: null,
    hasPlayedThisRound: false,
    
    allCards: [],
    playsThisRound: []
};

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
    
    document.getElementById('chatInput')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChat();
    });

    try {
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
        state.phase = room.status === 'playing' ? (room.phase || 'waiting') : 'waiting';
        
        updatePlayerCount();
        updateSeatDisplay();
        updateHostControls();

        setupRealtime();

        if (room.status === 'playing') {
            await loadGameState(room);
            if (state.phase !== 'waiting') {
                enterPhase(state.phase, false);
            }
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
    if (state.gameStarting) return;
    if (state.players.length < 2) {
        alert('Need at least 2 players');
        return;
    }

    state.gameStarting = true;
    const btn = document.getElementById('startBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Starting...';
    }

    state.cardsPerPlayer = CARDS_PER_PLAYER[state.players.length];
    state.totalRounds = state.cardsPerPlayer;

    try {
        await supabaseClient.from('player_hands').delete().eq('room_id', state.roomId);
        await supabaseClient.from('current_turn_plays').delete().eq('room_id', state.roomId);
        
        for (const p of state.players) {
            await supabaseClient
                .from('players')
                .update({ predicted_rounds: null, won_rounds: 0 })
                .eq('id', p.id);
        }

        const { data: allCards } = await supabaseClient.from('cards').select('*');
        state.allCards = allCards;
        
        const shuffled = [...allCards].sort(() => Math.random() - 0.5);
        
        // Pick triunfo from ALL cards (it will be dealt to someone)
        const triunfoIndex = Math.floor(Math.random() * shuffled.length);
        const triunfo = shuffled[triunfoIndex];
        state.triunfoCard = triunfo;
        
        // Handle 3-player: remove one random card as discard (not triunfo)
        let discarded = null;
        if (state.players.length === 3) {
            const availableForDiscard = shuffled.filter((_, i) => i !== triunfoIndex);
            const discardIndex = Math.floor(Math.random() * availableForDiscard.length);
            discarded = availableForDiscard[discardIndex];
            state.discardedCard = discarded;
            
            const discardGlobalIndex = shuffled.findIndex(c => c.id === discarded.id);
            shuffled.splice(discardGlobalIndex, 1);
        }

        // Deal cards (triunfo is among these!)
        let cardIndex = 0;
        for (const player of state.players) {
            const playerCards = shuffled.slice(cardIndex, cardIndex + state.cardsPerPlayer);
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

        await supabaseClient
            .from('rooms')
            .update({
                status: 'playing',
                phase: 'triunfo',
                triunfo_card_id: triunfo.id,
                current_set: 0,
                current_turn: 0,
                current_attribute: null,
                game_data: { round_starter: 1 }
            })
            .eq('id', state.roomId);

        addChat('System', `🎴 El Triunfo is ${triunfo.name}!`);
        if (discarded) {
            addChat('System', `🗑️ Discarded: ${discarded.name}`);
        }

    } catch (err) {
        console.error('Start game error:', err);
        alert('Failed to start game: ' + err.message);
        state.gameStarting = false;
        if (btn) {
            btn.disabled = false;
            btn.textContent = '🚀 Start Game';
        }
    }
}

// ==========================================
// PHASE HANDLERS
// ==========================================

function enterPhase(phase, startTimer = true) {
    console.log('Entering phase:', phase);
    state.phase = phase;
    updatePhaseInfo();
    
    switch(phase) {
        case 'triunfo':
            showTriunfo();
            if (startTimer) {
                setTimeout(async () => {
                    try {
                        await supabaseClient
                            .from('rooms')
                            .update({ phase: 'bidding', current_turn: 1 })
                            .eq('id', state.roomId);
                    } catch (err) {
                        console.error('Error advancing to bidding:', err);
                    }
                }, 3000);
            }
            break;
            
        case 'bidding':
            loadMyHand().then(() => renderBidding());
            break;
            
        case 'playing':
            state.currentSet = 1;
            state.roundStarter = 1;
            state.currentTurn = 1;
            state.hasPlayedThisRound = false;
            loadMyHand().then(() => {
                renderHand();
                updateTurnIndicator();
                loadTablePlays(); // Load any existing plays
            });
            break;
            
        case 'scoring':
            calculateScores();
            break;
    }
    
    updateSeatDisplay();
}

function showTriunfo() {
    const triunfoDiv = document.getElementById('triunfo');
    if (!triunfoDiv) return;
    
    triunfoDiv.querySelector('.card-name').textContent = state.triunfoCard?.name || '-';
    triunfoDiv.classList.remove('hidden');
    
    if (state.discardedCard) {
        const discardDiv = document.getElementById('discarded');
        if (discardDiv) {
            discardDiv.querySelector('.card-name').textContent = state.discardedCard.name;
            discardDiv.classList.remove('hidden');
        }
    }
}

// ==========================================
// BIDDING (FIXED - proper restriction logic)
// ==========================================

function renderBidding() {
    const container = document.getElementById('handContainer');
    const isMyTurn = state.currentTurn === state.mySeat;
    const myPlayer = state.players.find(p => p.id === state.playerId);
    const hasBid = myPlayer?.predicted_rounds !== null && myPlayer?.predicted_rounds !== undefined;
    
    let html = '';
    
    // Show cards first
    html += '<div style="margin-bottom: 2rem;"><h3 style="text-align: center; margin-bottom: 1rem; color: var(--highlight);">Your Cards</h3><div style="display: flex; gap: 0.75rem; flex-wrap: wrap; justify-content: center; margin-bottom: 1.5rem;">';
    
    state.myHand.forEach(card => {
        const isTriunfo = card.id === state.triunfoCard?.id;
        html += `
            <div class="card ${isTriunfo ? 'triunfo' : ''}" style="width: 120px; padding: 0.75rem; opacity: 0.9;">
                <div class="card-name" style="font-size: 0.85rem;">${card.name} ${isTriunfo ? '👑' : ''}</div>
                <div class="card-stats" style="grid-template-columns: repeat(5, 1fr); gap: 2px;">
                    ${ATTRIBUTES.map(attr => `
                        <div class="stat" style="padding: 2px;">
                            <span class="stat-label" style="font-size: 0.55rem;">${ATTR_NAMES[attr]}</span>
                            <span class="stat-value" style="font-size: 0.75rem; color: ${isTriunfo ? 'var(--warning)' : 'inherit'};">${isTriunfo ? 99 : card[attr]}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    });
    
    html += '</div></div>';
    
    // Bidding UI
    if (hasBid) {
        html += `
            <div class="waiting-message" style="padding: 2rem;">
                <h3 style="color: var(--success);">Bid placed: ${myPlayer.predicted_rounds}</h3>
                <p>Waiting for others...</p>
            </div>
        `;
    } else if (!isMyTurn) {
        const currentPlayer = state.players.find(p => p.seat_number === state.currentTurn);
        html += `
            <div class="waiting-message" style="padding: 2rem;">
                <p>Waiting for ${currentPlayer?.name || 'player'} to bid...</p>
            </div>
        `;
    } else {
        // FIXED: Properly calculate which bids are allowed
        const maxSeat = Math.max(...state.players.map(p => p.seat_number));
        const isLastBidder = state.currentTurn === maxSeat;
        
        // Get bids from players who have already bid (lower seat numbers)
        const previousBidders = state.players.filter(p => 
            p.seat_number < state.mySeat && 
            p.predicted_rounds !== null && 
            p.predicted_rounds !== undefined
        );
        
        const sumPreviousBids = previousBidders.reduce((sum, p) => sum + p.predicted_rounds, 0);
        const maxBid = state.totalRounds;
        
        html += `
            <div class="bidding-panel" style="text-align: center; padding: 1rem; background: rgba(0,0,0,0.2); border-radius: 12px;">
                <h3 style="margin-bottom: 1rem;">How many rounds will you win?</h3>
                <div class="bid-buttons" style="display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap;">
        `;
        
        for (let i = 0; i <= maxBid; i++) {
            // Only restrict if: I'm last bidder AND sum of previous bids + my bid would equal total rounds
            const wouldEqualTotal = isLastBidder && (sumPreviousBids + i === maxBid);
            const isDisabled = wouldEqualTotal;
            
            html += `
                <button class="bid-btn" onclick="placeBid(${i})" ${isDisabled ? 'disabled style="opacity: 0.3; cursor: not-allowed;"' : ''} 
                    style="width: 50px; height: 50px; border-radius: 50%; font-size: 1.2rem; font-weight: bold; background: ${isDisabled ? 'var(--text-dim)' : 'var(--accent)'}; color: white; border: none; cursor: pointer;">
                    ${i}
                </button>
            `;
        }
        
        html += '</div>';
        if (isLastBidder) {
            html += `<p style="color: var(--highlight); margin-top: 1rem; font-size: 0.9rem;">
                You're last! Sum of all bids cannot equal ${maxBid}.<br>
                Current sum of previous bids: ${sumPreviousBids}
            </p>`;
        }
        html += '</div>';
    }
    
    container.innerHTML = html;
}

async function placeBid(bid) {
    try {
        await supabaseClient
            .from('players')
            .update({ predicted_rounds: bid })
            .eq('id', state.playerId);
        
        addChat('System', `${state.playerName} bid ${bid}`);
        
        const maxSeat = Math.max(...state.players.map(p => p.seat_number));
        const nextTurn = state.currentTurn >= maxSeat ? 0 : state.currentTurn + 1;
        
        if (nextTurn === 0) {
            await supabaseClient
                .from('rooms')
                .update({ phase: 'playing', current_turn: 1, current_set: 1 })
                .eq('id', state.roomId);
        } else {
            await supabaseClient
                .from('rooms')
                .update({ current_turn: nextTurn })
                .eq('id', state.roomId);
        }
        
    } catch (err) {
        console.error('Bid error:', err);
        alert('Failed to place bid');
    }
}

// ==========================================
// PLAYING (FIXED - round resolution)
// ==========================================

async function loadMyHand() {
    try {
        const { data: handData, error } = await supabaseClient
            .from('player_hands')
            .select('*, cards(*)')
            .eq('room_id', state.roomId)
            .eq('player_id', state.playerId)
            .eq('played', false);
        
        if (error) throw error;
        
        state.myHand = (handData || []).map(h => ({
            ...h.cards,
            handId: h.id
        }));
        
    } catch (err) {
        console.error('Load hand error:', err);
    }
}

function renderHand() {
    const container = document.getElementById('handContainer');
    if (!container) return;
    
    if (state.phase !== 'playing') return;
    
    const isStarter = state.roundStarter === state.mySeat;
    const isMyTurn = state.currentTurn === state.mySeat;
    
    let html = '';
    
    if (isStarter && !state.currentAttribute && isMyTurn) {
        html += `
            <div class="attribute-panel" style="text-align: center; padding: 1rem; margin-bottom: 1rem; background: rgba(0,0,0,0.2); border-radius: 12px;">
                <h3 style="margin-bottom: 1rem;">Select Attribute</h3>
                <div class="attribute-buttons" style="display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap;">
                    ${ATTRIBUTES.map(attr => `
                        <button class="attr-btn ${attr}" onclick="selectAttribute('${attr}')" 
                            style="padding: 0.75rem 1.5rem; font-size: 1rem; font-weight: bold; text-transform: uppercase; border-radius: 8px; border: none; cursor: pointer; color: white;">
                            ${ATTR_NAMES[attr]}
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
    } else if (!state.currentAttribute) {
        const starter = state.players.find(p => p.seat_number === state.roundStarter);
        html += `
            <div class="waiting-message" style="text-align: center; padding: 1rem;">
                <p>Waiting for ${starter?.name} to select attribute...</p>
            </div>
        `;
    } else {
        html += `
            <div style="text-align: center; margin-bottom: 1rem; padding: 1rem; background: rgba(233, 69, 96, 0.1); border-radius: 8px;">
                <span style="color: var(--highlight); font-size: 1.3rem; font-weight: bold;">
                    Playing: ${ATTR_NAMES[state.currentAttribute]}
                </span>
                ${!isMyTurn ? '<p style="margin-top: 0.5rem;">Waiting for your turn...</p>' : '<p style="margin-top: 0.5rem; color: var(--success);">Double-click card to play</p>'}
            </div>
        `;
    }
    
    html += '<div style="display: flex; gap: 0.75rem; flex-wrap: wrap; justify-content: center;">';
    
    state.myHand.forEach(card => {
        const isTriunfo = card.id === state.triunfoCard?.id;
        const canPlay = isMyTurn && state.currentAttribute && !state.hasPlayedThisRound;
        
        html += `
            <div class="card ${isTriunfo ? 'triunfo' : ''}" 
                 ${canPlay ? `ondblclick="playCard(${card.id})"` : ''}
                 style="width: 130px; ${!canPlay ? 'opacity: 0.6;' : 'cursor: pointer;'} position: relative; z-index: 10;">
                <div class="card-name" style="font-weight: bold; text-align: center; margin-bottom: 0.5rem; padding-bottom: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.1);">
                    ${card.name} ${isTriunfo ? '👑' : ''}
                </div>
                <div class="card-stats" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; text-align: center;">
                    ${ATTRIBUTES.map(attr => `
                        <div class="stat ${state.currentAttribute === attr ? 'active' : ''}" 
                             style="background: rgba(0,0,0,0.3); padding: 4px 2px; border-radius: 4px; ${state.currentAttribute === attr ? 'background: var(--highlight); color: white;' : ''}">
                            <span class="stat-label" style="display: block; font-size: 0.65rem; color: ${state.currentAttribute === attr ? 'rgba(255,255,255,0.8)' : 'var(--text-dim)'};">${ATTR_NAMES[attr]}</span>
                            <span class="stat-value" style="display: block; font-weight: bold; font-size: 0.9rem; color: ${isTriunfo ? 'var(--warning)' : 'inherit'};">${isTriunfo ? 99 : card[attr]}</span>
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
    if (!state.currentAttribute || state.hasPlayedThisRound) {
        console.log('Cannot play:', { attr: state.currentAttribute, hasPlayed: state.hasPlayedThisRound });
        return;
    }
    
    const card = state.myHand.find(c => c.id === cardId);
    if (!card) {
        console.log('Card not found:', cardId);
        return;
    }
    
    const isTriunfo = card.id === state.triunfoCard?.id;
    const value = isTriunfo ? 99 : card[state.currentAttribute];
    
    console.log('Playing card:', card.name, 'value:', value);
    
    try {
        // Insert play
        const { error: insertError } = await supabaseClient.from('current_turn_plays').insert({
            room_id: state.roomId,
            player_id: state.playerId,
            card_id: cardId,
            attribute: state.currentAttribute,
            value: value,
            seat_number: state.mySeat
        });
        
        if (insertError) {
            console.error('Insert play error:', insertError);
            throw insertError;
        }
        
        // Mark card as played
        const { error: updateError } = await supabaseClient
            .from('player_hands')
            .update({ played: true })
            .eq('id', card.handId);
        
        if (updateError) {
            console.error('Update hand error:', updateError);
            throw updateError;
        }
        
        // Update local state
        state.myHand = state.myHand.filter(c => c.id !== cardId);
        state.hasPlayedThisRound = true;
        
        addChat('System', `${state.playerName} played ${card.name} (${value})`);
        
        // Check if round complete - FIXED: Use count query
        const { data: playCount, error: countError } = await supabaseClient
            .from('current_turn_plays')
            .select('id', { count: 'exact', head: true })
            .eq('room_id', state.roomId);
        
        if (countError) {
            console.error('Count error:', countError);
            throw countError;
        }
        
        const count = playCount.count || 0;
        console.log('Plays this round:', count, 'Players:', state.players.length);
        
        if (count >= state.players.length) {
            console.log('Round complete! Resolving...');
            setTimeout(resolveRound, 1500);
        } else {
            // Advance to next seat
            const nextTurn = (state.currentTurn % state.players.length) + 1;
            console.log('Advancing to next turn:', nextTurn);
            await supabaseClient
                .from('rooms')
                .update({ current_turn: nextTurn })
                .eq('id', state.roomId);
        }
        
        renderHand();
        
    } catch (err) {
        console.error('Play card error:', err);
        state.hasPlayedThisRound = false;
        alert('Failed to play card: ' + err.message);
    }
}

async function resolveRound() {
    console.log('Resolving round...');
    try {
        const { data: plays, error: playsError } = await supabaseClient
            .from('current_turn_plays')
            .select('*, players(*), cards(*)')
            .eq('room_id', state.roomId);
        
        if (playsError) {
            console.error('Plays fetch error:', playsError);
            throw playsError;
        }
        
        console.log('Plays to resolve:', plays);
        
        if (!plays || plays.length === 0) {
            console.error('No plays found!');
            return;
        }
        
        // Find winner
        const winner = plays.reduce((best, play) => {
            if (play.value > best.value) return play;
            if (play.value === best.value) {
                const playTotal = ATTRIBUTES.reduce((sum, attr) => sum + play.cards[attr], 0);
                const bestTotal = ATTRIBUTES.reduce((sum, attr) => sum + best.cards[attr], 0);
                if (playTotal > bestTotal) return play;
            }
            return best;
        });
        
        console.log('Winner:', winner);
        
        const winnerPlayer = state.players.find(p => p.id === winner.player_id);
        
        // Update winner's score
        const { error: updateError } = await supabaseClient
            .from('players')
            .update({ won_rounds: (winnerPlayer.won_rounds || 0) + 1 })
            .eq('id', winner.player_id);
        
        if (updateError) {
            console.error('Update winner error:', updateError);
            throw updateError;
        }
        
        addChat('System', `🏆 ${winnerPlayer.name} wins the round with ${winner.cards.name} (${winner.value})!`);
        
        // Clear plays
        await supabaseClient.from('current_turn_plays').delete().eq('room_id', state.roomId);
        
        state.hasPlayedThisRound = false;
        state.currentAttribute = null;
        
        // Check if game over
        const { data: remaining, error: remainingError } = await supabaseClient
            .from('player_hands')
            .select('*')
            .eq('room_id', state.roomId)
            .eq('played', false);
        
        if (remainingError) throw remainingError;
        
        console.log('Cards remaining:', remaining.length);
        
        if (remaining.length === 0) {
            console.log('Game over - no cards left');
            await supabaseClient
                .from('rooms')
                .update({ phase: 'scoring' })
                .eq('id', state.roomId);
        } else {
            // Next set
            const nextSet = state.currentSet + 1;
            console.log('Next set:', nextSet, 'Starter:', winnerPlayer.seat_number);
            
            await supabaseClient
                .from('rooms')
                .update({
                    current_set: nextSet,
                    current_turn: winnerPlayer.seat_number,
                    current_attribute: null,
                    game_data: { round_starter: winnerPlayer.seat_number }
                })
                .eq('id', state.roomId);
            
            await loadMyHand();
            renderHand();
        }
        
    } catch (err) {
        console.error('Resolve round error:', err);
        alert('Error resolving round: ' + err.message);
    }
}

async function calculateScores() {
    try {
        const { data: players } = await supabaseClient
            .from('players')
            .select('*')
            .eq('room_id', state.roomId);
        
        state.players = players;
        
        let scoreHtml = '<div class="score-results">';
        
        for (const p of players) {
            const bid = p.predicted_rounds || 0;
            const won = p.won_rounds || 0;
            const correct = bid === won;
            let points = (won * 2) + (correct ? 3 : -2);
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
                        <span style="color: ${correct ? 'var(--success)' : 'var(--highlight)'}">${correct ? '✓ Exact!' : '✗ Miss'}</span>
                    </div>
                    <div style="margin-top: 0.5rem; font-size: 1.1rem;">${won}×2 ${correct ? '+3' : '-2'} = <strong>${points} points</strong></div>
                </div>
            `;
        }
        
        scoreHtml += '</div>';
        
        document.getElementById('handContainer').innerHTML = `
            <div style="text-align: center; padding: 2rem;">
                <h2>Game Over!</h2>
                ${scoreHtml}
                ${state.isHost ? '<button onclick="resetGame()" style="margin-top: 2rem; padding: 1rem 2rem; font-size: 1.1rem; background: var(--success); border: none; border-radius: 8px; color: white; cursor: pointer;">Play Again</button>' : ''}
            </div>
        `;
        
        updateScoreboard();
        
    } catch (err) {
        console.error('Calculate scores error:', err);
    }
}

async function resetGame() {
    state.gameStarting = false;
    const btn = document.getElementById('startBtn');
    if (btn) {
        btn.disabled = false;
        btn.textContent = '🚀 Start Game';
    }
    
    await supabaseClient
        .from('rooms')
        .update({ 
            status: 'waiting', 
            phase: 'waiting',
            current_turn: 0,
            current_set: 0,
            current_attribute: null,
            triunfo_card_id: null,
            game_data: {}
        })
        .eq('id', state.roomId);
}

// ==========================================
// REALTIME & UI (FIXED - show played cards)
// ==========================================

function setupRealtime() {
    supabaseClient
        .channel(`room-${state.roomId}`)
        .on('postgres_changes', 
            { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${state.roomId}` },
            async (payload) => {
                const room = payload.new;
                
                if (payload.old.phase !== room.phase) {
                    if (room.phase === 'triunfo' && room.triunfo_card_id) {
                        const { data: card } = await supabaseClient
                            .from('cards')
                            .select('*')
                            .eq('id', room.triunfo_card_id)
                            .single();
                        state.triunfoCard = card;
                    }
                    enterPhase(room.phase, true);
                }
                
                state.currentSet = room.current_set || 0;
                state.currentTurn = room.current_turn || 0;
                state.currentAttribute = room.current_attribute;
                
                if (room.game_data?.round_starter) {
                    state.roundStarter = room.game_data.round_starter;
                }
                
                updateTurnIndicator();
                highlightActiveSeat();
                
                if (room.phase === 'playing') {
                    if (payload.old.current_set !== room.current_set) {
                        state.hasPlayedThisRound = false;
                        await loadMyHand();
                    }
                    renderHand();
                }
            }
        )
        .subscribe();
    
    supabaseClient
        .channel(`players-${state.roomId}`)
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'players', filter: `room_id=eq.${state.roomId}` },
            async () => {
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
    
    // FIXED: Also listen for plays to update the table display
    supabaseClient
        .channel(`plays-${state.roomId}`)
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'current_turn_plays', filter: `room_id=eq.${state.roomId}` },
            () => {
                console.log('Plays updated, refreshing...');
                loadTablePlays();
            }
        )
        .subscribe();
}

async function loadTablePlays() {
    const { data: plays, error } = await supabaseClient
        .from('current_turn_plays')
        .select('*, players(name, seat_number), cards(*)')
        .eq('room_id', state.roomId)
        .order('created_at', { ascending: true });
    
    if (error) {
        console.error('Load table plays error:', error);
        return;
    }
    
    console.log('Loaded plays:', plays);
    
    // Update the center plays display
    const container = document.getElementById('playsContainer');
    if (!container) return;
    
    if (!plays?.length) {
        container.innerHTML = '<p style="color: var(--text-dim); font-size: 0.9rem;">No cards played yet</p>';
        return;
    }
    
    container.innerHTML = plays.map(play => `
        <div class="played-card" style="background: var(--card-bg); padding: 0.75rem; border-radius: 8px; min-width: 100px; text-align: center; border: 2px solid ${play.seat_number === state.roundStarter ? 'var(--warning)' : 'var(--accent)'}; animation: fadeIn 0.3s ease;">
            <div style="font-size: 0.75rem; color: var(--text-dim); margin-bottom: 0.25rem;">${play.players.name}</div>
            <div style="font-size: 0.85rem; font-weight: bold; margin-bottom: 0.25rem;">${play.cards.name}</div>
            <div style="font-size: 1.3rem; font-weight: bold; color: var(--highlight);">${play.value}</div>
            <div style="font-size: 0.65rem; color: var(--text-dim); margin-top: 0.25rem;">${ATTR_NAMES[play.attribute]}</div>
        </div>
    `).join('');
}

async function loadGameState(room) {
    if (room.triunfo_card_id) {
        const { data: card } = await supabaseClient
            .from('cards')
            .select('*')
            .eq('id', room.triunfo_card_id)
            .single();
        state.triunfoCard = card;
    }
    
    state.currentSet = room.current_set || 0;
    state.currentTurn = room.current_turn || 0;
    state.currentAttribute = room.current_attribute;
    
    if (room.game_data?.round_starter) {
        state.roundStarter = room.game_data.round_starter;
    }
    
    if (room.phase === 'playing') {
        await loadMyHand();
    }
}

function updateSeatDisplay() {
    state.players.forEach(p => {
        const seatEl = document.getElementById(`seat-${p.seat_number}`);
        if (seatEl) {
            seatEl.querySelector('.seat-name').textContent = p.name;
            const bidEl = seatEl.querySelector('.seat-bid');
            
            if (p.predicted_rounds !== null && p.predicted_rounds !== undefined) {
                bidEl.textContent = `Bid: ${p.predicted_rounds}`;
                bidEl.classList.add('placed');
            } else {
                bidEl.textContent = state.phase === 'bidding' ? 'Bidding...' : '-';
                bidEl.classList.remove('placed');
            }
        }
    });
    
    for (let i = 1; i <= 5; i++) {
        if (!state.players.some(p => p.seat_number === i)) {
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
    if (state.currentTurn > 0) {
        const seatEl = document.getElementById(`seat-${state.currentTurn}`);
        if (seatEl) seatEl.classList.add('active');
    }
}

function updateTurnIndicator() {
    const indicator = document.getElementById('turn-indicator');
    if (!indicator) return;
    
    if (state.phase === 'waiting') {
        indicator.textContent = 'Waiting for host...';
    } else if (state.phase === 'triunfo') {
        indicator.textContent = 'El Triunfo revealed!';
    } else if (state.phase === 'bidding') {
        const current = state.players.find(p => p.seat_number === state.currentTurn);
        indicator.textContent = current ? `${current.name} is bidding...` : 'Bidding...';
    } else if (state.phase === 'playing') {
        if (state.currentAttribute) {
            const current = state.players.find(p => p.seat_number === state.currentTurn);
            indicator.textContent = `Set ${state.currentSet} - ${ATTR_NAMES[state.currentAttribute]} - ${current?.name}'s turn`;
        } else {
            const starter = state.players.find(p => p.seat_number === state.roundStarter);
            indicator.textContent = `${starter?.name} selects attribute...`;
        }
    }
}

function updatePhaseInfo(msg) {
    const el = document.getElementById('phaseInfo');
    if (!el) return;
    
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
    if (!controls) return;

    if (state.isHost && state.phase === 'waiting') {
        controls.classList.remove('hidden');
        const minPlayers = controls.querySelector('.min-players');
        if (minPlayers) {
            minPlayers.textContent = state.players.length < 2 
                ? `Need ${2 - state.players.length} more player(s)` 
                : 'Ready to start!';
        }
    } else {
        controls.classList.add('hidden');
    }
}

function updatePlayerCount() {
    const el = document.getElementById('playerCount');
    if (el) el.textContent = state.players.length;
}

function updatePlayerList() {
    const list = document.getElementById('playerList');
    if (!list) return;
    
    list.innerHTML = state.players.map(p => `
        <li style="padding: 0.5rem; margin-bottom: 0.25rem; background: rgba(255,255,255,0.05); border-radius: 4px; display: flex; justify-content: space-between;">
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
        <div class="score-item" style="padding: 0.5rem; margin-bottom: 0.25rem; background: rgba(255,255,255,0.05); border-radius: 4px; display: flex; justify-content: space-between;">
            <span class="name" style="color: var(--text-dim);">${p.name}</span>
            <span class="points" style="font-weight: bold; color: var(--success);">${p.total_score || 0}</span>
        </div>
    `).join('');
}

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
    if (!log) return;
    
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isSystem = sender === 'System';
    
    const div = document.createElement('div');
    div.className = `chat-message ${isSystem ? 'system' : ''}`;
    div.style.cssText = 'padding: 0.4rem; margin-bottom: 0.25rem; border-radius: 4px; background: rgba(255,255,255,0.03); font-size: 0.85rem;';
    div.innerHTML = `
        <span style="color: var(--text-dim); font-size: 0.75rem;">[${time}]</span>
        <span style="font-weight: bold; color: ${isSystem ? 'var(--warning)' : 'var(--highlight)'};">${sender}:</span>
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

window.addEventListener('beforeunload', async () => {
    if (state.phase === 'waiting') {
        await supabaseClient.from('players').delete().eq('id', state.playerId);
    }
});