// Vercel Serverless Function: POST /api/next-move
// No deps. Calls OpenAI with your key from env and returns strict JSON.
module.exports = async (req, res) => {
  // CORS for Squarespace; set your domain later if you want to lock it down
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { area, energy, time } = req.body || {};
    if (!area || !energy || !time) {
      return res.status(400).json({ error: 'Missing fields: area, energy, time' });
    }

    const system = `
You are a calm, supportive coach. Output strict JSON with keys:
- next_move: one tiny, verifiable action sized to user's energy and time (minutes)
- rationale: one sentence why it fits now
- message_draft: optional short message to copy (omit if not relevant)
- checkin_window_hours: 24 or 48
`.trim();

    const user = JSON.stringify({ area, energy, time_minutes: Number(time) });

    // Call OpenAI Chat Completions directly via fetch (no SDK needed)
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',            // cheap & capable
        temperature: 0.6,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: user }
        ]
      })
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return res.status(502).json({ error: 'OpenAI error', detail });
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || '{}';
    const out = JSON.parse(content);
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: 'Server error', detail: String(e) });
  }
};
