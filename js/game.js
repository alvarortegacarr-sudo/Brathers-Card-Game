// ==========================================
// BRA - UPGRADED AESTHETIC VERSION
// ==========================================

const ATTRIBUTES = ['car', 'cul', 'tet', 'fis', 'per'];
const ATTR_NAMES = { car: 'CAR', cul: 'CUL', tet: 'TET', fis: 'FIS', per: 'PER' };
const CARDS_PER_PLAYER = { 2: 20, 3: 13, 4: 10, 5: 8 };

const CATEGORY_LABELS = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', leyend: 'Leyend', toti: 'Toti' };

function cardCategoryClass(card) {
    if (!card.category) return '';
    return `cat-${card.category.toLowerCase()}`;
}

function cardBadgeHTML(card) {
    if (!card.category) return '';
    const label = CATEGORY_LABELS[card.category.toLowerCase()] || card.category;
    return `<div class="category-badge">${label}</div>`;
}

// ── NEW: returns the avg badge HTML for any card object ──────────────────────
// Uses the stored `avg` column if available; falls back to computing it live.
function cardAvgBadgeHTML(card, isTriunfo = false) {
    if (isTriunfo) {
        return `<div class="avg-badge">AVG 100</div>`;
    }
    let avg;
    if (card.avg !== null && card.avg !== undefined) {
        avg = Math.round(card.avg);
    } else {
        const sum = ATTRIBUTES.reduce((s, a) => s + (card[a] || 0), 0);
        avg = Math.round(sum / ATTRIBUTES.length);
    }
    return `<div class="avg-badge">AVG ${avg}</div>`;
}

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
    cachedPlays: [],
    isResolvingRound: false
};

if (!localStorage.getItem('playerId')) {
    localStorage.setItem('playerId', state.playerId);
}

// ===================== ANIMATION HELPERS =====================

function showPhaseOverlay(title, subtitle, duration = 3500) {
    const existing = document.getElementById('phaseOverlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'phaseOverlay';
    overlay.className = 'phase-overlay';
    overlay.innerHTML = `
        <div class="phase-divider"></div>
        <div class="phase-title-big">${title}</div>
        <div class="phase-subtitle-big">${subtitle}</div>
        <div class="phase-divider"></div>
    `;
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
        overlay.classList.add('show');
    });

    setTimeout(() => {
        overlay.remove();
    }, duration);
}

function spawnParticles(x, y, count = 18, colors = ['#d4a017', '#f5d78e', '#fff3b0', '#c8941a']) {
    for (let i = 0; i < count; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        
        const angle = (i / count) * Math.PI * 2;
        const speed = 60 + Math.random() * 120;
        const dx = Math.cos(angle) * speed + 'px';
        const dy = (Math.sin(angle) * speed - 60) + 'px';
        const size = 4 + Math.random() * 8;
        const color = colors[Math.floor(Math.random() * colors.length)];

        particle.style.cssText = `
            left: ${x}px;
            top: ${y}px;
            width: ${size}px;
            height: ${size}px;
            background: ${color};
            --dx: ${dx};
            --dy: ${dy};
            animation-duration: ${0.8 + Math.random() * 0.6}s;
            animation-delay: ${Math.random() * 0.15}s;
        `;
        document.body.appendChild(particle);
        setTimeout(() => particle.remove(), 1500);
    }
}

function spawnWinnerParticles() {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    spawnParticles(cx, cy, 30);
    setTimeout(() => spawnParticles(cx - 150, cy - 50, 15), 200);
    setTimeout(() => spawnParticles(cx + 150, cy - 50, 15), 350);
    setTimeout(() => spawnParticles(cx, cy - 80, 20), 500);
}

function animateCardEntry(element, delay = 0) {
    element.style.animationDelay = `${delay}s`;
    element.style.animationFillMode = 'both';
}

