// Simple SSE agent runtime (no DB). Client sends ?event=...&data=... via GET.
// We stream chat "frames" back as Server-Sent Events.
function send(res, payload) { res.write(`data: ${JSON.stringify(payload)}\n\n`); }

module.exports = async (req, res) => {
  // SSE headers
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Parse query
  const url = new URL(req.url, `http://${req.headers.host}`);
  const event = url.searchParams.get('event') || 'start';
  const data  = url.searchParams.get('data') ? JSON.parse(url.searchParams.get('data')) : {};
  const state = url.searchParams.get('state') ? JSON.parse(url.searchParams.get('state')) : {};

  // Small helpers
  const bubble = (role, html) => send(res, { type:'bubble', role, html });
  const chips  = (arr)        => send(res, { type:'chips', options: arr }); // [{label, value, event}]
  const tool   = (name,p)     => send(res, { type:'tool', name, payload:p });
  const done   = ()           => send(res, { type:'end' });

  // ROUTER (a tiny state machine)
  try {
    if (event === 'start') {
      bubble('bot', `<strong>I'm here to give you a gentle nudge.</strong><br/>Answer three tiny questions and I’ll suggest a next move you can do right now.<br/><br/><strong>Which part of life needs a nudge today?</strong>`);
      chips([
        { label:'Work',          value:'Work',          event:'set_area' },
        { label:'Health',        value:'Health',        event:'set_area' },
        { label:'Relationships', value:'Relationships', event:'set_area' }
      ]);
      return done();
    }

    if (event === 'set_area') {
      const area = data.value;
      bubble('bot', `Great — <em>${area}</em> it is.<br/><strong>How much energy do you have right now?</strong>`);
      chips([
        { label:'🔋 Low',    value:'Low',    event:'set_energy' },
        { label:'⚡ Medium', value:'Medium', event:'set_energy' },
        { label:'🚀 High',   value:'High',   event:'set_energy' }
      ]);
      return done();
    }

    if (event === 'set_energy') {
      const energy = data.value;
      bubble('bot', `<strong>How much time do you want to spend?</strong>`);
      chips([
        { label:'5 min',  value:'5',  event:'set_time' },
        { label:'15 min', value:'15', event:'set_time' }
      ]);
      return done();
    }

    if (event === 'set_time') {
      const merged = { ...(state||{}), time: data.value, area: state.area || state.temp_area, energy: state.energy || state.temp_energy };
      // Clients send state forward; but to be robust, accept area/energy in query too.
      const area   = state.area   || url.searchParams.get('area')   || merged.area;
      const energy = state.energy || url.searchParams.get('energy') || merged.energy;
      const time   = merged.time;

      // Typing indicator (client renders dots)
      send(res, { type:'typing', on:true });

      // Call your next-move API
      const resp = await fetch(process.env.NEXT_MOVE_URL, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ area, energy, time })
      });
      const dataOut = await resp.json();

      send(res, { type:'typing', on:false });

      const text = [
        `**Next move**\n${dataOut.next_move || '—'}`,
        dataOut.message_draft ? `\n**Draft**\n${dataOut.message_draft}` : '',
        dataOut.rationale ? `\n**Why**\n${dataOut.rationale}` : ''
      ].join('\n').trim();

      bubble('bot', `<pre>${escapeHtml(text)}</pre>`);
      chips([
        { label:'Save & track (login)', value: {area,energy,time}, event:'open_login' },
        { label:'Give me another option', value: {area,energy,time}, event:'another' }
      ]);
      return done();
    }

    if (event === 'another') {
      // same as set_time but with "tweak" note
      const { area, energy, time } = data.value || {};
      send(res, { type:'typing', on:true });
      const resp = await fetch(process.env.NEXT_MOVE_URL, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ area, energy, time, tweak: 'another option' })
      });
      const d = await resp.json();
      send(res, { type:'typing', on:false });
      const text = [
        `**Another option**\n${d.next_move || '—'}`,
        d.message_draft ? `\n**Draft**\n${d.message_draft}` : '',
        d.rationale ? `\n**Why**\n${d.rationale}` : ''
      ].join('\n').trim();
      bubble('bot', `<pre>${escapeHtml(text)}</pre>`);
      chips([
        { label:'Save & track (login)', value:{area,energy,time}, event:'open_login' },
        { label:'Something else', value:{area,energy,time}, event:'another' }
      ]);
      return done();
    }

    if (event === 'open_login') {
      const { area, energy, time } = data.value || {};
      // TOOL: stream an instruction to the client to open Softr
      tool('open_login', { area, energy, time });
      return done();
    }

    // Unknown event → restart
    bubble('bot', `Let’s start again. Which part of life needs a nudge today?`);
    chips([
      { label:'Work', value:'Work', event:'set_area' },
      { label:'Health', value:'Health', event:'set_area' },
      { label:'Relationships', value:'Relationships', event:'set_area' }
    ]);
    return done();

  } catch (e) {
    bubble('bot', `I hit a snag. Refresh or try again in a moment.`);
    done();
  }

  function escapeHtml(s=''){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
};
