// js/record.js
// ============================================================================
// Stage 4 - microphone capture for follow-up notes.
//
// The Meta ASR file endpoint accepts RIFF/WAVE, mono signed 16-bit PCM at
// 16 or 24 kHz (docs/speech-to-text, read 2026-10-26). MediaRecorder gives us
// webm/mp4, so we decode that and RE-ENCODE: mixdown to mono, resample to
// 24 kHz, write a proper 44-byte WAV header + PCM16 frames.
//
// Privacy: recording starts only on a tap, stops by tap; the audio leaves the
// device ONLY to this app's own serverless function (never to anyone else),
// and the transcript lands in an editable field the owner checks themselves.
// ============================================================================

const SAMPLE_RATE = 24_000;

export function recordingSupported() {
  return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder && window.AudioContext);
}

function friendlyMicError(name) {
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "The microphone was not allowed. Allow it in the browser bar, then tap the mic again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "NotReadableError") {
    return "No usable microphone was found on this device. Plug one in or type the note.";
  }
  return "The mic did not work - type the note.";
}

class MicSession {
  constructor() {
    this.recorder = null;
    this.stream = null;
    this.chunks = [];
    this.active = false;
  }

  async start(timeoutMs = 15_000) {
    if (this.active) throw new Error("The mic is already recording.");
    await this.#shutdown();
    if (!recordingSupported()) {
      throw new Error("Recording is not available in this browser. Type the note instead.");
    }
    const acquire = navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((s) => ({ kind: "ok", s }))
      .catch((e) => ({ kind: "error", name: e?.name || "Error", message: e?.message || "" }));

    let timeoutId = 0;
    const gate = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
    }).then(() => ({ kind: "timeout" }));

    const winner = await Promise.race([acquire, gate]);
    clearTimeout(timeoutId);
    if (winner.kind === "timeout") {
      // the browser is stuck on a permission prompt - release it when it lands
      acquire.then((r) => {
        if (r.kind === "ok") for (const t of r.s.getTracks()) t.stop();
      });
      throw new Error(
        "The browser is waiting for permission to use the microphone. Allow it near the address bar, then tap the mic again.",
      );
    }
    if (winner.kind === "error") {
      throw new Error(friendlyMicError(winner.name));
    }
    this.stream = winner.s;
    this.chunks = [];
    const mime =
      ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find(
        (m) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(m),
      ) || "";
    this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(250); // gather chunks as we go
    this.active = true;
  }

  // Stops and returns { wavBase64 (data-URL prefix stripped), durationMs }.
  async stop({ discard = false } = {}) {
    if (!this.active || !this.recorder) return null;
    const recorder = this.recorder;
    const stopped = new Promise((resolve) => {
      recorder.onstop = resolve;
    });
    this.active = false;
    try {
      recorder.stop(); // flush the remaining data
      await stopped;
    } catch {}
    const chunks = this.chunks.slice();
    await this.#shutdown();

    if (discard) return null;
    if (!chunks.length) throw new Error("The microphone captured nothing - check the mic settings and try again.");
    const blob = new Blob(chunks, { type: chunks[0].type || "audio/webm" });
    return await encodeToWavBase64(await blob.arrayBuffer());
  }

  async #shutdown() {
    try {
      for (const track of this.stream?.getTracks?.() ?? []) track.stop();
    } catch {}
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.active = false;
  }
}

/* -------------------------------------------------------------- wav encode */
// Decode any browser audio blob (webm/mp4/ogg) and re-encode as WAV PCM16 mono.
export async function encodeToWavBase64(arrayBuffer) {
  const ac = new AudioContext();
  let audio;
  try {
    audio = await ac.decodeAudioData(arrayBuffer);
  } catch {
    throw new Error("This browser could not process the recording - type the note instead.");
  } finally {
    ac.close().catch(() => {});
  }
  const durationMs = Math.round(audio.duration * 1000);

  // one channel, target length at the ASR-friendly rate
  const frames = Math.max(1, Math.ceil(audio.duration * SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frames, SAMPLE_RATE);
  const src = offline.createBufferSource();
  src.buffer = audio;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  const samples = rendered.getChannelData(0);

  // Float32 -> Int16 with shaping
  const pcm = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] || 0));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const wav = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(wav);
  const ascii = (off, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(off + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  new Int16Array(wav, 44).set(pcm);

  const blob = new Blob([wav], { type: "audio/wav" });
  const dataUrl = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("Could not read back the recording."));
    fr.readAsDataURL(blob);
  });
  return { wavBase64: dataUrl.replace(/^data:[^;]+;base64,/, ""), durationMs };
}

export { MicSession };
