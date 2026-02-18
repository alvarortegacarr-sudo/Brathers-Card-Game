// ==========================================
// PLAYING PHASE LOGIC - FIXED
// ==========================================

import { state } from './state.js';
import * as db from './supabase.js';
import * as ui from './ui.js';
import { addChatMessage } from './main.js';
import { calculateTotalStats, ATTRIBUTE_NAMES } from './config.js';
import { supabaseClient } from './supabase.js';

// Track if we've played this round
let hasPlayedThisRound = false;

export async function selectAttribute(attribute) {
    console.log('=== SELECT ATTRIBUTE ===');
    console.log('Attribute:', attribute);
    console.log('Current phase:', state.currentPhase);
    
    if (state.currentPhase !== 'playing') {
        console.warn('Not in playing phase');
        return;
    }
    
    // Get round starter from game_data
    const gameData = state.currentRoom?.game_data || {};
    const roundStarter = gameData.round_starter ?? 0;
    
    console.log('Round starter:', roundStarter);
    console.log('My position:', state.myPosition);
    console.log('Current attribute:', state.currentAttribute);
    
    // Only round starter can select, and only if no attribute selected yet
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
    console.log('=== PLAY CARD ===');
    console.log('Card ID:', cardId);
    console.log('Current phase:', state.currentPhase);
    console.log('Has played this round:', hasPlayedThisRound);
    
    if (state.currentPhase !== 'playing') {
        console.warn('Not in playing phase');
        return;
    }
    
    // CRITICAL: Check if we already played this round
    if (hasPlayedThisRound) {
        alert('You already played a card this round!');
        return;
    }
    
    const card = state.myHand.find(c => c.id === cardId);
    if (!card) {
        console.error('Card not in hand. Hand:', state.myHand.map(c => ({id: c.id, name: c.name})));
        alert('Card not found in your hand!');
        return;
    }
    
    try {
        // Get current plays from database
        const currentPlays = await db.fetchCurrentPlays();
        const playsThisRound = currentPlays.length;
        
        // Get round starter
        const gameData = state.currentRoom?.game_data || {};
        const roundStarter = gameData.round_starter ?? 0;
        
        console.log('Plays this round:', playsThisRound);
        console.log('Round starter:', roundStarter);
        
        // Calculate whose turn it is
        let expectedPosition;
        if (playsThisRound === 0) {
            // First play - must be round starter
            expectedPosition = roundStarter;
        } else {
            // Subsequent plays - clockwise from starter
            expectedPosition = (roundStarter + playsThisRound) % state.players.length;
        }
        
        console.log('Expected position:', expectedPosition);
        console.log('My position:', state.myPosition);
        
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
        
        // Calculate card value
        let value = card[state.currentAttribute];
        if (state.triunfoCard && card.id === state.triunfoCard.id) {
            value = 99;
        }
        
        console.log('Playing card with value:', value);
        
        // Play the card
        await db.playCardToTable(cardId, state.currentAttribute, value, calculateTotalStats(card));
        
        // Mark as played in database
        const handRecord = state.myHand.find(c => c.id === cardId);
        if (handRecord?.hand_record_id) {
            await db.markCardPlayed(handRecord.hand_record_id);
        }
        
        // Update local state
        hasPlayedThisRound = true; // CRITICAL: Prevent multiple plays
        state.myHand = state.myHand.filter(c => c.id !== cardId);
        
        ui.renderHand(state.myHand);
        
        const cardName = card.id === state.triunfoCard?.id ? `${card.name} 👑` : card.name;
        addChatMessage('System', `${state.currentPlayer} played ${cardName} (${value} ${ATTRIBUTE_NAMES[state.currentAttribute]})`);
        
        // Check if round complete
        if (playsThisRound + 1 >= state.players.length) {
            setTimeout(() => resolveTurn(), 1500);
        }
        
    } catch (err) {
        console.error('Play card error:', err);
        hasPlayedThisRound = false; // Reset on error
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
    console.log('=== RESOLVE TURN ===');
    
    try {
        const plays = await db.fetchCurrentPlays();
        console.log('Plays:', plays.length);
        
        if (plays.length < state.players.length) {
            console.warn('Not enough plays yet');
            return;
        }
        
        // Find winner with tiebreaker
        const winner = plays.reduce((max, play) => {
            if (play.value > max.value) return play;
            if (play.value === max.value) {
                const playTotal = play.total_stats || calculateTotalStats(play.cards);
                const maxTotal = max.total_stats || calculateTotalStats(max.cards);
                if (playTotal > maxTotal) return play;
            }
            return max;
        });
        
        console.log('Winner:', winner.players.name);
        
        // Award win
        const winnerPlayer = state.players.find(p => p.id === winner.player_id);
        await db.updatePlayer(winner.player_id, {
            won_rounds: (winnerPlayer?.won_rounds || 0) + 1
        });
        
        const winCardName = winner.cards.id === state.triunfoCard?.id ? 
            `${winner.cards.name} 👑` : winner.cards.name;
        addChatMessage('System', `🏆 ${winner.players.name} wins with ${winCardName}!`);
        
        // Clear plays
        await db.clearCurrentPlays();
        
        // Reset play tracking for new round
        hasPlayedThisRound = false;
        
        // Check if set is over
        const { data: allHands } = await supabaseClient
            .from('player_hands')
            .select('played')
            .eq('room_id', state.roomId);
        
        const totalRemaining = allHands?.filter(h => !h.played && h.played !== 1).length || 0;
        console.log('Cards remaining:', totalRemaining);
        
        if (totalRemaining === 0) {
            console.log('Set over - no cards left');
            const { endSet } = await import('./scoring.js');
            await endSet();
        } else {
            // Next round - winner starts
            const turnOrder = await db.fetchTurnOrder();
            const winnerEntry = turnOrder.find(t => t.player_id === winner.player_id);
            const nextStarter = winnerEntry ? winnerEntry.position : 0;
            const nextTurn = (state.currentRoom.current_turn || 0) + 1;
            
            console.log('Next round:', nextTurn, 'Starter:', nextStarter);
            
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

// Reset play tracking when entering new round
export function resetPlayTracking() {
    hasPlayedThisRound = false;
}

export function isMyTurnToSelect() {
    const gameData = state.currentRoom?.game_data || {};
    const roundStarter = gameData.round_starter ?? 0;
    return state.myPosition === roundStarter && !state.currentAttribute;
}

export function hasPlayedInCurrentRound() {
    return hasPlayedThisRound;
}