// ==========================================
// PLAYING PHASE LOGIC
// ==========================================

import { state } from './state.js';
import * as db from './supabase.js';
import * as ui from './ui.js';
import { addChatMessage } from './main.js';
import { calculateTotalStats, ATTRIBUTE_NAMES } from './config.js';

export async function selectAttribute(attribute) {
    console.log('Selecting attribute:', attribute);
    console.log('Current phase:', state.currentPhase);
    console.log('Current room:', state.currentRoom);
    
    if (state.currentPhase !== 'playing') {
        console.warn('Not in playing phase');
        return;
    }
    
    // Get round starter from game_data
    const gameData = state.currentRoom.game_data || {};
    const roundStarter = gameData.round_starter || 0;
    
    console.log('Round starter:', roundStarter, 'My position:', state.myPosition);
    
    if (state.myPosition !== roundStarter) {
        alert('Only the round starter can select the attribute!');
        return;
    }
    
    if (state.currentAttribute) {
        alert('Attribute already selected for this round!');
        return;
    }
    
    try {
        state.currentAttribute = attribute;
        await db.updateRoom({ current_attribute: attribute });
        addChatMessage('System', `${state.currentPlayer} selected ${ATTRIBUTE_NAMES[attribute]}! Now play your card!`);
        ui.renderHand(state.myHand);
    } catch (err) {
        console.error('Select attribute error:', err);
        state.currentAttribute = null;
    }
}

export async function playCard(cardId) {
    console.log('Playing card:', cardId);
    
    if (state.currentPhase !== 'playing') {
        console.warn('Not in playing phase');
        return;
    }
    
    const card = state.myHand.find(c => c.id === cardId);
    if (!card) {
        console.warn('Card not found in hand. My hand:', state.myHand);
        alert('Card not found in your hand!');
        return;
    }
    
    try {
        const currentPlays = await db.fetchCurrentPlays();
        const playsThisRound = currentPlays.length;
        
        // Get round starter from game_data
        const gameData = state.currentRoom.game_data || {};
        const roundStarter = gameData.round_starter || 0;
        
        console.log('Plays this round:', playsThisRound, 'Round starter:', roundStarter);
        
        // Determine whose turn it is
        let expectedPosition;
        if (playsThisRound === 0) {
            // First play - must be round starter
            expectedPosition = roundStarter;
        } else {
            // Subsequent plays - go clockwise from starter
            expectedPosition = (roundStarter + playsThisRound) % state.players.length;
        }
        
        console.log('Expected position:', expectedPosition, 'My position:', state.myPosition);
        
        if (state.myPosition !== expectedPosition) {
            const expectedPlayer = await getPlayerAtPosition(expectedPosition);
            alert(`Wait for ${expectedPlayer} to play! It's their turn.`);
            return;
        }
        
        // First player must select attribute first
        if (playsThisRound === 0 && !state.currentAttribute) {
            alert('Select an attribute first!');
            return;
        }
        
        let value = card[state.currentAttribute];
        if (state.triunfoCard && card.id === state.triunfoCard.id) {
            value = 99;
        }
        
        await db.playCardToTable(cardId, state.currentAttribute, value, calculateTotalStats(card));
        
        const handRecord = state.myHand.find(c => c.id === cardId);
        if (handRecord?.hand_record_id) {
            await db.markCardPlayed(handRecord.hand_record_id);
        }
        
        state.myHand = state.myHand.filter(c => c.id !== cardId);
        ui.renderHand(state.myHand);
        
        const cardName = card.id === state.triunfoCard?.id ? `${card.name} 👑` : card.name;
        addChatMessage('System', `${state.currentPlayer} played ${cardName} (${value} ${ATTRIBUTE_NAMES[state.currentAttribute]})`);
        
        if (playsThisRound + 1 >= state.players.length) {
            setTimeout(() => resolveTurn(), 1500);
        }
        
    } catch (err) {
        console.error('Play card error:', err);
        alert('Failed to play card: ' + err.message);
    }
}

async function getPlayerAtPosition(position) {
    const turnOrder = await db.fetchTurnOrder();
    const entry = turnOrder.find(t => t.position === position);
    if (!entry) return 'Another player';
    
    const player = state.players.find(p => p.id === entry.player_id);
    return player?.name || 'Another player';
}

async function resolveTurn() {
    console.log('Resolving turn...');
    
    try {
        const plays = await db.fetchCurrentPlays();
        if (plays.length < state.players.length) return;
        
        const winner = plays.reduce((max, play) => {
            if (play.value > max.value) return play;
            if (play.value === max.value) {
                const playTotal = play.total_stats || calculateTotalStats(play.cards);
                const maxTotal = max.total_stats || calculateTotalStats(max.cards);
                if (playTotal > maxTotal) return play;
            }
            return max;
        });
        
        const winnerPlayer = state.players.find(p => p.id === winner.player_id);
        await db.updatePlayer(winner.player_id, {
            won_rounds: (winnerPlayer?.won_rounds || 0) + 1
        });
        
        const winCardName = winner.cards.id === state.triunfoCard?.id ? 
            `${winner.cards.name} 👑` : winner.cards.name;
        addChatMessage('System', `🏆 ${winner.players.name} wins with ${winCardName}!`);
        
        await db.clearCurrentPlays();
        
        const { data: allHands } = await supabaseClient
            .from('player_hands')
            .select('played')
            .eq('room_id', state.roomId);
        
        const totalRemaining = allHands?.filter(h => !h.played).length || 0;
        
        if (totalRemaining === 0) {
            const { endSet } = await import('./scoring.js');
            await endSet();
        } else {
            const turnOrder = await db.fetchTurnOrder();
            const winnerEntry = turnOrder.find(t => t.player_id === winner.player_id);
            const nextStarter = winnerEntry ? winnerEntry.position : 0;
            const nextTurn = (state.currentRoom.current_turn || 0) + 1;
            
            // Update game_data with new round_starter instead of current_round_starter
            const currentGameData = state.currentRoom.game_data || {};
            await db.updateRoom({
                current_turn: nextTurn,
                current_attribute: null,
                game_data: { ...currentGameData, round_starter: nextStarter }
            });
            
            addChatMessage('System', `Round ${nextTurn} begins! ${winner.players.name} selects attribute.`);
        }
        
    } catch (err) {
        console.error('Resolve turn error:', err);
    }
}

export function isMyTurnToSelect() {
    // Use game_data.round_starter instead of current_round_starter
    const roundStarter = state.currentRoom?.game_data?.round_starter || 0;
    return state.myPosition === roundStarter && !state.currentAttribute;
}

// Import supabaseClient at the end to avoid circular dependency
import { supabaseClient } from './supabase.js';