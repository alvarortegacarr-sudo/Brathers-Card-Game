// ==========================================
// EL TRIUNFO - COMPLETE SINGLE FILE VERSION
// ==========================================

// Supabase client from global
const supabaseClient = window.supabaseClient;

// State
const state = {
    playerId: localStorage.getItem('playerId') || crypto.randomUUID(),
    currentPlayer: localStorage.getItem('currentPlayer'),
    roomId: null,
    players: [],
    myHand: [],
    isGameActive: false,
    currentPhase: 'waiting',
    myPosition: 0,
    triunfoCard: null,
    currentAttribute: null,
    hasBidded: false,
    hasPlayedThisRound: false,
    cardsPerPlayer: 0
};

if (!localStorage.getItem('playerId')) {
    localStorage.setItem('playerId', state.playerId);
}

const ATTRIBUTES = ['car', 'cul', 'tet', 'fis', 'per'];
const ATTRIBUTE_NAMES = { car: 'CAR', cul: 'CUL', tet: 'TET', fis: 'FIS', per: 'PER' };
const CARD_DISTRIBUTION = { 2: 20, 3: 13, 4: 10, 5: 8 };

// ==========================================
// INITIALIZATION
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
    const roomCode = localStorage.getItem('currentRoom');
    if (!roomCode) {
        alert('No room code');
        window.location.href = 'index.html';
        return;
    }

    document.getElementById('displayCode').textContent = `ROOM: ${roomCode}`;
    
    // Setup start button
    const startBtn = document.getElementById('startBtn');
    if (startBtn) {
        startBtn.addEventListener('click', startGame);
    }

    // Setup chat
    document.getElementById('chatInput')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });

    try {
        // Fetch room
        const { data: room, error } = await supabaseClient
            .from('rooms')
            .select('*, players(*), turn_order(*)')
            .eq('code', roomCode)
            .single();

        if (error || !room) {
            alert('Room not found');
            window.location.href = 'index.html';
            return;
        }

        state.roomId = room.id;
        state.players = room.players || [];
        state.currentPhase = room.status === 'playing' ? room.phase : 'waiting';
        state.isGameActive = room.status === 'playing';
        state.triunfoCard = room.triunfo;
        state.currentAttribute = room.current_attribute;

        updateCardsPerPlayer();
        updatePlayerList(room.players);
        updateHostControls();

        // Setup realtime
        setupRealtime();

        // Load game if active
        if (room.status === 'playing') {
            await loadMyHand();
            await loadMyPosition();
            renderHand();
        }

        addLog('Connected to El Triunfo');
        addChatMessage('System', '🎴 Welcome!');

    } catch (err) {
        console.error('Init error:', err);
        alert('Failed to initialize: ' + err.message);
    }
});

// ==========================================
// GAME START
// ==========================================

