// ==========================================
// GAME ENTRY POINT
// ==========================================

import { initGame, startNewSet, submitBid, selectAttribute, playCard, copyCode, leaveGame, sendChatMessage, updateHostControls } from './game/main.js';

// Make functions available globally for HTML onclick handlers
window.startNewSet = startNewSet;
window.submitBid = submitBid;
window.selectAttribute = selectAttribute;
window.playCard = playCard;
window.copyCode = copyCode;
window.leaveGame = leaveGame;
window.sendChatMessage = sendChatMessage;
window.updateHostControls = updateHostControls;

// Start the game when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGame);
} else {
    initGame();
}