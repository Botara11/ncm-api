// /api/agent.js — SSE agent runtime. No DB.
// Env needed: NEXT_MOVE_URL (points to your /api/next-move), optional ALLOWED_ORIGIN

function send(res, payload) { res.write(`data: ${JSON.stringify(payload)}\n\n`); }

module.exports = async (req, res) => {
  // --- CORS (for GET/SSE from Squarespace)
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // --- SSE headers
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // --- Parse query
  const url   = new URL(req.url, `http://${req.headers.host}`);
  const event = url.searchParams.get('event') || 'start';
  const data  = url.searchParams.get('data')  ? JSON.parse(url.searchParams.get('data'))  : {};
  const state = url.searchParams.get('state') ? JSON.parse(url.searchParams.get('state')) : {};

  // --- helpers
  const bubble = (role, html) => send(res, { type:'bubble', role, html });
  const chips  = (arr)        => send(res, { type:'chips', options: arr }); // [{label,value,event,set}]
  const tool   = (name,p)     => send(res, { type:'tool', name, payload:p });
  const done   = ()           => send(res, { type:'end' });

  try {
    if (event === 'start') {
      bubble('bot', `<strong>I'm here to give you a gentle nudge.</strong><br/>Answer three tiny questions and I’ll suggest a next move you can do right now.<br/><br/><strong>Which part of life needs a nudge today?</strong>`);
      chips([
        { label:'Work',          value:'Work',          event:'set_area',   set:'area' },
        { label:'Health',        value:'Health',        event:'set_area',   set:'area' },
        { label:'Relationships', value:'Relationships', event:'set_area',   set:'area' }
      ]);
      return done();
    }

    if (event === 'set_area') {
      const area = data.value;
      bubble('bot', `Great — <em>${escapeHtml(area)}</em> it is.<br/><strong>How much energy do you have right now?</strong>`);
      chips([
        { label:'🔋 Low',    value:'Low',    event:'set_energy', set:'energy' },
        { label:'⚡ Medium', value:'Medium', event:'set_energy', set:'energy' },
        { label:'🚀 High',   value:'High',   event:'set_energy', set:'energy' }
      ]);
      return done();
    }

    if (event === 'set_energy') {
      bubble('bot', `<strong>How much time do you want to spend?</strong>`);
      chips([
        { label:'5 min',  value:'5',  event:'set_time', set:'time' },
        { label:'15 min', value:'15', event:'set_time', set:'time' }
      ]);
      return done();
    }

    if (event === 'set_time') {
      const area   = state.area;
      const energy = state.energy;
      const time   = data.value || state.time;

      if (!area || !energy || !time) {
        bubble('bot', `I’m missing some info. Let’s start again—Which part of life needs a nudge today?`);
        chips([
          { label:'Work', value:'Work', event:'set_area', set:'area' },
          { label:'Health', value:'Health', event:'set_area', set:'area' },
          { label:'Relationships', value:'Relationships', event:'set_area', set:'area' }
        ]);
        return done();
      }

      // Typing indicator on
      send(res, { type:'typing', on:true });

      // Call your next-move API
      const r = await fetch(process.env.NEXT_MOVE_URL, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ area, energy, time })
      });

      // Typing off
      send(res, { type:'typing', on:false });

      if (!r.ok) {
        bubble('bot', `The suggestion engine hiccuped. Try again?`);
        chips([{ label:'Restart', value:null, event:'start' }]);
        return done();
      }

      const d = await r.json();
      const text = [
        `**Next move**\n${d.next_move || '—'}`,
        d.message_draft ? `\n**Draft**\n${d.message_draft}` : '',
        d.rationale ? `\n**Why**\n${d.rationale}` : ''
      ].join('\n').trim();

      bubble('bot', `<pre>${escapeHtml(text)}</pre>`);
      chips([
        { label:'Save & track (login)', value:{ area, energy, time }, event:'open_login' },
        { label:'Give me another option', value:{ area, energy, time }, event:'another' }
      ]);
      return done();
    }

    if (event === 'another') {
      const { area, energy, time } = data.value || state || {};
      send(res, { type:'typing', on:true });
      const r = await fetch(process.env.NEXT_MOVE_URL, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ area, energy, time, tweak: 'another option' })
      });
      send(res, { type:'typing', on:false });

      if (!r.ok) {
        bubble('bot', `Couldn’t get a variation right now. Try again in a moment?`);
        return done();
      }
      const d = await r.json();
      const text = [
        `**Another option**\n${d.next_move || '—'}`,
        d.message_draft ? `\n**Draft**\n${d.message_draft}` : '',
        d.rationale ? `\n**Why**\n${d.rationale}` : ''
      ].join('\n').trim();
      bubble('bot', `<pre>${escapeHtml(text)}</pre>`);
      chips([
        { label:'Save & track (login)', value:{ area, energy, time }, event:'open_login' },
        { label:'Something else', value:{ area, energy, time }, event:'another' }
      ]);
      return done();
    }

    if (event === 'open_login') {
      const { area, energy, time } = data.value || state || {};
      tool('open_login', { area, energy, time });
      return done();
    }

    // Default fallback → restart
    bubble('bot', `Let’s start again. Which part of life needs a nudge today?`);
    chips([
      { label:'Work', value:'Work', event:'set_area', set:'area' },
      { label:'Health', value:'Health', event:'set_area', set:'area' },
      { label:'Relationships', value:'Relationships', event:'set_area', set:'area' }
    ]);
    return done();

  } catch (e) {
    bubble('bot', `I hit a snag. Refresh and try again.`);
    done();
  }
};

function escapeHtml(s=''){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