async function startGame() {
    console.log('=== START GAME ===');
    
    if (state.players.length < 2) {
        alert('Need at least 2 players!');
        return;
    }

    document.getElementById('hostControls').style.display = 'none';

    try {
        // Cleanup
        await supabaseClient.from('player_hands').delete().eq('room_id', state.roomId);
        await supabaseClient.from('current_turn_plays').delete().eq('room_id', state.roomId);
        await supabaseClient.from('turn_order').delete().eq('room_id', state.roomId);

        // Reset players
        for (const p of state.players) {
            await supabaseClient
                .from('players')
                .update({ predicted_rounds: null, won_rounds: 0, has_bid: false })
                .eq('id', p.id);
        }

        // Create turn order
        const shuffled = [...state.players].sort(() => Math.random() - 0.5);
        for (let i = 0; i < shuffled.length; i++) {
            await supabaseClient
                .from('turn_order')
                .insert({ room_id: state.roomId, player_id: shuffled[i].id, position: i });
        }

        // Get cards
        const { data: allCards } = await supabaseClient.from('cards').select('*');
        
        // Pick triunfo
        const triunfo = allCards[Math.floor(Math.random() * allCards.length)];
        
        // Deal cards - FIXED: Deal to ALL players
        const shuffledCards = [...allCards].sort(() => Math.random() - 0.5);
        updateCardsPerPlayer();
        
        console.log('Dealing', state.cardsPerPlayer, 'cards to each of', state.players.length, 'players');
        console.log('Total cards needed:', state.cardsPerPlayer * state.players.length);
        
        let cardIdx = 0;
        for (const player of state.players) {
            const playerCards = shuffledCards.slice(cardIdx, cardIdx + state.cardsPerPlayer);
            cardIdx += state.cardsPerPlayer;
            
            console.log('Dealing to', player.name, ':', playerCards.length, 'cards');
            
            for (const card of playerCards) {
                const { error: insertError } = await supabaseClient
                    .from('player_hands')
                    .insert({
                        room_id: state.roomId,
                        player_id: player.id,
                        card_id: card.id,
                        played: false
                    });
                
                if (insertError) {
                    console.error('Failed to deal card:', insertError);
                }
            }
        }

        // Update room to triunfo phase
        await supabaseClient
            .from('rooms')
            .update({
                status: 'playing',
                phase: 'triunfo',
                triunfo_card_id: triunfo.id,
                current_turn: 0,
                game_data: { round_starter: 0 }
            })
            .eq('id', state.roomId);

        addChatMessage('System', `🎴 Game started! El Triunfo is ${triunfo.name}`);

        // Go to bidding after 2 seconds
        setTimeout(async () => {
            await supabaseClient
                .from('rooms')
                .update({ phase: 'bidding' })
                .eq('id', state.roomId);
        }, 2000);

    } catch (err) {
        console.error('Start game error:', err);
        alert('Failed to start: ' + err.message);
        document.getElementById('hostControls').style.display = 'block';
    }
}

// ==========================================
// BIDDING
// ==========================================

async function submitBid(bid) {
    console.log('Submit bid:', bid);
    
    if (state.currentPhase !== 'bidding' || state.hasBidded) return;

    state.hasBidded = true;
    renderHand();

    try {
        await supabaseClient
            .from('players')
            .update({ predicted_rounds: bid, has_bid: true })
            .eq('id', state.playerId);

        addChatMessage('System', `You bid ${bid}`);

        // Check if all bid
        checkAllBidded();

    } catch (err) {
        console.error('Bid error:', err);
        state.hasBidded = false;
        renderHand();
    }
}

async function checkAllBidded() {
    const { data: players } = await supabaseClient
        .from('players')
        .select('*')
        .eq('room_id', state.roomId);

    const allBid = players.every(p => p.has_bid);
    console.log('Bidding:', players.filter(p => p.has_bid).length, '/', players.length);

    if (allBid) {
        await supabaseClient
            .from('rooms')
            .update({ phase: 'playing', current_turn: 1 })
            .eq('id', state.roomId);
    } else {
        setTimeout(checkAllBidded, 1000);
    }
}

// ==========================================
// PLAYING
// ==========================================

async function selectAttribute(attr) {
    console.log('Select attribute:', attr);
    
    if (state.currentPhase !== 'playing') return;
    
    // CRITICAL: Only round starter can select
    const gameData = state.currentRoom?.game_data || {};
    const roundStarter = gameData.round_starter ?? 0;
    
    console.log('Round starter:', roundStarter, 'My position:', state.myPosition);
    
    if (state.myPosition !== roundStarter) {
        alert('Only the round starter can select attribute!');
        return;
    }
    
    if (state.currentAttribute) {
        alert('Attribute already selected!');
        return;
    }

    try {
        state.currentAttribute = attr;
        await supabaseClient
            .from('rooms')
            .update({ current_attribute: attr })
            .eq('id', state.roomId);
        
        addChatMessage('System', `${ATTRIBUTE_NAMES[attr]} selected!`);
        renderHand();
    } catch (err) {
        console.error(err);
        state.currentAttribute = null;
    }
}

