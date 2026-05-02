const Groq       = require('groq-sdk');
const { toFile } = require('groq-sdk');

const groq = new Groq({ apiKey: (process.env.GROQ_API_KEY || '').trim() });

// ── Weather via wttr.in ───────────────────────────────────────────────────────
async function getWeather(location) {
  try {
    const r = await fetch(
      `https://wttr.in/${encodeURIComponent(location)}?format=j1`,
      { headers: { 'User-Agent': 'Yo/1.0' } }
    );
    if (!r.ok) throw new Error(`wttr ${r.status}`);
    const d   = await r.json();
    const cur = d.current_condition?.[0];
    if (!cur) return null;
    const desc    = cur.weatherDesc?.[0]?.value || '';
    const tempC   = cur.temp_C;
    const tempF   = cur.temp_F;
    const feels   = cur.FeelsLikeC;
    const wind    = cur.windspeedKmph;
    const humidity= cur.humidity;
    const tom     = d.weather?.[1];
    const todayHi = d.weather?.[0]?.maxtempC;
    const todayLo = d.weather?.[0]?.mintempC;
    return `Current weather in ${location}: ${desc}, ${tempC}C (${tempF}F), feels like ${feels}C, wind ${wind}km/h, humidity ${humidity}%. Today: high ${todayHi}C low ${todayLo}C. Tomorrow: high ${tom?.maxtempC}C low ${tom?.mintempC}C.`;
  } catch (e) {
    console.error('Weather error:', e.message);
    return null;
  }
}

// ── Sports via ESPN public API ────────────────────────────────────────────────
async function getSports(query) {
  const q = query.toLowerCase();
  let league = 'basketball/nba';
  if      (/nfl|american football/.test(q))        league = 'football/nfl';
  else if (/nhl|hockey/.test(q))                   league = 'hockey/nhl';
  else if (/mlb|baseball/.test(q))                 league = 'baseball/mlb';
  else if (/epl|premier league|english/.test(q))   league = 'soccer/eng.1';
  else if (/mls/.test(q))                          league = 'soccer/usa.1';
  else if (/champions league|ucl/.test(q))         league = 'soccer/uefa.champions';
  else if (/nba|basketball/.test(q))               league = 'basketball/nba';

  try {
    const r = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/${league}/scoreboard`,
      { headers: { 'User-Agent': 'Yo/1.0' } }
    );
    if (!r.ok) throw new Error(`ESPN ${r.status}`);
    const d      = await r.json();
    const events = (d.events || []).slice(0, 8);
    if (!events.length) return `No ${league} games found right now.`;

    const lines = events.map(ev => {
      const comp  = ev.competitions?.[0];
      const teams = comp?.competitors || [];
      const home  = teams.find(t => t.homeAway === 'home');
      const away  = teams.find(t => t.homeAway === 'away');
      const done  = comp?.status?.type?.completed;
      const state = comp?.status?.type?.description || '';
      const period= comp?.status?.period || '';
      const clock = comp?.status?.displayClock || '';
      if (!home || !away) return null;
      if (done) {
        return `${away.team.displayName} ${away.score} - ${home.score} ${home.team.displayName} (Final)`;
      }
      if (state === 'In Progress') {
        return `${away.team.displayName} ${away.score} - ${home.score} ${home.team.displayName} (Live - ${clock} P${period})`;
      }
      return `${away.team.displayName} vs ${home.team.displayName} (${state})`;
    }).filter(Boolean);

    return lines.join('\n');
  } catch (e) {
    console.error('ESPN error:', e.message);
    return null;
  }
}

// ── News via GNews API (free, 100/day, no card) ───────────────────────────────
// Sign up free at https://gnews.io — add GNEWS_API_KEY to Vercel env vars
async function getNews(query) {
  const key = process.env.GNEWS_API_KEY;
  if (!key) {
    console.warn('No GNEWS_API_KEY — falling back to RSS');
    return getNewsRSS(query);
  }
  try {
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&max=5&apikey=${key}`;
    const r   = await fetch(url, { headers: { 'User-Agent': 'Yo/1.0' } });
    if (!r.ok) throw new Error(`GNews ${r.status}`);
    const d   = await r.json();
    const articles = (d.articles || []).slice(0, 5);
    if (!articles.length) return null;
    return articles.map(a => `${a.title}: ${a.description || ''}`).join('\n');
  } catch (e) {
    console.error('GNews error:', e.message);
    return getNewsRSS(query);
  }
}

// ── News fallback: BBC RSS (no key needed) ────────────────────────────────────
async function getNewsRSS(query) {
  try {
    // Use BBC RSS which is public
    const r = await fetch(
      'https://feeds.bbci.co.uk/news/rss.xml',
      { headers: { 'User-Agent': 'Yo/1.0' } }
    );
    if (!r.ok) throw new Error(`BBC RSS ${r.status}`);
    const xml = await r.text();

    // Parse titles and descriptions from RSS
    const items = [];
    const itemRe = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = itemRe.exec(xml)) !== null && items.length < 6) {
      const titleM = /<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(m[1])
                  || /<title>(.*?)<\/title>/.exec(m[1]);
      const descM  = /<description><!\[CDATA\[(.*?)\]\]><\/description>/.exec(m[1])
                  || /<description>(.*?)<\/description>/.exec(m[1]);
      if (titleM) items.push(`${titleM[1]}${descM ? ': ' + descM[1].replace(/<[^>]+>/g,'').trim() : ''}`);
    }

    if (!items.length) return null;

    // If a specific query, filter relevant items
    if (query && query.toLowerCase() !== 'news') {
      const qWords = query.toLowerCase().split(' ').filter(w => w.length > 3);
      const filtered = items.filter(i => qWords.some(w => i.toLowerCase().includes(w)));
      if (filtered.length) return filtered.join('\n');
    }

    return items.join('\n');
  } catch (e) {
    console.error('RSS error:', e.message);
    return null;
  }
}

