let mediaRecorder, audioChunks = [], isRecording = false, history = [];

const micBtn      = document.getElementById('micBtn');
const statusEl    = document.getElementById('status');
const transcriptEl= document.getElementById('transcript');
const replyEl     = document.getElementById('reply');
const clearBtn    = document.getElementById('clearBtn');

// ── Hold to record ─────────────────────────────────────────────────────────
micBtn.addEventListener('mousedown',  e => { e.preventDefault(); startRecording(); });
micBtn.addEventListener('touchstart', e => { e.preventDefault(); startRecording(); }, { passive: false });
document.addEventListener('mouseup',  stopRecording);
document.addEventListener('touchend', stopRecording);

clearBtn.addEventListener('click', () => {
  history = [];
  transcriptEl.textContent = replyEl.textContent = '';
  statusEl.textContent = 'History cleared';
  setTimeout(() => statusEl.textContent = 'Tap & hold the mic', 1200);
});

async function startRecording() {
  if (isRecording) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true }
    });

    // Pick best supported mime type
    const mime = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4']
      .find(t => MediaRecorder.isTypeSupported(t)) || '';

    mediaRecorder = mime
      ? new MediaRecorder(stream, { mimeType: mime })
      : new MediaRecorder(stream);

    audioChunks = [];
    isRecording = true;
    micBtn.classList.add('recording');
    statusEl.textContent = 'Listening…';

    mediaRecorder.ondataavailable = e => { if (e.data?.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop()); // close mic hardware
      sendAudio(mediaRecorder.mimeType || mime || 'audio/webm');
    };
    mediaRecorder.start(80);
  } catch (err) {
    statusEl.textContent = 'Microphone error: ' + err.message;
  }
}

function stopRecording() {
  if (!isRecording || !mediaRecorder) return;
  mediaRecorder.stop();
  isRecording = false;
  micBtn.classList.remove('recording');
  statusEl.textContent = 'Processing…';
}

async function sendAudio(mimeType) {
  const blob = new Blob(audioChunks, { type: mimeType });
  console.log(`Sending ${blob.size} bytes, mime=${mimeType}`);

  const reader = new FileReader();
  reader.onloadend = async () => {
    const base64 = reader.result.split(',')[1];
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: base64, mime: mimeType, history }),
      });

      const raw = await res.text();
      console.log('API response:', res.status, raw.slice(0, 200));

      let data;
      try { data = JSON.parse(raw); }
      catch { statusEl.textContent = 'Bad response from server'; return; }

      if (data.error) {
        statusEl.textContent = 'Error: ' + data.error;
        return;
      }
      if (data.noise || !data.reply) {
        const heard = data.transcript || '';
        statusEl.textContent = heard
          ? `Heard "${heard}" — too short, try again`
          : "Didn't catch that — hold and speak clearly";
        setTimeout(() => statusEl.textContent = 'Tap & hold the mic', 2500);
        return;
      }

      transcriptEl.textContent = 'You: ' + data.transcript;
      replyEl.textContent      = 'Yo: '  + data.reply;

      // Save to history for context
      history.push({ role: 'user',      content: data.transcript });
      history.push({ role: 'assistant', content: data.reply });
      if (history.length > 20) history = history.slice(-20);

      speak(data.reply);

    } catch (err) {
      statusEl.textContent = 'Connection error: ' + err.message;
    }
  };
  reader.readAsDataURL(blob);
}

// ── TTS — browser speechSynthesis (works everywhere, no API needed) ─────────
function speak(text) {
  if (!text) return;
  const synth = window.speechSynthesis;
  synth.cancel();

  statusEl.textContent = '🔊 Speaking…';

  function go() {
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate   = 1.0;
    utt.pitch  = 0.9;
    utt.volume = 1.0;

    const voices = synth.getVoices();
    const voice  = voices.find(v => v.lang.startsWith('en') && v.name.includes('Google'))
                || voices.find(v => v.lang.startsWith('en-'))
                || voices[0];
    if (voice) utt.voice = voice;

    utt.onend = utt.onerror = () => {
      statusEl.textContent = 'Tap & hold to speak again';
    };
    synth.speak(utt);
  }

  // Voices load async on some browsers
  if (synth.getVoices().length > 0) {
    go();
  } else {
    synth.addEventListener('voiceschanged', function once() {
      synth.removeEventListener('voiceschanged', once);
      go();
    });
  }
}

// ── Service worker (PWA) ───────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