async function playCard(cardId) {
    console.log('Play card:', cardId);
    
    if (state.currentPhase !== 'playing') return;
    
    // CRITICAL: Check if already played this round
    if (state.hasPlayedThisRound) {
        alert('You already played this round!');
        return;
    }

    const card = state.myHand.find(c => c.id === cardId);
    if (!card) {
        alert('Card not found!');
        return;
    }

    try {
        // Get current plays
        const { data: plays } = await supabaseClient
            .from('current_turn_plays')
            .select('*')
            .eq('room_id', state.roomId);

        const playsThisRound = plays?.length || 0;
        
        // Calculate whose turn
        const gameData = state.currentRoom?.game_data || {};
        const roundStarter = gameData.round_starter ?? 0;
        
        let expectedPos;
        if (playsThisRound === 0) {
            expectedPos = roundStarter;
        } else {
            expectedPos = (roundStarter + playsThisRound) % state.players.length;
        }

        console.log('Expected:', expectedPos, 'Me:', state.myPosition);

        if (state.myPosition !== expectedPos) {
            alert('Not your turn!');
            return;
        }

        if (playsThisRound === 0 && !state.currentAttribute) {
            alert('Select attribute first!');
            return;
        }

        // Calculate value
        let value = card[state.currentAttribute];
        if (state.triunfoCard && card.id === state.triunfoCard.id) {
            value = 99;
        }

        // Play card
        await supabaseClient.from('current_turn_plays').insert({
            room_id: state.roomId,
            player_id: state.playerId,
            card_id: cardId,
            attribute: state.currentAttribute,
            value: value
        });

        // Mark played
        await supabaseClient
            .from('player_hands')
            .update({ played: true })
            .eq('room_id', state.roomId)
            .eq('player_id', state.playerId)
            .eq('card_id', cardId);

        // Update local
        state.hasPlayedThisRound = true;
        state.myHand = state.myHand.filter(c => c.id !== cardId);
        
        renderHand();
        addChatMessage('System', `Played ${card.name} (${value})`);

        // Check round complete
        if (playsThisRound + 1 >= state.players.length) {
            setTimeout(resolveRound, 1500);
        }

    } catch (err) {
        console.error('Play error:', err);
        state.hasPlayedThisRound = false;
    }
}

async function resolveRound() {
    try {
        const { data: plays } = await supabaseClient
            .from('current_turn_plays')
            .select('*, players(*), cards(*)')
            .eq('room_id', state.roomId);

        // Find winner
        const winner = plays.reduce((max, p) => {
            if (p.value > max.value) return p;
            if (p.value === max.value) {
                const pTotal = ATTRIBUTES.reduce((s, a) => s + p.cards[a], 0);
                const mTotal = ATTRIBUTES.reduce((s, a) => s + max.cards[a], 0);
                if (pTotal > mTotal) return p;
            }
            return max;
        });

        // Update winner
        await supabaseClient
            .from('players')
            .update({ won_rounds: winner.players.won_rounds + 1 })
            .eq('id', winner.player_id);

        addChatMessage('System', `🏆 ${winner.players.name} wins!`);

        // Clear plays
        await supabaseClient.from('current_turn_plays').delete().eq('room_id', state.roomId);

        // Reset for new round
        state.hasPlayedThisRound = false;
        state.currentAttribute = null;

        // Check if set over
        const { data: remaining } = await supabaseClient
            .from('player_hands')
            .select('*')
            .eq('room_id', state.roomId);

        const cardsLeft = remaining.filter(h => !h.played).length;
        
        if (cardsLeft === 0) {
            await endSet();
        } else {
            // New round - winner starts
            const { data: turnOrder } = await supabaseClient
                .from('turn_order')
                .select('*')
                .eq('room_id', state.roomId);

            const winnerPos = turnOrder.find(t => t.player_id === winner.player_id)?.position || 0;
            const nextTurn = (state.currentRoom.current_turn || 0) + 1;

            await supabaseClient
                .from('rooms')
                .update({
                    current_turn: nextTurn,
                    current_attribute: null,
                    game_data: { round_starter: winnerPos }
                })
                .eq('id', state.roomId);
        }

    } catch (err) {
        console.error('Resolve error:', err);
    }
}

