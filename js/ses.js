/* Hikâye Stüdyosu — ses: cihazda seslendirme (Piper), ton, yükseklik eşitleme, müzik ve miksaj. */

let AC = null, TTS = null, TTS_GEN = 0, KA = null;
export const ac = () => AC || (AC = new (window.AudioContext || window.webkitAudioContext)());
const nextTask = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });

async function loadTTS(fresh){
  if(fresh || !TTS){
    TTS_GEN++;
    try{ TTS = await import('https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/+esm' + (TTS_GEN > 1 ? '?y=' + TTS_GEN : '')); }
    catch(e){ TTS = null; throw Object.assign(new Error('Ses motoru yüklenemedi. İlk kullanımda internet gerekir; bağlantını kontrol edip yeniden dene.'), { fatal:true }); }
  }
  return TTS;
}
/* Ses motorunu zorlayan karakterleri temizler (tırnak, uzun tire, emoji vb.) */
export function cleanText(t){
  return t.replace(/[“”«»"]/g, '').replace(/[‘’`´]/g, "'").replace(/[—–]/g, ', ').replace(/…/g, '...')
    .replace(/[^\p{L}\p{N}\s.,!?;:'()-]/gu, ' ').replace(/\s+/g, ' ').trim();
}
export async function synth(text, voiceId, onProg){
  const tts = await loadTTS();
  const wav = await tts.predict({ text, voiceId }, p => { if(p && p.total && onProg) onProg(p.loaded/p.total); });
  return ac().decodeAudioData(await wav.arrayBuffer());
}
function joinBuffers(bs){
  const sr = bs[0].sampleRate, gap = Math.round(sr*.15);
  const out = ac().createBuffer(1, bs.reduce((n, b) => n + b.length + gap, 0), sr); let pos = 0;
  for(const b of bs){ out.getChannelData(0).set(b.getChannelData(0), pos); pos += b.length + gap; }
  return out;
}
/* Çökmeye dayanıklı seslendirme: yeniden dener, motoru tazeler, cümleyi böler; olmazsa kısa sessizlik koyar */
export async function synthRobust(text, voiceId, onProg){
  const t = cleanText(text) || '...';
  try{ return { buf: await synth(t, voiceId, onProg) }; }catch(e){ if(e.fatal) throw e; console.warn('1. deneme', e); }
  try{ await loadTTS(true); return { buf: await synth(t, voiceId, onProg) }; }catch(e){ if(e.fatal) throw e; console.warn('2. deneme', e); }
  const parts = t.split(/(?<=[,;:])\s+/).flatMap(p => p.length > 120 ? p.split(/\s+(?=ve |ama |fakat |çünkü |sonra )/) : [p]).filter(Boolean);
  if(parts.length > 1){
    try{ const bs = []; for(const p of parts){ await loadTTS(true); bs.push(await synth(p, voiceId, onProg)); } return { buf: joinBuffers(bs) }; }
    catch(e){ if(e.fatal) throw e; console.warn('3. deneme', e); }
  }
  return { buf: ac().createBuffer(1, Math.round(22050*.8), 22050), skipped:true };
}

/* Konuşma hızını bozmadan ses tonunu değiştirir (WSOLA + yeniden örnekleme) */
export async function pitchShift(buf, p){
  if(Math.abs(p - 1) < .01) return buf;
  const x = buf.getChannelData(0), sr = buf.sampleRate, N = 1024, Hs = 512, Ha = Hs/p, tol = 192;
  if(x.length < N*2) return buf;
  const outLen = Math.ceil(x.length*p) + N, y = new Float32Array(outLen), ws = new Float32Array(outLen), win = new Float32Array(N);
  for(let i = 0; i < N; i++) win[i] = .5 - .5*Math.cos(2*Math.PI*i/N);
  let prevPos = 0;
  for(let k = 0, outPos = 0; ; k++, outPos += Hs){
    const nominal = Math.round(k*Ha); if(nominal + N >= x.length || outPos + N >= outLen) break;
    let best = nominal;
    const nat = prevPos + Hs;
    if(k > 0 && nat + N/2 < x.length){
      let bc = -Infinity;
      for(let d = -tol; d <= tol; d += 4){
        const c0 = nominal + d; if(c0 < 0 || c0 + N >= x.length) continue;
        let c = 0; for(let j = 0; j < N/2; j += 4) c += x[c0 + j]*x[nat + j];
        if(c > bc){ bc = c; best = c0; }
      }
    }
    for(let j = 0; j < N; j++){ y[outPos + j] += x[best + j]*win[j]; ws[outPos + j] += win[j]; }
    prevPos = best;
    if(k % 1500 === 1499) await nextTask();
  }
  for(let i = 0; i < outLen; i++) if(ws[i] > 1e-3) y[i] /= ws[i];
  const tmp = new AudioBuffer({ length:outLen, sampleRate:sr, numberOfChannels:1 }); tmp.copyToChannel(y, 0);
  const off = new OfflineAudioContext(1, Math.ceil(x.length), sr);
  const s = off.createBufferSource(); s.buffer = tmp; s.playbackRate.value = p; s.connect(off.destination); s.start();
  return off.startRendering();
}
export async function resample(buf, sr){
  if(buf.sampleRate === sr) return buf;
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration*sr)), sr);
  const s = off.createBufferSource(); s.buffer = buf; s.connect(off.destination); s.start();
  return off.startRendering();
}
export function toMono(buf){
  if(buf.numberOfChannels === 1) return buf;
  const out = new AudioBuffer({ length:buf.length, sampleRate:buf.sampleRate, numberOfChannels:1 }), o = out.getChannelData(0);
  for(let c = 0; c < buf.numberOfChannels; c++){ const d = buf.getChannelData(c); for(let i = 0; i < d.length; i++) o[i] += d[i]/buf.numberOfChannels; }
  return out;
}

/* Kare başına ses şiddeti (0..1): ağız açıklığını ve sessizlikleri buradan okuruz */
export function envelope(buf, fps){
  const d = buf.getChannelData(0), sr = buf.sampleRate, n = Math.ceil(buf.duration*fps), win = Math.floor(sr/fps);
  const env = new Float32Array(n);
  for(let i = 0; i < n; i++){ let s = 0; const st = i*win; for(let j = 0; j < win; j++){ const v = d[st + j] || 0; s += v*v; } env[i] = Math.sqrt(s/win); }
  const sorted = Array.from(env).sort((a, b) => a - b), p = sorted[Math.floor(n*.95)] || 1;
  let prev = 0;
  for(let i = 0; i < n; i++){ let v = Math.min(1, env[i]/p); v = v < .12 ? 0 : (v - .12)/.88; v = prev*.35 + v*.65; prev = v; env[i] = v; }
  return env;
}

/* Algılanan yükseklik (LUFS, ITU-R BS.1770'e yakın): K ağırlıklı süzgeç + kapılı ortalama */
export async function loudness(buf){
  if(buf.length < buf.sampleRate*.5) return null;
  const sr = buf.sampleRate, c = new OfflineAudioContext(1, buf.length, sr);
  const s = c.createBufferSource(); s.buffer = buf;
  const sh = c.createBiquadFilter(); sh.type = 'highshelf'; sh.frequency.value = 1682; sh.gain.value = 4;
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38; hp.Q.value = -6;
  s.connect(sh); sh.connect(hp); hp.connect(c.destination); s.start();
  const d = (await c.startRendering()).getChannelData(0);
  const bl = Math.round(sr*.4), hop = Math.round(sr*.1), z = [];
  for(let a = 0; a + bl <= d.length; a += hop){ let e = 0; for(let i = a; i < a + bl; i++) e += d[i]*d[i]; z.push(e/bl); }
  const L = v => -0.691 + 10*Math.log10(v || 1e-12), mean = a => a.reduce((x, y) => x + y, 0)/a.length;
  const g1 = z.filter(v => L(v) > -70); if(!g1.length) return null;
  const rel = L(mean(g1)) - 10, g2 = g1.filter(v => L(v) > rel);
  return g2.length ? L(mean(g2)) : null;
}
/* Sesi hedef yüksekliğe getirir; tepe noktaları yumuşak sınırlayıcıyla ezilir (yerinde değiştirir) */
export async function normalize(buf, target = -16){
  const L = await loudness(buf); if(L == null || !isFinite(L)) return buf;
  const g = Math.min(8, Math.max(.2, Math.pow(10, (target - L)/20))), d = buf.getChannelData(0), K = .7, R = .29;
  for(let i = 0; i < d.length; i++){
    let v = d[i]*g; const a = v < 0 ? -v : v;
    if(a > K) v = (v < 0 ? -1 : 1)*(K + R*Math.tanh((a - K)/R));
    d[i] = v;
  }
  return buf;
}

/* Kendi içinde üretilen sade fon (müzik dosyası seçilmediyse) */
function addPad(c, D, mood, out){
  const prog = mood === 'uzgun' ? [[57,60,64],[53,57,60],[48,52,55],[55,59,62]] : [[48,52,55],[55,59,62],[57,60,64],[53,57,60]];
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.connect(out);
  const L = 4;
  for(let t = 0, i = 0; t < D; t += L, i++){
    for(const n of prog[i % 4]){
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = 440*Math.pow(2, (n - 69)/12);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.33, t + 1.2);
      g.gain.setValueAtTime(.33, t + L - .6); g.gain.linearRampToValueAtTime(0, t + L + .4);
      o.connect(g); g.connect(lp); o.start(t); o.stop(t + L + .5);
    }
  }
}
/* Son miksaj: anlatım + (isteğe bağlı) müzik. Anlatım sürerken müzik otomatik kısılır.
   o: { voice, lead, tail, music:{kind:'yok'|'pad'|'dosya', buf}, mood, speech:[{s,e}] } → 48 kHz mono */