// ===================== INIT =====================

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
        
        state.cardsPerPlayer = CARDS_PER_PLAYER[state.players.length] || 8;
        state.totalRounds = state.cardsPerPlayer;
        
        updatePlayerCount();
        updateSeatDisplay();
        updateHostControls();

        setupRealtime();

        if (room.status === 'playing') {
            await loadGameState(room);
            if (state.phase !== 'waiting') {
                initPhase(state.phase);
            }
        }

        addChat('System', 'Welcome to Bra! 🎴');
        
    } catch (err) {
        console.error('Init error:', err);
        alert('Failed to initialize game');
    }
});

// ===================== START GAME =====================

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
        
        state.cachedPlays = [];
        state.isResolvingRound = false;
        
        for (const p of state.players) {
            await supabaseClient
                .from('players')
                .update({ predicted_rounds: null, won_rounds: 0 })
                .eq('id', p.id);
        }

        const { data: allCards } = await supabaseClient.from('cards').select('*');
        state.allCards = allCards;
        
        const shuffled = [...allCards].sort(() => Math.random() - 0.5);
        
        const triunfoIndex = Math.floor(Math.random() * shuffled.length);
        const triunfo = shuffled[triunfoIndex];
        state.triunfoCard = triunfo;
        
        let discarded = null;
        if (state.players.length === 3) {
            const availableForDiscard = shuffled.filter((_, i) => i !== triunfoIndex);
            const discardIndex = Math.floor(Math.random() * availableForDiscard.length);
            discarded = availableForDiscard[discardIndex];
            state.discardedCard = discarded;
            
            const discardGlobalIndex = shuffled.findIndex(c => c.id === discarded.id);
            shuffled.splice(discardGlobalIndex, 1);
        }

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
                current_set: 1,
                current_turn: 1,
                current_attribute: null,
                game_data: { round_starter: 1 }
            })
            .eq('id', state.roomId);

        addChat('System', `👑 El Triunfo is ${triunfo.name}!`);
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

// ===================== PHASE MANAGEMENT =====================

function initPhase(phase) {
    console.log('Initializing phase:', phase);
    state.phase = phase;
    updatePhaseInfo();
    
    switch(phase) {
        case 'triunfo':
            showPhaseOverlay('EL TRIUNFO', state.triunfoCard?.name || '—', 3500);
            showTriunfo();
            setTimeout(() => {
                const cx = window.innerWidth / 2;
                const cy = window.innerHeight / 2;
                spawnParticles(cx, cy - 80, 25);
            }, 400);
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
            break;
            
        case 'bidding':
            showPhaseOverlay('BIDDING', 'How many rounds will you win?', 2500);
            loadMyHand().then(() => renderBidding());
            break;
            
        case 'playing':
            state.currentSet = 1;
            state.roundStarter = 1;
            state.currentTurn = 1;
            state.hasPlayedThisRound = false;
            state.cachedPlays = [];
            state.isResolvingRound = false;
            showPhaseOverlay('PLAY', 'Choose your attribute — fight!', 2000);
            loadMyHand().then(() => {
                renderHand();
                updateTurnIndicator();
                renderTableCards();
            });
            break;
            
        case 'scoring':
            showPhaseOverlay('FINAL SCORE', 'The results are in...', 2500);
            setTimeout(() => calculateScores(), 1200);
            break;
    }
    
    updateSeatDisplay();
}

function updatePhaseUI() {
    switch(state.phase) {
        case 'bidding':
            renderBidding();
            break;
        case 'playing':
            renderHand();
            updateTurnIndicator();
            highlightActiveSeat();
            break;
    }
}

// ===================== TRIUNFO DISPLAY =====================

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

// ===================== BIDDING =====================