// ── Route to the right data source ───────────────────────────────────────────
async function getContext(transcript) {
  const q = transcript.toLowerCase();

  const isWeather = /weather|temperature|forecast|rain|snow|sunny|cloudy|hot|cold|degrees|humid|wind|outside/.test(q);
  const isSports  = /score|scores|game|games|match|nfl|nba|nhl|mlb|epl|mls|soccer|football|basketball|hockey|baseball|premier league|champions league|who won|who is winning|result|standings/.test(q);
  const isNews    = /news|happening|today|latest|current|recent|right now|update|headlines|world|politics|breaking/.test(q);

  if (isWeather) {
    const loc = transcript
      .replace(/what(?:'s| is)(?: the)?|weather|forecast|temperature|right now|today|tomorrow|outside|like|currently|in|for|at/gi, ' ')
      .replace(/\s+/g, ' ').trim() || 'New York';
    console.log(`[weather] "${loc}"`);
    const w = await getWeather(loc);
    if (w) return `LIVE WEATHER DATA:\n${w}`;
  }

  if (isSports) {
    console.log(`[sports] "${transcript}"`);
    const s = await getSports(transcript);
    if (s) return `LIVE SPORTS SCORES:\n${s}`;
  }

  if (isNews) {
    const topic = transcript
      .replace(/news|what(?:'s| is)(?: the)?|latest|happening|today|right now|tell me|about/gi, ' ')
      .replace(/\s+/g, ' ').trim() || 'news';
    console.log(`[news] "${topic}"`);
    const n = await getNews(topic);
    if (n) return `CURRENT NEWS:\n${n}`;
  }

  return null;
}

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM = `You are Yo — a sharp, no-nonsense voice assistant. You are direct, confident, and a little sarcastic, but always genuinely helpful. You do not swear at all.

PERSONALITY:
- Direct and honest. No fluff, no padding, no fake enthusiasm.
- Dry wit and light sarcasm are fine, but keep it friendly.
- Give real, useful answers — not vague waffle.
- If a question is dumb, you can say so, but still answer it.
- SHORT. 1 to 3 spoken sentences only. You are not writing an essay.
- Zero markdown. No bullet points, asterisks, or headers. Plain spoken words only.

WHEN YOU HAVE LIVE DATA:
- The message may include real-time data under headers like LIVE WEATHER DATA or LIVE SPORTS SCORES.
- Use that data to give a concrete, specific answer.
- Weather: be vivid and specific. "It is minus 3 and snowing in Edmonton, so dress warm."
- Sports: give the actual score with a comment. "The Oilers lost 4 to 2 last night, rough game."
- News: summarise the key point clearly and give your take in one sentence.
- Never say "based on the data provided" — just answer naturally as if you already knew it.`;

// ── Handler ───────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { audio, mime, history = [] } = req.body || {};
  if (!audio) return res.status(400).json({ error: 'No audio provided' });

  // ── Transcribe ─────────────────────────────────────────────────────────────
  const buf = Buffer.from(audio, 'base64');
  console.log(`Audio: ${buf.length} bytes  mime: ${mime}`);

  if (buf.length < 600) {
    return res.status(200).json({ transcript: '', reply: '', noise: true });
  }

  let transcript = '';
  try {
    const ext  = (mime || '').includes('mp4') ? 'mp4'
               : (mime || '').includes('ogg') ? 'ogg' : 'webm';
    const file = await toFile(buf, `audio.${ext}`, { type: mime || 'audio/webm' });
    const stt  = await groq.audio.transcriptions.create({
      file, model: 'whisper-large-v3-turbo', response_format: 'json', language: 'en',
    });
    transcript = (stt.text || '').trim();
    console.log(`Transcript: "${transcript}"`);
  } catch (e) {
    console.error('STT error:', e.message);
    return res.status(502).json({ error: 'STT failed: ' + e.message });
  }

  // ── Noise filter ───────────────────────────────────────────────────────────
  const NOISE = new Set([
    '','you','thanks','thank you','the','um','uh','hmm','hm','oh',
    'okay','ok','hi','hello','bye','yeah','yep','nope','right',
    'thanks.','okay.','you.','oh.','yeah.','right.','bye.','hmm.'
  ]);
  const clean = transcript.toLowerCase().replace(/[.,!?]+$/, '').trim();
  if (!clean || clean.length < 2 || NOISE.has(clean)) {
    return res.status(200).json({ transcript, reply: '', noise: true });
  }

  // ── Fetch real-time context ────────────────────────────────────────────────
  const context = await getContext(transcript);
  const userMessage = context ? `${transcript}\n\n[${context}]` : transcript;
  if (context) console.log(`Context fetched: ${context.slice(0, 150)}`);

  // ── Chat ───────────────────────────────────────────────────────────────────
  let reply = '';
  try {
    const chat = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM },
        ...history.slice(-10),
        { role: 'user', content: userMessage },
      ],
      max_tokens:  200,
      temperature: 0.8,
    });
    reply = (chat.choices?.[0]?.message?.content || '').trim();
    console.log(`Reply: "${reply}"`);
  } catch (e) {
    console.error('Chat error:', e.message);
    return res.status(502).json({ error: 'Chat failed: ' + e.message });
  }

  return res.status(200).json({ transcript, reply });
};
