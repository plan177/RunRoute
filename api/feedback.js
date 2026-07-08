export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { message, user_id, username } = req.body || {};

    if (!message || !message.trim()) {
        return res.status(400).json({ error: 'Message is required' });
    }

    const botToken = process.env.BOT_TOKEN;
    const chatId = process.env.FEEDBACK_CHAT_ID;

    if (!botToken || !chatId) {
        return res.status(500).json({ error: 'Feedback not configured' });
    }

    const userInfo = username ? `@${username}` : user_id ? `ID: ${user_id}` : 'аноним';
    const text = `📩 *Обратная связь от* ${userInfo}\n\n${message.trim()}`;

    try {
        const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: parseInt(chatId), text, parse_mode: 'Markdown' })
        });

        const data = await resp.json();

        if (!resp.ok) {
            console.error('Telegram error:', JSON.stringify(data));
            return res.status(500).json({ error: data.description || 'Failed to send' });
        }

        return res.status(200).json({ status: 'ok' });
    } catch (e) {
        console.error('Feedback error:', e.message);
        return res.status(500).json({ error: e.message });
    }
}