function renderBidding() {
    const container = document.getElementById('handContainer');
    if (!container) return;
    
    const isMyTurn = state.currentTurn === state.mySeat;
    const myPlayer = state.players.find(p => p.id === state.playerId);
    const hasBid = myPlayer?.predicted_rounds !== null && myPlayer?.predicted_rounds !== undefined;
    
    const calculatedCardsPerPlayer = CARDS_PER_PLAYER[state.players.length] || 8;
    const maxBid = calculatedCardsPerPlayer;
    
    let html = '';
    
    html += `<div style="margin-bottom: 1.5rem;">
        <h3 style="text-align: center; margin-bottom: 1rem; font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.2em; color: var(--gold); font-size: 1.2rem;">Your Cards</h3>
        <div style="display: flex; gap: 0.6rem; flex-wrap: wrap; justify-content: center; margin-bottom: 1.5rem;">`;
    
    state.myHand.forEach((card, idx) => {
        const isTriunfo = card.id === state.triunfoCard?.id;
        const catClass = isTriunfo ? 'triunfo' : cardCategoryClass(card);
        html += `
            <div class="card ${catClass}" style="opacity: 0.9; animation-delay: ${idx * 0.05}s;">
                ${cardAvgBadgeHTML(card, isTriunfo)}
                ${cardBadgeHTML(card)}
                <div class="card-name" style="font-size: 0.8rem;">${card.name} ${isTriunfo ? '👑' : ''}</div>
                <div class="card-stats">
                    ${ATTRIBUTES.map(attr => `
                        <div class="stat">
                            <span class="stat-label">${ATTR_NAMES[attr]}</span>
                            <span class="stat-value" style="${isTriunfo ? 'color: var(--gold-dark);' : ''}">${isTriunfo ? 100 : card[attr]}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    });
    
    html += '</div></div>';
    
    if (hasBid) {
        html += `
            <div style="text-align: center; padding: 1.5rem; background: rgba(212,160,23,0.08); border: 1px solid var(--gold-dark); border-radius: 10px;">
                <div style="font-family: 'Bebas Neue', sans-serif; font-size: 1.8rem; color: var(--gold); letter-spacing: 0.2em;">Bid Placed: ${myPlayer.predicted_rounds}</div>
                <p style="color: var(--text-dim); margin-top: 0.5rem; letter-spacing: 0.05em;">Waiting for others...</p>
            </div>
        `;
    } else if (!isMyTurn) {
        const currentPlayer = state.players.find(p => p.seat_number === state.currentTurn);
        html += `
            <div style="text-align: center; padding: 1.5rem; color: var(--text-dim); font-style: italic;">
                <p>Waiting for <strong style="color: var(--gold);">${currentPlayer?.name || 'player'}</strong> to bid...</p>
            </div>
        `;
    } else {
        const sortedSeats = state.players.map(p => p.seat_number).sort((a,b) => a-b);
        const maxSeat = Math.max(...sortedSeats);
        const isLastBidder = state.currentTurn === maxSeat;
        
        const previousBidders = state.players.filter(p => 
            p.seat_number < state.mySeat && 
            p.predicted_rounds !== null && 
            p.predicted_rounds !== undefined
        );
        
        const sumPreviousBids = previousBidders.reduce((sum, p) => sum + (p.predicted_rounds || 0), 0);
        
        html += `
            <div style="text-align: center; padding: 1rem; background: rgba(0,0,0,0.3); border: 1px solid var(--gold-dark); border-radius: 12px;">
                <h3 style="font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.2em; color: var(--gold); margin-bottom: 1rem; font-size: 1.1rem;">How many rounds will you win?</h3>
                <div style="display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap;">
        `;
        
        for (let i = 0; i <= maxBid; i++) {
            const totalWouldBe = sumPreviousBids + i;
            const wouldEqualTotal = isLastBidder && (totalWouldBe === maxBid);
            const isDisabled = wouldEqualTotal;
            
            html += `
                <button class="bid-btn" onclick="placeBid(${i})" ${isDisabled ? 'disabled' : ''}
                    style="${isDisabled ? 'opacity: 0.25 !important; cursor: not-allowed !important;' : ''}">
                    ${i}
                </button>
            `;
        }
        
        html += '</div>';
        if (isLastBidder) {
            html += `<p style="color: var(--gold); margin-top: 1rem; font-size: 0.85rem; letter-spacing: 0.05em;">
                You're last! Sum cannot equal ${maxBid} · Previous sum: ${sumPreviousBids}
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
        
        const sortedSeats = state.players.map(p => p.seat_number).sort((a,b) => a-b);
        const currentIdx = sortedSeats.indexOf(state.currentTurn);
        const nextIdx = (currentIdx + 1) % sortedSeats.length;
        const nextTurn = sortedSeats[nextIdx];
        
        const isLastBidder = nextTurn === sortedSeats[0] && currentIdx === sortedSeats.length - 1;
        
        if (isLastBidder) {
            await supabaseClient
                .from('rooms')
                .update({ phase: 'playing', current_turn: sortedSeats[0], current_set: 1 })
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

// ===================== HAND LOADING =====================

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

// ===================== RENDER HAND =====================

function renderHand() {
    const container = document.getElementById('handContainer');
    if (!container) return;
    
    if (state.phase !== 'playing') return;
    
    const isStarter = state.roundStarter === state.mySeat;
    const isMyTurn = state.currentTurn === state.mySeat;
    
    let html = '';
    
    if (isStarter && !state.currentAttribute && isMyTurn) {
        html += `
            <div style="text-align: center; padding: 0.75rem 1rem; margin-bottom: 1rem; background: rgba(0,0,0,0.3); border: 1px solid var(--gold-dark); border-radius: 12px;">
                <h3 style="font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.2em; color: var(--gold); margin-bottom: 0.75rem; font-size: 1.1rem;">Select Attribute</h3>
                <div style="display: flex; gap: 0.6rem; justify-content: center; flex-wrap: wrap;">
                    ${ATTRIBUTES.map(attr => `
                        <button class="attr-btn ${attr}" onclick="selectAttribute('${attr}')">
                            ${ATTR_NAMES[attr]}
                        </button>
                    `).join('')}
                </div>
            </div>
        `;
    } else if (!state.currentAttribute) {
        const starter = state.players.find(p => p.seat_number === state.roundStarter);
        html += `
            <div style="text-align: center; padding: 0.75rem; color: var(--text-dim); font-style: italic; margin-bottom: 0.75rem;">
                Waiting for <strong style="color: var(--gold);">${starter?.name}</strong> to select attribute...
            </div>
        `;
    } else {
        html += `
            <div style="text-align: center; margin-bottom: 0.75rem; padding: 0.6rem 1rem; background: rgba(212,160,23,0.1); border: 1px solid var(--gold-dark); border-radius: 8px; display: flex; align-items: center; justify-content: center; gap: 1rem;">
                <span style="font-family: 'Bebas Neue', sans-serif; color: var(--gold); font-size: 1.2rem; letter-spacing: 0.2em;">
                    Playing: ${ATTR_NAMES[state.currentAttribute]}
                </span>
                ${!isMyTurn 
                    ? '<span style="color: var(--text-dim); font-size: 0.85rem;">Waiting for your turn...</span>'
                    : '<span style="color: var(--success); font-size: 0.85rem; font-weight: 600;">Double-click to play</span>'
                }
            </div>
        `;
    }
    
    html += '<div style="display: flex; gap: 0.6rem; flex-wrap: wrap; justify-content: center;">';
    
    state.myHand.forEach((card, idx) => {
        const isTriunfo = card.id === state.triunfoCard?.id;
        const catClass = isTriunfo ? 'triunfo' : cardCategoryClass(card);
        const canPlay = isMyTurn && state.currentAttribute && !state.hasPlayedThisRound;
        
        html += `
            <div class="card ${catClass}" 
                 ${canPlay ? `ondblclick="playCard(${card.id})"` : ''}
                 style="${!canPlay ? 'opacity: 0.55; cursor: default;' : 'cursor: pointer;'} animation-delay: ${idx * 0.04}s;">
                ${cardAvgBadgeHTML(card, isTriunfo)}
                ${cardBadgeHTML(card)}
                <div class="card-name">
                    ${card.name} ${isTriunfo ? '👑' : ''}
                </div>
                <div class="card-stats">
                    ${ATTRIBUTES.map(attr => `
                        <div class="stat ${state.currentAttribute === attr ? 'active' : ''}">
                            <span class="stat-label">${ATTR_NAMES[attr]}</span>
                            <span class="stat-value" style="${isTriunfo ? 'color: var(--gold-dark);' : ''}">${isTriunfo ? 100 : card[attr]}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

// ===================== SELECT ATTRIBUTE =====================

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

// ===================== PLAY CARD =====================

async function playCard(cardId) {
    if (!state.currentAttribute || state.hasPlayedThisRound || state.isResolvingRound) {
        return;
    }
    
    const card = state.myHand.find(c => c.id === cardId);
    if (!card) return;
    
    const isTriunfo = card.id === state.triunfoCard?.id;
    const value = isTriunfo ? 100 : card[state.currentAttribute];
    
    try {
        const { data: existingPlay } = await supabaseClient
            .from('current_turn_plays')
            .select('id')
            .eq('room_id', state.roomId)
            .eq('player_id', state.playerId)
            .maybeSingle();
        
        if (existingPlay) {
            state.hasPlayedThisRound = true;
            return;
        }
        
        const { data: insertedPlay, error: insertError } = await supabaseClient
            .from('current_turn_plays')
            .insert({
                room_id: state.roomId,
                player_id: state.playerId,
                card_id: cardId,
                attribute: state.currentAttribute,
                value: value,
                seat_number: state.mySeat
            })
            .select()
            .single();
        
        if (insertError) throw insertError;
        
        await supabaseClient
            .from('player_hands')
            .update({ played: true })
            .eq('id', card.handId);
        
        state.myHand = state.myHand.filter(c => c.id !== cardId);
        state.hasPlayedThisRound = true;

        addChat('System', `${state.playerName} played ${card.name} (${value})`);
        
        const sortedSeats = state.players.map(p => p.seat_number).sort((a,b) => a-b);
        const currentIdx = sortedSeats.indexOf(state.currentTurn);
        const nextIdx = (currentIdx + 1) % sortedSeats.length;
        const nextTurn = sortedSeats[nextIdx];
        
        await supabaseClient
            .from('rooms')
            .update({ current_turn: nextTurn })
            .eq('id', state.roomId);
        
        renderHand();
        
    } catch (err) {
        console.error('Play card error:', err);
        state.hasPlayedThisRound = false;
        alert('Failed to play card: ' + err.message);
    }
}

// ===================== RENDER TABLE CARDS =====================

function renderTableCards() {
    const container = document.getElementById('playsContainer');
    if (!container) return;
    
    if (state.cachedPlays.length === 0) {
        container.innerHTML = '<p class="no-cards">Waiting for cards...</p>';
        return;
    }
    
    container.innerHTML = state.cachedPlays.map((play, index) => {
        const isTriunfo = play.cards.id === state.triunfoCard?.id;
        const isStarter = play.seat_number === state.roundStarter;
        const catClass = isTriunfo ? '' : (play.cards.category ? `cat-${play.cards.category.toLowerCase()}` : '');
        const badgeHTML = (play.cards.category && !isTriunfo)
            ? `<div class="category-badge" style="margin-bottom:4px;">${CATEGORY_LABELS[play.cards.category.toLowerCase()] || play.cards.category}</div>`
            : '';

        // avg for played cards on the table
        const avgBadge = cardAvgBadgeHTML(play.cards, isTriunfo);
        
        return `
        <div class="played-card ${isStarter ? 'starter' : ''} ${catClass}" style="animation-delay: ${index * 0.1}s;">
            ${avgBadge}
            <div class="player-name">${play.players.name}</div>
            ${badgeHTML}
            <div class="card-name">${play.cards.name}</div>
            <div class="value">${play.value}</div>
            <div class="attribute">${ATTR_NAMES[play.attribute]}</div>
            ${isTriunfo ? '<div class="triunfo-icon">👑</div>' : ''}
        </div>
    `}).join('');
}

// ===================== RESOLVE ROUND =====================

async function resolveRound() {
    if (!state.isHost) return;
    
    try {
        const { data: plays, error } = await supabaseClient
            .from('current_turn_plays')
            .select('*, players(name, seat_number, won_rounds), cards(*)')
            .eq('room_id', state.roomId);
        
        if (error || !plays || plays.length < state.players.length) {
            state.isResolvingRound = false;
            return;
        }
        
        const winner = plays.reduce((best, play) => {
            if (play.value > best.value) return play;
            if (play.value === best.value) {
                // tiebreaker: highest total across all attributes (= highest avg)
                const playTotal = ATTRIBUTES.reduce((sum, attr) => sum + (play.cards[attr] || 0), 0);
                const bestTotal = ATTRIBUTES.reduce((sum, attr) => sum + (best.cards[attr] || 0), 0);
                if (playTotal > bestTotal) return play;
            }
            return best;
        });
        
        const newWonRounds = (winner.players.won_rounds || 0) + 1;
        await supabaseClient
            .from('players')
            .update({ won_rounds: newWonRounds })
            .eq('id', winner.player_id);
        
        await supabaseClient
            .from('rooms')
            .update({
                game_data: { 
                    round_starter: state.roundStarter,
                    round_winner: {
                        name: winner.players.name,
                        cardName: winner.cards.name,
                        value: winner.value
                    }
                }
            })
            .eq('id', state.roomId);

        await new Promise(r => setTimeout(r, 3000));
        
        await supabaseClient.from('current_turn_plays').delete().eq('room_id', state.roomId);
        
        const { data: remaining } = await supabaseClient
            .from('player_hands')
            .select('*')
            .eq('room_id', state.roomId)
            .eq('played', false);
        
        if (remaining.length === 0) {
            await supabaseClient
                .from('rooms')
                .update({ phase: 'scoring' })
                .eq('id', state.roomId);
        } else {
            const nextSet = state.currentSet + 1;
            
            const sortedSeats = state.players.map(p => p.seat_number).sort((a, b) => a - b);
            const currentStarterIdx = sortedSeats.indexOf(state.roundStarter);
            const nextStarterIdx = (currentStarterIdx + 1) % sortedSeats.length;
            const nextStarter = sortedSeats[nextStarterIdx];

            await supabaseClient
                .from('rooms')
                .update({
                    current_set: nextSet,
                    current_turn: nextStarter,
                    current_attribute: null,
                    game_data: { round_starter: nextStarter }
                })
                .eq('id', state.roomId);
        }
        
    } catch (err) {
        console.error('Resolve round error:', err);
    } finally {
        state.isResolvingRound = false;
    }
}

// ===================== SCORING =====================

async function calculateScores() {
    try {
        const { data: players } = await supabaseClient
            .from('players')
            .select('*')
            .eq('room_id', state.roomId);
        
        state.players = players;
        
        let scoreHtml = '<div class="score-results">';
        
        for (let i = 0; i < players.length; i++) {
            const p = players[i];
            const bid = p.predicted_rounds || 0;
            const won = p.won_rounds || 0;
            const correct = bid === won;
            let points = (won * 2) + (correct ? 3 : -3);
            const newTotal = (p.total_score || 0) + points;
            
            await supabaseClient
                .from('players')
                .update({ total_score: newTotal })
                .eq('id', p.id);
            
            scoreHtml += `
                <div class="score-item" style="animation-delay: ${i * 0.15}s;">
                    <div style="font-family: 'Bebas Neue', sans-serif; font-size: 1.1rem; letter-spacing: 0.1em; color: var(--gold); margin-bottom: 0.4rem;">${p.name}</div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.9rem; color: var(--text-dim);">
                        <span>Bid: ${bid} · Won: ${won}</span>
                        <span style="color: ${correct ? 'var(--success)' : 'var(--danger)'}; font-weight: 700;">${correct ? '✓ Exact!' : '✗ Miss'}</span>
                    </div>
                    <div style="margin-top: 0.4rem; font-family: 'Bebas Neue', sans-serif; font-size: 1.3rem; color: var(--text);">
                        ${won}×2 ${correct ? '+3' : '−2'} = <span style="color: var(--gold);">${points} pts</span>
                    </div>
                </div>
            `;
        }
        
        scoreHtml += '</div>';
        
        document.getElementById('handContainer').innerHTML = `
            <div style="text-align: center; padding: 1.5rem;">
                <div style="font-family: 'Bebas Neue', sans-serif; font-size: 2.5rem; letter-spacing: 0.3em; background: linear-gradient(180deg, var(--gold-shine) 0%, var(--gold) 50%, var(--gold-dark) 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; filter: drop-shadow(0 2px 10px rgba(212,160,23,0.5)); margin-bottom: 0.25rem;">Game Over</div>
                <div style="width: 200px; height: 1px; background: linear-gradient(90deg, transparent, var(--gold), transparent); margin: 0 auto 1.5rem;"></div>
                ${scoreHtml}
                ${state.isHost ? `<button onclick="resetGame()" style="margin-top: 1.5rem; padding: 0.75rem 2rem; font-size: 1rem; background: linear-gradient(135deg, #1a5c2a 0%, #2d8a4e 50%, #1a5c2a 100%); border-color: #48bb78; color: #fff;">Play Again</button>` : ''}
            </div>
        `;
        
        updateScoreboard();
        setTimeout(() => spawnWinnerParticles(), 400);
        
    } catch (err) {
        console.error('Calculate scores error:', err);
    }
}

// ===================== RESET =====================

async function resetGame() {
    state.gameStarting = false;
    state.cachedPlays = [];
    state.isResolvingRound = false;
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

// ===================== REALTIME =====================

function setupRealtime() {
    console.log('Setting up realtime...');
    
    supabaseClient
        .channel(`room-${state.roomId}`)
        .on('postgres_changes', 
            { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${state.roomId}` },
            async (payload) => {
                console.log('Room update:', payload);
                const room = payload.new;
                
                const prevSet = state.currentSet;
                const prevPhase = state.phase;

                if (room.game_data?.round_winner) {
                    const w = room.game_data.round_winner;
                    const container = document.getElementById('playsContainer');
                    if (container) {
                        container.innerHTML = `
                            <div class="winner-display" style="text-align: center; padding: 1.5rem; animation: winnerEntry 0.7s cubic-bezier(0.175, 0.885, 0.32, 1.275) both;">
                                <div class="trophy-icon">🏆</div>
                                <div style="font-family: 'Bebas Neue', sans-serif; font-size: 1.8rem; color: var(--gold); letter-spacing: 0.2em; margin: 0.5rem 0;">${w.name} wins!</div>
                                <div style="font-size: 1.1rem; color: var(--text); margin-bottom: 0.5rem;">${w.cardName} <span style="color: var(--gold); font-family: 'Bebas Neue', sans-serif;">(${w.value})</span></div>
                                <div style="width: 150px; height: 1px; background: linear-gradient(90deg, transparent, var(--gold), transparent); margin: 0.75rem auto;"></div>
                                <div style="color: var(--text-dim); font-size: 0.85rem; letter-spacing: 0.1em;">Next round starting...</div>
                            </div>
                        `;
                    }
                    spawnWinnerParticles();
                    addChat('System', `🏆 ${w.name} wins the round with ${w.cardName} (${w.value})!`);
                }

                state.currentSet = room.current_set || 0;
                state.currentTurn = room.current_turn || 0;
                state.currentAttribute = room.current_attribute;
                
                if (room.game_data?.round_starter) {
                    state.roundStarter = room.game_data.round_starter;
                }
                
                if (prevPhase !== room.phase) {
                    console.log('Phase change detected:', prevPhase, '->', room.phase);
                    
                    if (room.phase === 'triunfo' && room.triunfo_card_id) {
                        const { data: card } = await supabaseClient
                            .from('cards')
                            .select('*')
                            .eq('id', room.triunfo_card_id)
                            .single();
                        state.triunfoCard = card;
                    }
                    
                    initPhase(room.phase);
                    return;
                }
                
                if (prevSet !== state.currentSet && prevSet !== 0) {
                    console.log('Set changed:', prevSet, '->', state.currentSet);
                    state.hasPlayedThisRound = false;
                    state.isResolvingRound = false;
                    state.cachedPlays = [];
                    await loadMyHand();
                }
                
                updatePhaseUI();
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
                state.cardsPerPlayer = CARDS_PER_PLAYER[state.players.length] || 8;
                state.totalRounds = state.cardsPerPlayer;
                
                updateSeatDisplay();
                updateScoreboard();
                
                if (state.phase === 'bidding') {
                    renderBidding();
                }
            }
        )
        .subscribe();
    
    supabaseClient
        .channel(`plays-${state.roomId}`)
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'current_turn_plays', filter: `room_id=eq.${state.roomId}` },
            async (payload) => {
                const play = payload.new;

                if (state.cachedPlays.some(p => p.player_id === play.player_id)) return;

                const { data: fullPlay } = await supabaseClient
                    .from('current_turn_plays')
                    .select('*, players(name, seat_number), cards(*)')
                    .eq('id', play.id)
                    .single();

                if (fullPlay) {
                    state.cachedPlays.push(fullPlay);
                    renderTableCards();

                    const container = document.getElementById('playsContainer');
                    if (container) {
                        const rect = container.getBoundingClientRect();
                        spawnParticles(
                            rect.left + rect.width / 2 + (state.cachedPlays.length - 1) * 80,
                            rect.top + rect.height / 2,
                            8
                        );
                    }
                }

                if (state.cachedPlays.length >= state.players.length && state.isHost && !state.isResolvingRound) {
                    state.isResolvingRound = true;
                    setTimeout(() => resolveRound(), 2000);
                }
            }
        )
        .subscribe();
}

