// ==========================================
// BIDDING PHASE LOGIC
// ==========================================

import { state } from './state.js';
import * as db from './supabase.js';
import * as ui from './ui.js';
import { addChatMessage } from './main.js';
import { supabaseClient } from './supabase.js';

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
        
        // Check if all players have bid after a short delay
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
        // Fetch fresh player data directly from database
        const { data: players, error } = await supabaseClient
            .from('players')
            .select('*')
            .eq('room_id', state.roomId);
        
        if (error) {
            console.error('Fetch error:', error);
            setTimeout(checkAllPlayersBid, 1000);
            return;
        }
        
        const totalPlayers = players.length;
        const biddedCount = players.filter(p => p.has_bid).length;
        
        console.log(`Bidding progress: ${biddedCount}/${totalPlayers}`);
        console.log('Players status:', players.map(p => `${p.name}: ${p.has_bid ? 'bid' : 'waiting'}`));
        
        if (biddedCount >= totalPlayers) {
            console.log('ALL PLAYERS BID! Starting game...');
            await transitionToPlayingPhase();
        } else {
            // Check again in 1 second
            setTimeout(checkAllPlayersBid, 1000);
        }
    } catch (err) {
        console.error('Check all bid error:', err);
        setTimeout(checkAllPlayersBid, 1000);
    }
}

async function transitionToPlayingPhase() {
    try {
        console.log('Transitioning to playing phase...');
        const { error } = await supabaseClient
            .from('rooms')
            .update({
                phase: 'playing',
                current_turn: 1,
                current_attribute: null,
                game_data: { round_starter: 0 }
            })
            .eq('id', state.roomId);
        
        if (error) {
            console.error('Transition error:', error);
            throw error;
        }
        
        console.log('Successfully transitioned to playing phase');
        addChatMessage('System', `🎮 Round 1 begins! First player selects attribute and plays card.`);
    } catch (err) {
        console.error('Transition error:', err);
        // Retry after delay
        setTimeout(transitionToPlayingPhase, 2000);
    }
}

export function canBid() {
    return state.currentPhase === 'bidding' && !state.hasBidded;
}