export async function mixMaster(o){
  const sr = 48000, D = o.lead + o.voice.duration + o.tail;
  const c = new OfflineAudioContext(1, Math.ceil(D*sr), sr);
  const s = c.createBufferSource(); s.buffer = o.voice; s.connect(c.destination); s.start(o.lead);
  const kind = o.music ? o.music.kind : 'yok';
  if(kind !== 'yok'){
    const file = kind === 'dosya', base = file ? .30 : .05, duck = file ? .085 : .028;
    const bus = c.createGain(), fade = c.createGain(); bus.connect(fade); fade.connect(c.destination);
    fade.gain.setValueAtTime(0, 0); fade.gain.linearRampToValueAtTime(1, Math.min(.8, D/4));
    fade.gain.setValueAtTime(1, Math.max(1, D - 2.5)); fade.gain.linearRampToValueAtTime(0, D);
    bus.gain.setValueAtTime(base, 0);
    const spans = [];
    for(const g of o.speech){ const l = spans[spans.length - 1]; if(l && g.s - l.e < 1.2) l.e = Math.max(l.e, g.e); else spans.push({ s:g.s, e:g.e }); }
    for(const sp of spans){
      bus.gain.setTargetAtTime(duck, Math.max(0, o.lead + sp.s - .3), .12);
      bus.gain.setTargetAtTime(base, o.lead + sp.e + .15, .4);
    }
    if(file){ const m = c.createBufferSource(); m.buffer = o.music.buf; m.loop = true; m.connect(bus); m.start(0); }
    else addPad(c, D, o.mood, bus);
  }
  const out = await c.startRendering(), d = out.getChannelData(0);
  let pk = 0; for(let i = 0; i < d.length; i++){ const a = d[i] < 0 ? -d[i] : d[i]; if(a > pk) pk = a; }
  if(pk > .98){ const k = .98/pk; for(let i = 0; i < d.length; i++) d[i] *= k; }
  return out;
}