async function endSet() {
    state.currentPhase = 'scoring';
    renderHand();

    const { data: players } = await supabaseClient
        .from('players')
        .select('*')
        .eq('room_id', state.roomId);

    for (const p of players) {
        const predicted = p.predicted_rounds || 0;
        const won = p.won_rounds || 0;
        let points = won * 2;
        points += (predicted === won) ? 3 : -2;
        
        await supabaseClient
            .from('players')
            .update({ total_score: (p.total_score || 0) + points })
            .eq('id', p.id);
    }

    addChatMessage('System', '📊 Set complete!');

    // Reset
    state.isGameActive = false;
    state.hasBidded = false;
    state.hasPlayedThisRound = false;
    state.myHand = [];
    
    await supabaseClient
        .from('rooms')
        .update({ status: 'waiting', phase: 'waiting' })
        .eq('id', state.roomId);

    updateHostControls();
}

// ==========================================
// HAND LOADING - CRITICAL FIX
// ==========================================

async function loadMyHand() {
    console.log('=== LOAD HAND ===');
    console.log('Player:', state.playerId);
    console.log('Room:', state.roomId);

    try {
        const { data, error } = await supabaseClient
            .from('player_hands')
            .select('*, cards(*)')
            .eq('room_id', state.roomId)
            .eq('player_id', state.playerId);

        if (error) {
            console.error('Hand fetch error:', error);
            return;
        }

        console.log('Raw hand records:', data?.length || 0);

        // Filter unplayed - handle both boolean and integer
        const unplayed = (data || []).filter(h => {
            const played = h.played === true || h.played === 1;
            return !played;
        });

        console.log('Unplayed cards:', unplayed.length);

        state.myHand = unplayed.map(h => ({
            ...h.cards,
            hand_record_id: h.id
        }));

        console.log('Hand loaded:', state.myHand.map(c => c.name));

    } catch (err) {
        console.error('Load hand error:', err);
    }
}

async function loadMyPosition() {
    const { data } = await supabaseClient
        .from('turn_order')
        .select('*')
        .eq('room_id', state.roomId)
        .eq('player_id', state.playerId)
        .single();
    
    state.myPosition = data?.position || 0;
    console.log('My position:', state.myPosition);
}

// ==========================================
// REALTIME
// ==========================================

