// Generate random player ID if not exists
let playerId = localStorage.getItem('playerId');
if (!playerId) {
    playerId = crypto.randomUUID();
    localStorage.setItem('playerId', playerId);
}

async function createRoom() {
    const name = document.getElementById('playerName').value.trim();
    if (!name) {
        showError('Please enter your name');
        return;
    }

    try {
        // Insert room
        const { error: roomError } = await supabaseClient
            .from('rooms')
            .insert([{ host_id: playerId, status: 'waiting' }]);

        if (roomError) throw roomError;

        // Get the room we just created
        const { data: room, error: fetchError } = await supabaseClient
            .from('rooms')
            .select('*')
            .eq('host_id', playerId)
            .eq('status', 'waiting')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (fetchError) throw fetchError;

        // Join as first player (seat 1, host)
        const { error: playerError } = await supabaseClient
            .from('players')
            .upsert([{
                room_id: room.id,
                name: name,
                seat_number: 1,
                id: playerId
            }]);

        if (playerError) throw playerError;

        // Store session
        localStorage.setItem('currentRoom', room.code);
        localStorage.setItem('currentPlayer', name);
        localStorage.setItem('isHost', 'true');
        localStorage.setItem('seatNumber', '1');

        // Redirect to game
        window.location.href = 'game.html';

    } catch (error) {
        showError('Failed to create room: ' + error.message);
    }
}

async function joinRoom() {
    const name = document.getElementById('joinName').value.trim();
    const code = document.getElementById('roomCode').value.trim().toUpperCase();

    if (!name || !code) {
        showError('Please enter your name and room code');
        return;
    }

    try {
        // Find room
        const { data: room, error: roomError } = await supabaseClient
            .from('rooms')
            .select('*')
            .eq('code', code)
            .single();

        if (roomError || !room) {
            showError('Room not found');
            return;
        }

        if (room.status !== 'waiting') {
            showError('Game already in progress');
            return;
        }

        // Check current player count
        const { data: players, error: countError } = await supabaseClient
            .from('players')
            .select('*')
            .eq('room_id', room.id);

        if (players.length >= 5) {
            showError('Room is full (5/5 players)');
            return;
        }

        // Find first available seat
        const occupiedSeats = players.map(p => p.seat_number);
        let seatNumber = 1;
        while (occupiedSeats.includes(seatNumber) && seatNumber <= 5) {
            seatNumber++;
        }

        // Join room
        const { error: joinError } = await supabaseClient
            .from('players')
            .insert([{
                room_id: room.id,
                name: name,
                seat_number: seatNumber,
                id: playerId
            }]);

        if (joinError) throw joinError;

        // Store session
        localStorage.setItem('currentRoom', code);
        localStorage.setItem('currentPlayer', name);
        localStorage.setItem('isHost', 'false');
        localStorage.setItem('seatNumber', seatNumber.toString());

        window.location.href = 'game.html';

    } catch (error) {
        showError('Failed to join room: ' + error.message);
    }
}

function showError(msg) {
    const errorDiv = document.getElementById('errorMsg');
    errorDiv.textContent = msg;
    errorDiv.style.display = 'block';
    setTimeout(() => {
        errorDiv.style.display = 'none';
    }, 5000);
}

// Allow Enter key to submit
document.getElementById('roomCode')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinRoom();
});