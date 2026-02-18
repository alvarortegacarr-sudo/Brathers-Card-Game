// ==========================================
// BIDDING PHASE LOGIC - FIXED
// ==========================================

import { state } from './state.js';
import * as db from './supabase.js';
import * as ui from './ui.js';
import { addChatMessage } from './main.js';
import { supabaseClient } from './supabase.js';

export async function submitBid(bid) {
    console.log('=== SUBMIT BID ===', bid);
    console.log('Phase:', state.currentPhase);
    
    if (state.currentPhase !== 'bidding') {
        console.warn('Cannot bid: not in bidding phase');
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
        console.log('Saving bid...');
        await db.updatePlayer(state.playerId, {
            predicted_rounds: bid,
            has_bid: true
        });
        
        addChatMessage('System', `You bid ${bid} rounds!`);
        
        // Check if all players bid
        setTimeout(() => checkAllPlayersBid(), 500);
        
    } catch (err) {
        console.error('Bid error:', err);
        state.hasBidded = false;
        ui.renderHand(state.myHand);
        alert('Failed to place bid. Try again.');
    }
}

async function checkAllPlayersBid() {
    console.log('Checking all players bid...');
    
    try {
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
        const biddedCount = players.filter(p => p.has_bid === true || p.has_bid === 1).length;
        
        console.log(`Progress: ${biddedCount}/${totalPlayers}`);
        console.log('Status:', players.map(p => `${p.name}: ${p.has_bid ? 'bid' : 'waiting'}`));
        
        if (biddedCount >= totalPlayers) {
            console.log('ALL BID! Transitioning...');
            await transitionToPlayingPhase();
        } else {
            setTimeout(checkAllPlayersBid, 1000);
        }
    } catch (err) {
        console.error('Check error:', err);
        setTimeout(checkAllPlayersBid, 1000);
    }
}

async function transitionToPlayingPhase() {
    try {
        await supabaseClient
            .from('rooms')
            .update({
                phase: 'playing',
                current_turn: 1,
                current_attribute: null,
                game_data: { round_starter: 0 }
            })
            .eq('id', state.roomId);
        
        addChatMessage('System', `🎮 Round 1 begins! First player selects attribute and plays card.`);
    } catch (err) {
        console.error('Transition error:', err);
        setTimeout(transitionToPlayingPhase, 2000);
    }
}

export function canBid() {
    return state.currentPhase === 'bidding' && !state.hasBidded;
}