function setupRealtime() {
    supabaseClient
        .channel(`room:${state.roomId}`)
        .on('postgres_changes',
            { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${state.roomId}` },
            async (payload) => {
                console.log('Room:', payload.old.phase, '->', payload.new.phase);
                
                state.currentRoom = payload.new;
                state.currentPhase = payload.new.phase;
                state.currentAttribute = payload.new.current_attribute;
                
                if (payload.new.status === 'playing') {
                    state.isGameActive = true;
                }

                // Phase transitions
                if (payload.old.phase === 'triunfo' && payload.new.phase === 'bidding') {
                    console.log('ENTERING BIDDING - loading hand');
                    await loadMyHand();
                }
                
                if (payload.old.phase === 'bidding' && payload.new.phase === 'playing') {
                    console.log('ENTERING PLAYING - loading hand and position');
                    state.hasBidded = false;
                    state.hasPlayedThisRound = false;
                    await loadMyHand();
                    await loadMyPosition();
                }

                if (payload.new.phase === 'playing' && payload.old.phase === 'playing') {
                    // New round
                    if (payload.new.current_turn !== payload.old.current_turn) {
                        state.hasPlayedThisRound = false;
                        state.currentAttribute = payload.new.current_attribute;
                        await loadMyHand();
                    }
                }

                renderHand();
                updateGameUI();
                updateHostControls();
            }
        )
        .subscribe();
}

// ==========================================
// UI RENDERING
// ==========================================

function renderHand() {
    const container = document.getElementById('handContainer');
    if (!container) return;

    container.innerHTML = '';

    if (state.currentPhase === 'waiting') {
        container.innerHTML = '<div class="waiting-message">Waiting for host...</div>';
        return;
    }

    if (state.currentPhase === 'triunfo') {
        container.innerHTML = `
            <div style="text-align:center;padding:20px;">
                <h2 style="color:#ffd700;">👑 EL TRIUNFO 👑</h2>
                <div style="width:160px;margin:0 auto;padding:12px;background:linear-gradient(135deg,#1a2332,#2d3748);border:3px solid #ffd700;border-radius:12px;">
                    <div style="color:#ffd700;font-weight:bold;">${state.triunfoCard?.name}</div>
                    <div style="font-size:2rem;">👑</div>
                </div>
                <p style="color:#a0aec0;">Bidding starts soon...</p>
            </div>
        `;
        return;
    }

    if (state.currentPhase === 'bidding') {
        if (!state.hasBidded) {
            const cards = state.myHand;
            let html = `
                <div style="text-align:center;margin-bottom:20px;">
                    <h3 style="color:#ffd700;">Your Cards (${cards.length})</h3>
                    <div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-bottom:20px;">
            `;
            
            cards.forEach(card => {
                html += `
                    <div style="width:90px;background:rgba(26,35,50,0.9);border:1px solid #4a5568;border-radius:8px;padding:6px;text-align:center;font-size:0.75rem;">
                        <div style="color:#ffd700;font-weight:bold;">${card.name}</div>
                        <div style="color:#a0aec0;font-size:0.65rem;">
                            C:${card.car} U:${card.cul} T:${card.tet}<br>F:${card.fis} P:${card.per}
                        </div>
                    </div>
                `;
            });
            
            html += `
                    </div>
                </div>
                <div style="text-align:center;padding:30px;background:rgba(20,27,36,0.95);border-radius:16px;border:3px solid #ffd700;">
                    <h2 style="color:#ffd700;">How many rounds will you win?</h2>
                    <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;">
                        ${Array.from({length: cards.length + 1}, (_, i) => `
                            <button onclick="window.submitBid(${i})" style="width:60px;height:60px;font-size:1.4rem;font-weight:bold;background:linear-gradient(135deg,#667eea,#764ba2);border:none;border-radius:12px;color:white;cursor:pointer;">${i}</button>
                        `).join('')}
                    </div>
                </div>
            `;
            container.innerHTML = html;
        } else {
            container.innerHTML = `
                <div style="text-align:center;padding:40px;">
                    <h2 style="color:#48bb78;">Bid placed!</h2>
                    <p style="color:#a0aec0;">Waiting for others...</p>
                </div>
            `;
        }
        return;
    }

    if (state.currentPhase === 'playing') {
        const gameData = state.currentRoom?.game_data || {};
        const roundStarter = gameData.round_starter ?? 0;
        const isStarter = state.myPosition === roundStarter;
        const canSelect = isStarter && !state.currentAttribute;

        // Attribute selector (only for round starter)
        if (canSelect) {
            container.innerHTML += `
                <div style="text-align:center;padding:20px;background:rgba(20,27,36,0.95);border:2px solid #4299e1;border-radius:16px;margin-bottom:20px;">
                    <h3 style="color:#ffd700;">You start! Select attribute:</h3>
                    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
                        ${ATTRIBUTES.map(attr => {
                            const colors = {car:'#ef4444',cul:'#8b5cf6',tet:'#10b981',fis:'#3b82f6',per:'#f59e0b'};
                            return `<button onclick="window.selectAttribute('${attr}')" style="padding:12px 24px;font-size:1.1rem;font-weight:bold;border:none;border-radius:8px;cursor:pointer;background:${colors[attr]};color:white;">${ATTRIBUTE_NAMES[attr]}</button>`;
                        }).join('')}
                    </div>
                </div>
            `;
        } else if (!state.currentAttribute) {
            container.innerHTML += `
                <div style="text-align:center;padding:15px;background:rgba(255,255,255,0.05);border-radius:10px;margin-bottom:15px;">
                    <p style="color:#a0aec0;">Waiting for round starter to select attribute...</p>
                </div>
            `;
        }

        // Current attribute display
        if (state.currentAttribute) {
            container.innerHTML += `
                <div style="text-align:center;padding:15px;background:rgba(255,215,0,0.1);border:2px solid #ffd700;border-radius:10px;margin-bottom:15px;">
                    <div style="font-size:1.3rem;color:#ffd700;font-weight:bold;">Playing: ${ATTRIBUTE_NAMES[state.currentAttribute]}</div>
                    ${state.hasPlayedThisRound ? 
                        '<p style="color:#48bb78;">You played this round. Waiting for others...</p>' :
                        '<p style="color:#a0aec0;">Double-click card to play</p>'
                    }
                </div>
            `;
        }

        // Cards
        let cardsHtml = '<div style="display:flex;flex-wrap:wrap;gap:15px;justify-content:center;">';
        
        state.myHand.forEach(card => {
            const isTriunfo = state.triunfoCard?.id === card.id;
            
            let statsHtml;
            if (state.currentAttribute) {
                const val = isTriunfo ? 99 : card[state.currentAttribute];
                statsHtml = `
                    <div style="text-align:center;padding:20px 10px;">
                        <div style="font-size:2.5rem;color:#ffd700;font-weight:bold;">${val}</div>
                        <div style="color:#a0aec0;font-size:0.9rem;">${ATTRIBUTE_NAMES[state.currentAttribute]}</div>
                    </div>
                `;
            } else {
                statsHtml = `
                    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;">
                        ${ATTRIBUTES.map(attr => `
                            <div style="background:rgba(255,255,255,0.05);border-radius:6px;padding:6px 2px;text-align:center;">
                                <span style="display:block;font-size:0.6rem;color:#a0aec0;">${ATTRIBUTE_NAMES[attr]}</span>
                                <span style="display:block;font-size:0.9rem;font-weight:bold;color:${isTriunfo?'#ffd700':'#48bb78'};">${isTriunfo?99:card[attr]}</span>
                            </div>
                        `).join('')}
                    </div>
                `;
            }
            
            const canPlay = state.currentAttribute && !state.hasPlayedThisRound;
            
            cardsHtml += `
                <div 
                    style="width:140px;${canPlay?'cursor:pointer;':'opacity:0.6;'}transition:transform 0.2s;background:linear-gradient(135deg,#1e293b,#334155);border:2px solid #475569;border-radius:12px;padding:12px;color:white;"
                    ${canPlay ? `ondblclick="window.playCard(${card.id})" onmouseenter="this.style.transform='scale(1.05)'" onmouseleave="this.style.transform='scale(1)'"` : ''}
                >
                    <div style="font-weight:bold;font-size:0.9rem;text-align:center;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.1);color:#ffd700;">
                        ${card.name} ${isTriunfo?'👑':''}
                    </div>
                    ${statsHtml}
                </div>
            `;
        });
        
        cardsHtml += '</div>';
        container.innerHTML += cardsHtml;
        return;
    }

    if (state.currentPhase === 'scoring') {
        container.innerHTML = '<div style="text-align:center;"><h3>Set Complete!</h3><p>Calculating scores...</p></div>';
    }
}

function updateGameUI() {
    const phaseIndicator = document.getElementById('phaseIndicator');
    if (!phaseIndicator) return;

    const gameData = state.currentRoom?.game_data || {};
    const roundStarter = gameData.round_starter ?? 0;

    switch(state.currentPhase) {
        case 'waiting':
            phaseIndicator.textContent = 'Waiting for host...';
            phaseIndicator.style.color = '#ecc94b';
            break;
        case 'triunfo':
            phaseIndicator.textContent = 'El Triunfo revealed!';
            phaseIndicator.style.color = '#ff6b6b';
            break;
        case 'bidding':
            phaseIndicator.textContent = state.hasBidded ? 'Bid placed!' : 'Place your bid!';
            phaseIndicator.style.color = state.hasBidded ? '#48bb78' : '#ffd700';
            break;
        case 'playing':
            if (state.currentAttribute) {
                phaseIndicator.textContent = `${ATTRIBUTE_NAMES[state.currentAttribute]} | Round ${state.currentRoom?.current_turn || 1}`;
                phaseIndicator.style.color = '#48bb78';
            } else {
                const isStarter = state.myPosition === roundStarter;
                phaseIndicator.textContent = isStarter ? 'You select attribute!' : 'Waiting for attribute...';
                phaseIndicator.style.color = isStarter ? '#ffd700' : '#ecc94b';
            }
            break;
        case 'scoring':
            phaseIndicator.textContent = 'Set Complete!';
            phaseIndicator.style.color = '#4299e1';
            break;
    }

    document.getElementById('turnInfo').textContent = 
        state.currentPhase === 'playing' ? `Round ${state.currentRoom?.current_turn || 1}` : 
        state.currentPhase.charAt(0).toUpperCase() + state.currentPhase.slice(1);
}

function updateHostControls() {
    const hostControls = document.getElementById('hostControls');
    if (!hostControls) return;

    const isHost = localStorage.getItem('isHost') === 'true';

    if (state.isGameActive || state.currentRoom?.status === 'playing') {
        hostControls.style.display = 'none';
        return;
    }

    if (isHost) {
        hostControls.style.display = 'block';
    } else {
        hostControls.style.display = 'none';
    }
}

function updatePlayerList(players) {
    const ul = document.getElementById('playersUl');
    if (!ul) return;
    
    ul.innerHTML = '';
    players.forEach(p => {
        const li = document.createElement('li');
        li.style.cssText = 'padding:0.6rem;margin-bottom:0.4rem;background:rgba(255,255,255,0.03);border-radius:8px;display:flex;justify-content:space-between;align-items:center;';
        
        let badges = '';
        if (p.id === state.currentRoom?.host_id) badges += '👑 ';
        if (p.id === state.playerId) badges += 'YOU ';
        if (p.has_bid) badges += '✓';
        
        li.innerHTML = `<span>${p.name}</span><span>${badges}</span>`;
        ul.appendChild(li);
    });

    document.getElementById('playerCount').textContent = players.length;
}

function updateCardsPerPlayer() {
    state.cardsPerPlayer = CARD_DISTRIBUTION[state.players.length] || 8;
}

// ==========================================
// CHAT & UTILS
// ==========================================

async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    if (!input) return;
    
    const msg = input.value.trim();
    if (!msg) return;
    
    input.value = '';
    
    await supabaseClient.from('chat_messages').insert({
        room_id: state.roomId,
        player_id: state.playerId,
        player_name: state.currentPlayer,
        message: msg
    });
}

function addChatMessage(sender, message) {
    const chatLog = document.getElementById('chatLog');
    if (!chatLog) return;
    
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const div = document.createElement('div');
    div.style.cssText = 'padding:0.4rem;background:rgba(255,255,255,0.03);border-radius:6px;margin-bottom:0.3rem;font-size:0.85rem;';
    div.innerHTML = `<span style="color:#a0aec0;font-size:0.75rem;">[${time}]</span> <b style="color:${sender==='System'?'#ffd700':'#4299e1'}">${sender}:</b> ${message}`;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function addLog(msg) {
    const log = document.getElementById('gameLog');
    if (!log) return;
    const div = document.createElement('div');
    div.style.cssText = 'padding:0.4rem;border-left:3px solid #4299e1;padding-left:0.6rem;color:#a0aec0;font-size:0.85rem;';
    div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    log.appendChild(div);
}

function copyCode() {
    navigator.clipboard.writeText(localStorage.getItem('currentRoom'));
    addChatMessage('System', 'Code copied!');
}

async function leaveGame() {
    await supabaseClient.from('players').delete().eq('id', state.playerId);
    localStorage.removeItem('currentRoom');
    window.location.href = 'index.html';
}

// Expose functions globally
window.startGame = startGame;
window.submitBid = submitBid;
window.selectAttribute = selectAttribute;
window.playCard = playCard;
window.copyCode = copyCode;
window.leaveGame = leaveGame;
window.sendChatMessage = sendChatMessage;

// Cleanup
window.addEventListener('beforeunload', async () => {
    await supabaseClient.from('players').delete().eq('id', state.playerId);
});