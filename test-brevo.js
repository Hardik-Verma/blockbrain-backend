import 'dotenv/config';

async function run() {
    const brevoApiKey = process.env.BREVO_API_KEY;
    if (!brevoApiKey) {
        console.log("No Brevo API Key found in .env");
        return;
    }
    
    try {
        const response = await fetch('https://api.brevo.com/v3/smtp/statistics/events?limit=10&sort=desc', {
            headers: {
                'accept': 'application/json',
                'api-key': brevoApiKey
            }
        });
        const data = await response.json();
        console.log(JSON.stringify(data, null, 2));
    } catch (e) {
        console.error(e);
    }
}
run();
