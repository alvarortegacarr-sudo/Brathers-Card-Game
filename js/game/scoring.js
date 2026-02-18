// ==========================================
// SCORING AND END SET LOGIC
// ==========================================

import { state, resetGameState } from './state.js';
import * as db from './supabase.js';
import * as ui from './ui.js';
import { addChatMessage, updateHostControls } from './main.js';
import { WINNING_SCORE } from './config.js';

export async function endSet() {
    console.log('Ending set...');
    state.currentPhase = 'scoring';
    ui.renderHand([]);
    
    try {
        await db.updateRoom({ phase: 'scoring' });
        
        const players = await db.fetchPlayers();
        const results = [];
        
        for (const player of players) {
            const predicted = player.predicted_rounds || 0;
            const won = player.won_rounds || 0;
            
            let points = won * 2;
            if (predicted === won) {
                points += 3;
            } else {
                points -= 2;
            }
            
            const newTotal = (player.total_score || 0) + points;
            await db.updatePlayer(player.id, { total_score: newTotal });
            
            results.push({
                name: player.name,
                predicted,
                won,
                points,
                total: newTotal
            });
        }
        
        results.sort((a, b) => b.total - a.total);
        
        // Display results
        let resultMsg = '📊 SET RESULTS:\n';
        results.forEach(r => {
            const status = r.predicted === r.won ? '✓' : '✗';
            resultMsg += `${r.name}: ${r.points > 0 ? '+' : ''}${r.points}pts (Total: ${r.total}) ${status}\n`;
        });
        addChatMessage('System', resultMsg);
        
        // Check for game winner
        const winner = results.find(r => r.total >= WINNING_SCORE);
        if (winner) {
            addChatMessage('System', `🎉 ${winner.name} WINS THE GAME!`);
            setTimeout(() => endGame('completed'), 5000);
        } else {
            await prepareNextSet();
        }
        
    } catch (err) {
        console.error('End set error:', err);
    }
}

async function prepareNextSet() {
    console.log('Preparing next set...');
    
    resetGameState();
    state.currentRoom.status = 'waiting';
    
    await db.updateRoom({ 
        phase: 'waiting',
        status: 'waiting'
    });
    
    const isHost = localStorage.getItem('isHost') === 'true';
    if (isHost) {
        addChatMessage('System', `Set complete! Click Start Game when ready for next set.`);
    } else {
        addChatMessage('System', `Set complete! Waiting for host to start next set.`);
    }
    
    updateHostControls();
}

function endGame(reason) {
    setTimeout(() => {
        const message = reason === 'completed' ? 'Game completed!' : 'Game ended';
        localStorage.removeItem('currentRoom');
        localStorage.removeItem('currentPlayer');
        localStorage.removeItem('isHost');
        alert(message);
        window.location.href = 'index.html';
    }, 3000);
}