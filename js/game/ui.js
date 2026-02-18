// ==========================================
// UI RENDERING FUNCTIONS
// ==========================================

import { state } from './state.js';
import { ATTRIBUTES, ATTRIBUTE_NAMES } from './config.js';

export function renderHand(cards) {
    const container = document.getElementById('handContainer');
    if (!container) return;
    
    container.innerHTML = '';
    
    switch(state.currentPhase) {
        case 'waiting':
            container.innerHTML = '<div class="waiting-message">Waiting for host to start...</div>';
            break;
        case 'triunfo':
            renderTriunfoPhase(container);
            break;
        case 'bidding':
            renderBiddingPhase(container, cards);
            break;
        case 'playing':
            renderPlayingPhase(container, cards);
            break;
        case 'scoring':
            container.innerHTML = '<div class="waiting-message"><h3>Set Complete!</h3><p>Calculating final scores...</p></div>';
            break;
    }
}

function renderTriunfoPhase(container) {
    if (!state.triunfoCard) {
        container.innerHTML = '<div class="waiting-message">Revealing El Triunfo...</div>';
        return;
    }
    
    container.innerHTML = `
        <div class="triunfo-reveal" style="text-align: center; padding: 20px;">
            <h2 style="color: #ffd700; margin-bottom: 20px;">👑 EL TRIUNFO 👑</h2>
            <div style="width: 160px; margin: 0 auto; background: linear-gradient(135deg, #1a2332 0%, #2d3748 100%); border: 3px solid #ffd700; border-radius: 12px; padding: 12px; box-shadow: 0 0 30px rgba(255,215,0,0.3);">
                <div style="font-weight: bold; color: #ffd700; text-align: center; margin-bottom: 10px;">${state.triunfoCard.name}</div>
                <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px;">
                    ${ATTRIBUTES.map(attr => `
                        <div style="background: rgba(255,255,255,0.05); border-radius: 6px; padding: 6px 2px; text-align: center;">
                            <span style="display: block; font-size: 0.6rem; color: #a0aec0;">${ATTRIBUTE_NAMES[attr]}</span>
                            <span style="display: block; font-size: 1.1rem; font-weight: bold; color: #ffd700;">99</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            <p style="color: #a0aec0; margin-top: 20px;">Bidding begins shortly...</p>
        </div>
    `;
}

function renderBiddingPhase(container, cards) {
    if (!state.hasBidded) {
        // Show cards
        const cardCount = cards.length || state.cardsPerPlayer;
        
        let html = `
            <div style="margin-bottom: 20px;">
                <h3 style="color: #ffd700; margin-bottom: 15px; text-align: center;">Your Cards (${cardCount})</h3>
                <div style="display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-bottom: 20px;">
        `;
        
        cards.forEach(card => {
            html += `
                <div style="width: 90px; background: rgba(26,35,50,0.9); border: 1px solid #4a5568; border-radius: 8px; padding: 6px; text-align: center; font-size: 0.75rem;">
                    <div style="font-weight: bold; color: #ffd700; margin-bottom: 4px;">${card.name}</div>
                    <div style="color: #a0aec0; font-size: 0.65rem;">
                        C:${card.car} U:${card.cul} T:${card.tet}<br>F:${card.fis} P:${card.per}
                    </div>
                </div>
            `;
        });
        
        html += `
                </div>
            </div>
            <div style="text-align: center; padding: 30px; background: rgba(20,27,36,0.95); border-radius: 16px; border: 3px solid #ffd700;">
                <h2 style="color: #ffd700; margin-bottom: 15px;">How many rounds will you win?</h2>
                <div style="display: flex; flex-wrap: wrap; gap: 12px; justify-content: center;">
                    ${Array.from({length: cardCount + 1}, (_, i) => `
                        <button onclick="window.submitBid(${i})" style="width: 60px; height: 60px; font-size: 1.4rem; font-weight: bold; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border: none; border-radius: 12px; color: white; cursor: pointer; transition: all 0.2s;">${i}</button>
                    `).join('')}
                </div>
            </div>
        `;
        
        container.innerHTML = html;
    } else {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px;">
                <h2 style="color: #48bb78;">Bid placed!</h2>
                <p style="color: #a0aec0;">Waiting for other players...</p>
                <div style="width: 40px; height: 40px; border: 4px solid rgba(255,255,255,0.1); border-top-color: #ffd700; border-radius: 50%; animation: spin 1s linear infinite; margin: 20px auto;"></div>
            </div>
        `;
    }
}