// ===================== LOAD GAME STATE =====================

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
    
    state.cardsPerPlayer = CARDS_PER_PLAYER[state.players.length] || 8;
    state.totalRounds = state.cardsPerPlayer;
    
    const { data: existingPlays } = await supabaseClient
        .from('current_turn_plays')
        .select('*, players(name, seat_number), cards(*)')
        .eq('room_id', state.roomId)
        .order('created_at', { ascending: true });
    
    if (existingPlays) {
        state.cachedPlays = existingPlays;
    }
    
    if (room.phase === 'playing') {
        await loadMyHand();
    }
}

// ===================== UI UPDATES =====================

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
            indicator.textContent = `Set ${state.currentSet} · ${ATTR_NAMES[state.currentAttribute]} · ${current?.name}'s turn`;
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
            scoring: 'Final scores...'
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
        <li style="padding: 0.4rem 0.5rem; margin-bottom: 0.2rem; background: rgba(212,160,23,0.05); border: 1px solid rgba(212,160,23,0.1); border-radius: 4px; display: flex; justify-content: space-between; font-size: 0.85rem;">
            <span style="color: ${p.id === state.playerId ? 'var(--gold)' : 'var(--text)'};">
                ${p.name} 
                ${p.seat_number === state.mySeat ? '<span style="color: var(--text-dim); font-size: 0.75rem;">(You)</span>' : ''}
                ${p.id === state.playerId && state.isHost ? '👑' : ''}
            </span>
            <span style="color: var(--text-dim); font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.05em;">#${p.seat_number}</span>
        </li>
    `).join('');
}

function updateScoreboard() {
    const list = document.getElementById('scoreList');
    if (!list) return;
    
    const sorted = [...state.players].sort((a, b) => (b.total_score || 0) - (a.total_score || 0));
    
    list.innerHTML = sorted.map((p, i) => `
        <div style="padding: 0.4rem 0.5rem; margin-bottom: 0.2rem; background: rgba(212,160,23,0.05); border: 1px solid rgba(212,160,23,0.1); border-radius: 4px; display: flex; justify-content: space-between; font-size: 0.85rem;">
            <span style="color: ${i === 0 ? 'var(--gold)' : 'var(--text-dim)'};">${i === 0 ? '👑 ' : ''}${p.name}</span>
            <span style="font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.05em; color: var(--gold);">${p.total_score || 0}</span>
        </div>
    `).join('');
}

// ===================== CHAT =====================

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
    div.style.cssText = 'padding: 0.35rem 0.4rem; margin-bottom: 0.2rem; border-radius: 3px; background: rgba(0,0,0,0.2); font-size: 0.78rem; border-left: 2px solid ' + (isSystem ? 'var(--gold-dark)' : 'var(--accent)') + ';';
    div.innerHTML = `
        <span style="color: var(--text-dim); font-size: 0.7rem;">[${time}]</span>
        <span style="font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.05em; color: ${isSystem ? 'var(--gold)' : 'var(--gold-light)'};">${sender}:</span>
        <span style="color: var(--text);">${message}</span>
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

// ===================== CHAT REALTIME =====================

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