/* ================= ARKA PLANDA ÇALIŞMA ================= */
function toneWav(){
  const sr = 8000, n = sr*2, b = new ArrayBuffer(44 + n*2), v = new DataView(b);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n*2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr*2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n*2, true);
  for(let i = 0; i < n; i++) v.setInt16(44 + i*2, Math.sin(2*Math.PI*40*i/sr)*300, true);
  return new Blob([b], { type:'audio/wav' });
}
/* Duyulmayan bir ses döngüsü: tarayıcı sekmeyi arka planda uyutmaz */
export function keepAlive(on){
  try{
    if(on){ if(!KA){ KA = new Audio(URL.createObjectURL(toneWav())); KA.loop = true; } KA.play().catch(() => {}); }
    else if(KA) KA.pause();
  }catch(e){}
}
export function chime(){
  try{
    const a = ac(), t = a.currentTime;
    [880, 1320].forEach((f, k) => { const o = a.createOscillator(), g = a.createGain();
      o.frequency.value = f; g.gain.setValueAtTime(0, t + k*.18); g.gain.linearRampToValueAtTime(.25, t + k*.18 + .02);
      g.gain.exponentialRampToValueAtTime(.001, t + k*.18 + .5); o.connect(g); g.connect(a.destination); o.start(t + k*.18); o.stop(t + k*.18 + .55); });
    navigator.vibrate && navigator.vibrate([250, 120, 250]);
  }catch(e){}
}
