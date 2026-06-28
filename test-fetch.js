fetch('https://blockbrain-backend.onrender.com/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'hardikverma1902@gmail.com' })
}).then(r => r.json().then(d => console.log(r.status, d))).catch(console.error);
