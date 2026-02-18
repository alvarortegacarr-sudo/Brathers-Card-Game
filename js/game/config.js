// ==========================================
// GAME CONFIGURATION
// ==========================================

export const ATTRIBUTES = ['car', 'cul', 'tet', 'fis', 'per'];
export const ATTRIBUTE_NAMES = { 
    car: 'CAR', 
    cul: 'CUL', 
    tet: 'TET', 
    fis: 'FIS', 
    per: 'PER' 
};
export const WINNING_SCORE = 50;
export const CARD_DISTRIBUTION = { 2: 20, 3: 13, 4: 10, 5: 8 };

export function calculateTotalStats(card) {
    return ATTRIBUTES.reduce((sum, attr) => sum + (card[attr] || 0), 0);
}

export function getAttributeColor(attr) {
    const colors = {
        car: '#ef4444',
        cul: '#8b5cf6',
        tet: '#10b981',
        fis: '#3b82f6',
        per: '#f59e0b'
    };
    return colors[attr] || '#666';
}