function renderPlayingPhase(container, cards) {
    const roundStarter = state.currentRoom?.current_round_starter || 0;
    const isMyTurnToSelect = (state.myPosition === roundStarter) && !state.currentAttribute;
    
    if (isMyTurnToSelect) {
        container.innerHTML += `
            <div style="text-align: center; padding: 20px; background: rgba(20,27,36,0.95); border-radius: 16px; border: 2px solid #4299e1; margin-bottom: 20px;">
                <h3 style="color: #ffd700; margin-bottom: 15px;">You start this round! Select an attribute:</h3>
                <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                    ${ATTRIBUTES.map(attr => `
                        <button onclick="window.selectAttribute('${attr}')" style="padding: 12px 24px; font-size: 1.1rem; font-weight: bold; border: none; border-radius: 8px; cursor: pointer; text-transform: uppercase; background: ${getAttributeColor(attr)}; color: white;">${ATTRIBUTE_NAMES[attr]}</button>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    if (state.currentAttribute) {
        container.innerHTML += `
            <div style="text-align: center; padding: 15px; background: rgba(255,215,0,0.1); border: 2px solid #ffd700; border-radius: 10px; margin-bottom: 15px;">
                <div style="font-size: 1.3rem; color: #ffd700; font-weight: bold;">
                    Playing: ${ATTRIBUTE_NAMES[state.currentAttribute]}
                </div>
                <div style="color: #a0aec0; font-size: 0.9rem; margin-top: 5px;">
                    Double-click card to play
                </div>
            </div>
        `;
    }
    
    // Render cards
    let cardsHtml = '<div style="display: flex; flex-wrap: wrap; gap: 15px; justify-content: center;">';
    
    cards.forEach((card) => {
        const isTriunfo = state.triunfoCard && card.id === state.triunfoCard.id;
        const cardStyle = 'width: 140px; cursor: pointer; transition: transform 0.2s; background: linear-gradient(135deg, #1e293b 0%, #334155 100%); border: 2px solid #475569; border-radius: 12px; padding: 12px; color: white; box-shadow: 0 4px 6px rgba(0,0,0,0.3);';
        
        let statsHtml;
        if (state.currentAttribute) {
            const value = isTriunfo ? 99 : card[state.currentAttribute];
            statsHtml = `
                <div style="text-align: center; padding: 20px 10px;">
                    <div style="font-size: 2.5rem; color: #ffd700; font-weight: bold;">${value}</div>
                    <div style="color: #a0aec0; font-size: 0.9rem;">${ATTRIBUTE_NAMES[state.currentAttribute]}</div>
                </div>
            `;
        } else {
            statsHtml = `
                <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px;">
                    ${ATTRIBUTES.map(attr => `
                        <div style="background: rgba(255,255,255,0.05); border-radius: 6px; padding: 6px 2px; text-align: center;">
                            <span style="display: block; font-size: 0.6rem; color: #a0aec0; margin-bottom: 2px;">${ATTRIBUTE_NAMES[attr]}</span>
                            <span style="display: block; font-size: 0.9rem; font-weight: bold; color: ${isTriunfo ? '#ffd700' : '#48bb78'};">${isTriunfo ? 99 : card[attr]}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        }
        
        cardsHtml += `
            <div class="game-card" style="${cardStyle}" ondblclick="window.playCard(${card.id})" onmouseenter="this.style.transform='scale(1.05) translateY(-8px)'" onmouseleave="this.style.transform='scale(1)'">
                <div style="font-weight: bold; font-size: 0.9rem; text-align: center; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.1); color: #ffd700;">
                    ${card.name} ${isTriunfo ? '👑' : ''}
                </div>
                ${statsHtml}
            </div>
        `;
    });
    
    cardsHtml += '</div>';
    container.innerHTML += cardsHtml;
}

function getAttributeColor(attr) {
    const colors = {
        car: '#ef4444',
        cul: '#8b5cf6',
        tet: '#10b981',
        fis: '#3b82f6',
        per: '#f59e0b'
    };
    return colors[attr] || '#666';
}

export function updateGameUI() {
    const phaseIndicator = document.getElementById('phaseIndicator');
    const turnInfo = document.getElementById('turnInfo');
    const triunfoDisplay = document.getElementById('triunfoDisplay');
    
    if (phaseIndicator) {
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
                const roundStarter = state.currentRoom?.current_round_starter || 0;
                const isStarter = state.myPosition === roundStarter;
                if (state.currentAttribute) {
                    phaseIndicator.textContent = `Playing: ${ATTRIBUTE_NAMES[state.currentAttribute]} | Round ${state.currentRoom?.current_turn || 1}`;
                    phaseIndicator.style.color = '#48bb78';
                } else {
                    phaseIndicator.textContent = isStarter ? 'Select attribute & play!' : 'Waiting for attribute...';
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
        if (state.currentPhase === 'playing') {
            turnInfo.textContent = `Round ${state.currentRoom?.current_turn || 1}`;
        } else {
            turnInfo.textContent = state.currentPhase === 'triunfo' ? 'El Triunfo' : 
                                  state.currentPhase.charAt(0).toUpperCase() + state.currentPhase.slice(1);
        }
    }
    
    if (triunfoDisplay && state.triunfoCard) {
        triunfoDisplay.innerHTML = `
            <div style="width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 8px; background: linear-gradient(135deg, #1a2332 0%, #2d3748 100%); border: 3px solid #ffd700; border-radius: 12px; box-shadow: 0 0 30px rgba(255,215,0,0.3);">
                <div style="font-size: 0.7rem; color: #ffd700; font-weight: bold; text-align: center;">${state.triunfoCard.name}</div>
                <div style="font-size: 2rem;">👑</div>
                <div style="font-size: 0.6rem; color: #a0aec0;">99 ALL</div>
            </div>
        `;
    }
}

export function updateScoreboard() {
    const scoreDiv = document.getElementById('scoreboard');
    if (!scoreDiv) return;
    
    const sortedPlayers = [...state.players].sort((a, b) => (b.total_score || 0) - (a.total_score || 0));
    
    let html = '<h3 style="color: #ffd700; margin-bottom: 12px; font-size: 1.2rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px;">Scores</h3>';
    
    sortedPlayers.forEach(p => {
        const isMe = p.id === state.playerId;
        const bidInfo = p.has_bid ? `(Bid: ${p.predicted_rounds !== null ? p.predicted_rounds : '?'})` : '';
        const wonInfo = state.isGameActive ? `Won: ${p.won_rounds || 0}` : '';
        
        html += `
            <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05); ${isMe ? 'background: rgba(72, 187, 120, 0.2); border-radius: 4px; padding: 4px 8px;' : ''}">
                <span>${p.name} ${isMe ? '(You)' : ''}</span>
                <span>${p.total_score || 0}pts ${bidInfo} ${wonInfo}</span>
            </div>
        `;
    });
    
    scoreDiv.innerHTML = html;
    
    const countEl = document.getElementById('playerCount');
    if (countEl) countEl.textContent = state.players.length;
}

export function updatePlayerListUI() {
    const ul = document.getElementById('playersUl');
    if (!ul) return;
    
    ul.innerHTML = '';
    state.players.forEach(p => {
        const li = document.createElement('li');
        li.style.cssText = 'padding: 0.6rem; margin-bottom: 0.4rem; background: rgba(255,255,255,0.03); border-radius: 8px; display: flex; justify-content: space-between; align-items: center; font-size: 0.9rem;';
        
        let badges = '';
        if (p.id === state.currentRoom?.host_id) badges += '<span style="color: #ffd700; margin-left: 4px;">👑</span>';
        if (p.id === state.playerId) badges += '<span style="color: #48bb78; margin-left: 4px;">YOU</span>';
        if (p.has_bid) badges += '<span style="color: #48bb78; margin-left: 4px;">✓</span>';
        
        li.innerHTML = `<span>${p.name}</span><div>${badges}</div>`;
        ul.appendChild(li);
    });
}

export function updateSeats() {
    document.querySelectorAll('.seat').forEach(seat => {
        const seatNum = parseInt(seat.id.split('-')[1]);
        const player = state.players.find(p => p.seat_number === seatNum);
        const slot = seat.querySelector('.player-slot');
        
        if (player && slot) {
            slot.classList.remove('empty');
            slot.classList.add('active');
            slot.querySelector('.avatar').textContent = player.name.charAt(0).toUpperCase();
            slot.querySelector('.name').textContent = player.name;
            slot.style.borderColor = player.id === state.playerId ? '#48bb78' : 'rgba(255,255,255,0.1)';
        } else if (slot) {
            slot.classList.add('empty');
            slot.classList.remove('active');
            slot.querySelector('.avatar').textContent = '?';
            slot.querySelector('.name').textContent = 'Empty';
            slot.style.borderColor = 'rgba(255,255,255,0.1)';
        }
    });
}