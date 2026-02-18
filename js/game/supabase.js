// ==========================================
// DATABASE OPERATIONS
// ==========================================

// Use global supabaseClient from window (loaded by supabase.js)
export const supabaseClient = window.supabaseClient;

if (!supabaseClient) {
    console.error('CRITICAL: supabaseClient not found on window!');
}

// Room operations
export async function fetchRoom(roomCode) {
    console.log('Fetching room:', roomCode);
    const { data, error } = await supabaseClient
        .from('rooms')
        .select('*, players(*), turn_order(*)')
        .eq('code', roomCode)
        .single();
    
    if (error) {
        console.error('Fetch room error:', error);
        throw error;
    }
    console.log('Room fetched:', data?.id);
    return data;
}

export async function updateRoom(updates) {
    console.log('Updating room:', updates);
    const { error } = await supabaseClient
        .from('rooms')
        .update(updates)
        .eq('id', state.roomId);
    
    if (error) {
        console.error('Update room error:', error);
        throw error;
    }
}

// Player operations
export async function fetchPlayers() {
    const { data, error } = await supabaseClient
        .from('players')
        .select('*')
        .eq('room_id', state.roomId)
        .order('seat_number');
    
    if (error) throw error;
    return data || [];
}

export async function updatePlayer(playerId, updates) {
    const { error } = await supabaseClient
        .from('players')
        .update(updates)
        .eq('id', playerId);
    
    if (error) throw error;
}

export async function resetPlayerStats() {
    console.log('Resetting player stats for', state.players.length, 'players');
    for (const player of state.players) {
        await supabaseClient
            .from('players')
            .update({ 
                predicted_rounds: null, 
                won_rounds: 0, 
                has_bid: false 
            })
            .eq('id', player.id);
    }
}

// Hand operations
export async function fetchMyHand() {
    console.log('Fetching hand for player:', state.playerId);
    const { data, error } = await supabaseClient
        .from('player_hands')
        .select('*, cards(*)')
        .eq('room_id', state.roomId)
        .eq('player_id', state.playerId);
    
    if (error) {
        console.error('Fetch hand error:', error);
        throw error;
    }
    return data || [];
}

export async function dealCardsToPlayer(playerId, cards) {
    for (const card of cards) {
        await supabaseClient
            .from('player_hands')
            .insert({
                room_id: state.roomId,
                player_id: playerId,
                card_id: card.id,
                played: false
            });
    }
}

export async function markCardPlayed(handRecordId) {
    await supabaseClient
        .from('player_hands')
        .update({ played: true })
        .eq('id', handRecordId);
}

// Turn order operations
export async function createTurnOrder(shuffledPlayers) {
    console.log('Creating turn order for', shuffledPlayers.length, 'players');
    for (let i = 0; i < shuffledPlayers.length; i++) {
        await supabaseClient
            .from('turn_order')
            .insert({
                room_id: state.roomId,
                player_id: shuffledPlayers[i].id,
                position: i
            });
    }
}

export async function fetchTurnOrder() {
    const { data, error } = await supabaseClient
        .from('turn_order')
        .select('*')
        .eq('room_id', state.roomId)
        .order('position');
    
    if (error) throw error;
    return data || [];
}

// Turn plays operations
export async function fetchCurrentPlays() {
    const { data, error } = await supabaseClient
        .from('current_turn_plays')
        .select('*, players(*), cards(*)')
        .eq('room_id', state.roomId)
        .order('played_at', { ascending: true });
    
    if (error) throw error;
    return data || [];
}

export async function playCardToTable(cardId, attribute, value, totalStats) {
    await supabaseClient
        .from('current_turn_plays')
        .insert({
            room_id: state.roomId,
            player_id: state.playerId,
            card_id: cardId,
            attribute: attribute,
            value: value,
            total_stats: totalStats
        });
}

export async function clearCurrentPlays() {
    await supabaseClient
        .from('current_turn_plays')
        .delete()
        .eq('room_id', state.roomId);
}

// Chat operations
export async function fetchChatHistory() {
    const { data } = await supabaseClient
        .from('chat_messages')
        .select('*')
        .eq('room_id', state.roomId)
        .order('created_at', { ascending: true })
        .limit(50);
    
    return data || [];
}

export async function sendChatMessage(message) {
    await supabaseClient
        .from('chat_messages')
        .insert({
            room_id: state.roomId,
            player_id: state.playerId,
            player_name: state.currentPlayer,
            message: message
        });
}

// Cleanup operations
export async function cleanupGameData() {
    console.log('Cleaning up game data');
    await supabaseClient.from('player_hands').delete().eq('room_id', state.roomId);
    await supabaseClient.from('current_turn_plays').delete().eq('room_id', state.roomId);
    await supabaseClient.from('turn_order').delete().eq('room_id', state.roomId);
}

export async function deletePlayer() {
    await supabaseClient.from('players').delete().eq('id', state.playerId);
}

export async function updateLastSeen() {
    await supabaseClient
        .from('players')
        .update({ last_seen: new Date().toISOString() })
        .eq('id', state.playerId);
}

// Import state at end to avoid circular dependency
import { state } from './state.js';