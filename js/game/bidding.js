// ==========================================
// BIDDING PHASE LOGIC
// ==========================================

import { state } from './state.js';
import * as db from './supabase.js';
import * as ui from './ui.js';
import { addChatMessage } from './main.js';

export async function submitBid(bid) {
    console.log('=== SUBMIT BID ===', bid, 'Phase:', state.currentPhase);
    
    if (state.currentPhase !== 'bidding') {
        console.warn('Cannot bid: not in bidding phase, current:', state.currentPhase);
        return;
    }
    
    if (state.hasBidded) {
        console.warn('Already bid');
        return;
    }
    
    // Update local state immediately
    state.hasBidded = true;
    ui.renderHand(state.myHand);
    
    try {
        console.log('Saving bid to database...');
        await db.updatePlayer(state.playerId, {
            predicted_rounds: bid,
            has_bid: true
        });
        
        addChatMessage('System', `You bid ${bid} rounds!`);
        
        // Check if all players have bid
        setTimeout(() => checkAllPlayersBid(), 500);
        
    } catch (err) {
        console.error('Bid error:', err);
        state.hasBidded = false;
        ui.renderHand(state.myHand);
        alert('Failed to place bid. Try again.');
    }
}

async function checkAllPlayersBid() {
    console.log('Checking if all players have bid...');
    
    try {
        const players = await db.fetchPlayers();
        const totalPlayers = players.length;
        const biddedCount = players.filter(p => p.has_bid).length;
        
        console.log(`Bidding progress: ${biddedCount}/${totalPlayers}`);
        
        if (biddedCount >= totalPlayers) {
            console.log('ALL PLAYERS BID! Starting game...');
            await transitionToPlayingPhase();
        }
    } catch (err) {
        console.error('Check all bid error:', err);
        setTimeout(checkAllPlayersBid, 1000);
    }
}

async function transitionToPlayingPhase() {
    try {
        await db.updateRoom({
            phase: 'playing',
            current_turn: 1,
            current_attribute: null,
            current_round_starter: 0
        });
        
        addChatMessage('System', `🎮 Round 1 begins! First player selects attribute and plays card.`);
    } catch (err) {
        console.error('Transition error:', err);
    }
}

export function canBid() {
    return state.currentPhase === 'bidding' && !state.hasBidded;
}