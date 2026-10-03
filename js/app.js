/* Hikâye Stüdyosu — uygulama: durum, arayüz, çizim, yönetmen, video üretimi, projeler.
   Akış tek yönlüdür: senaryo → proje modeli → ses → zaman çizelgesi → yönetmen → çizim → kodlama. */
import { parseScript, direct, setLineTags, key, MOODS, MOOD_TR, SHOTS, SHOT_TR } from './senaryo.js';
import { FPS, buildTimeline, alignToRecording, pagesOf, toSRT, chaptersText } from './zaman.js';
import { ac, synth, synthRobust, cleanText, pitchShift, resample, toMono, envelope, normalize, mixMaster, keepAlive, chime } from './ses.js';

const $ = s => document.querySelector(s);
const cv = $('#cv'), ctx = cv.getContext('2d');
let W = 1280, H = 720, running = false, AUD = null, FL = null, mark = null, DOC = null, LAST = null, MUS = null, PROJ = null;
let CID = 0, BID = 0, lastUrl = null;
/* S: projenin o anki hâli. chars[0] anlatıcıdır (konuşanı belirtilmeyen satırlar ona gider). */
const S = { chars:[], active:null, bgs:[], media:[], layout:'karakter', audioFile:null, musicFile:null, logoFile:null, logo:null };

const say = t => $('#durum').textContent = t;
const bar = f => $('#bar').style.width = (Math.max(0, Math.min(1, f))*100).toFixed(1) + '%';
const lerp = (a, b, k) => a + (b - a)*k;
const ease = k => k < 0 ? 0 : k > 1 ? 1 : k*k*(3 - 2*k);
const nextTask = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fileSig = f => f ? (f.name || '') + '|' + f.size : '';

/* ================= KALICI DEPO (IndexedDB + cihaz dosya alanı) ================= */
const DB = (() => {
  let op;
  const open = () => op || (op = new Promise((res, rej) => {
    const r = indexedDB.open('hikaye-studyosu', 2);
    r.onupgradeneeded = e => {
      const d = r.result;
      ['jobs', 'voice', 'parts', 'voiceIdx', 'projects'].forEach(n => { if(!d.objectStoreNames.contains(n)) d.createObjectStore(n); });
      if(e.oldVersion === 1) ['jobs', 'voice', 'parts'].forEach(n => r.transaction.objectStore(n).clear());   // eski sürümün kayıt biçimi farklıydı
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const tx = async (store, mode, fn) => { const d = await open(); return new Promise((res, rej) => {
    const t = d.transaction(store, mode), req = fn(t.objectStore(store));
    t.oncomplete = () => res(req ? req.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
  return { get:(s, k) => tx(s, 'readonly', st => st.get(k)), put:(s, k, v) => tx(s, 'readwrite', st => st.put(v, k)),
           del:(s, k) => tx(s, 'readwrite', st => st.delete(k)),
           delPrefix:(s, pre) => tx(s, 'readwrite', st => st.delete(IDBKeyRange.bound(pre, pre + '\uffff'))),
           all: async s => { const d = await open(); return new Promise((res, rej) => {
             const t = d.transaction(s, 'readonly'), st = t.objectStore(s), ks = st.getAllKeys(), vs = st.getAll();
             t.oncomplete = () => res(ks.result.map((k, i) => ({ k, v:vs.result[i] }))); t.onerror = () => rej(t.error); }); } };
})();
const opfs = async () => (navigator.storage && navigator.storage.getDirectory) ? navigator.storage.getDirectory() : null;
async function opfsFile(name){ try{ const r = await opfs(); return r ? await (await r.getFileHandle(name)).getFile() : null; }catch(e){ return null; } }
async function opfsClean(keep){
  try{ const r = await opfs(); if(!r) return;
    for await (const [name] of r.entries()) if(/^is\d+\.mp4$/.test(name) && name !== keep) await r.removeEntry(name).catch(() => {});
  }catch(e){}
}
/* Ses önbelleği kalıcıdır: bir cümle değişince yalnızca o cümle yeniden seslendirilir. Sınırı aşınca en eskiler silinir. */
async function pruneVoice(limit = 150e6){
  try{
    const idx = (await DB.all('voiceIdx')).sort((a, b) => b.v.t - a.v.t); let sum = 0;
    for(const it of idx){ sum += it.v.n; if(sum > limit){ await DB.del('voice', it.k); await DB.del('voiceIdx', it.k); } }
  }catch(e){}
}

/* ================= GÖRSELLER ================= */
/* Resmi yükler ve gerekirse küçültür; sonuç bir canvas'tır (geçici adres hemen bırakılır, bellek sızmaz). */
async function loadImg(file, max = 2048){
  const url = URL.createObjectURL(file);
  try{
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Resim açılamadı: ' + (file.name || ''))); i.src = url; });
    const lim = typeof max === 'function' ? max(im.width, im.height) : max, k = Math.min(1, lim/Math.max(im.width, im.height));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.width*k)); c.height = Math.max(1, Math.round(im.height*k));
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return c;
  } finally { URL.revokeObjectURL(url); }
}
const charMax = (w, h) => w > h*1.2 ? 2048 : 1600;
function thumb(src, sw, sh){
  const c = document.createElement('canvas'); c.width = c.height = 144;
  const k = Math.max(144/sw, 144/sh); c.getContext('2d').drawImage(src, (144 - sw*k)/2, (144 - sh*k)/2, sw*k, sh*k);
  return c;
}
function avgColor(img){
  const c = document.createElement('canvas'); c.width = c.height = 8; const g = c.getContext('2d');
  g.drawImage(img, 0, 0, 8, 8); const d = g.getImageData(0, 0, 8, 8).data; let r = 0, gg = 0, b = 0, n = 0;
  for(let i = 0; i < d.length; i += 4){ if(d[i + 3] < 128) continue; r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
  return n ? [r/n, gg/n, b/n] : [128, 128, 128];
}
const mixRgb = (css, rgb, k) => { const m = css.match(/\d+/g); if(!m || m.length < 3) return css;
  return `rgb(${(m[0]*(1 - k) + rgb[0]*k) | 0},${(m[1]*(1 - k) + rgb[1]*k) | 0},${(m[2]*(1 - k) + rgb[2]*k) | 0})`; };
/* Liste kutusu (sahneler, görüntüler): numaralı küçük resimler + kaldır düğmesi */
function renderList(sel, items, onRemove){
  const box = $(sel); box.innerHTML = '';
  items.forEach((m, i) => {
    const d = document.createElement('div'); d.className = 'medya';
    let v;
    if(m.kind === 'video'){ v = document.createElement('video'); v.src = m.url; v.muted = true; v.playsInline = true; v.preload = 'metadata'; }
    else v = thumb(m.el || m.img, (m.el || m.img).width, (m.el || m.img).height);
    const b = document.createElement('b'); b.textContent = (i + 1) + (m.kind === 'video' ? ' ▶' : '');
    const x = document.createElement('button'); x.textContent = '×'; x.setAttribute('aria-label', (i + 1) + '. öğeyi kaldır');
    x.onclick = () => onRemove(i);
    d.title = m.name || ''; d.append(v, b, x); box.appendChild(d);
  });
}
/* Senaryodaki "2" ya da "koridor.jpg" gibi bir başvuruyu listedeki sıraya çevirir */
function findRef(list, ref){
  if(ref == null || ref === '') return -1;
  const r = String(ref).trim();
  if(/^\d+$/.test(r)){ const i = +r - 1; return i >= 0 && i < list.length ? i : -1; }
  const base = s => key(s).replace(/\.[a-z0-9]+$/, '');
  return list.findIndex(x => key(x.name) === key(r) || base(x.name) === base(r));
}

/* ================= KARAKTERLER ================= */
function newChar(name){
  const c = { id:'k' + (++CID), name, gender:'Kadın', age:30, voice:'auto', tonAuto:true, ton:1, file:null, img:null,
              pts:{ mouth:null, eyeL:null, eyeR:null }, crop:null, scale:1, off:0, mw:.09, es:.045,
              skin:'rgb(232,183,150)', lip:'rgb(168,90,85)', comp:new Map(), badge:['Karakter seçilmedi', ''] };
  S.chars.push(c); return c;
}
const act = () => S.chars.find(c => c.id === S.active) || S.chars[0];
const charOfLine = g => (g && g.speaker && S.chars.find(c => key(c.name) === g.speaker)) || S.chars[0];
function autoPitch(c){
  const a = c.age;
  if(c.gender === 'Kadın') return a < 20 ? 1.42 : a < 35 ? 1.36 : a < 50 ? 1.32 : 1.27;
  return a < 20 ? 1.12 : a < 35 ? 1.04 : a < 50 ? 1.0 : 0.94;
}
const pitchOf = c => c.tonAuto ? autoPitch(c) : +c.ton;
function voiceIdOf(c){
  if(c.voice !== 'auto') return c.voice;
  if(c.gender === 'Kadın') return 'tr_TR-dfki-medium';
  return c.age >= 50 ? 'tr_TR-fettah-medium' : 'tr_TR-fahrettin-medium';
}
const SAVED = ['pts', 'crop', 'scale', 'off', 'mw', 'es', 'gender', 'age', 'voice', 'tonAuto', 'ton'];
/* Yüz ayarları dosya adı + boyutuyla saklanır: aynı adlı farklı resimler birbirini ezmez */
function saveChar(c){
  if(!c.file) return;
  try{ const o = {}; SAVED.forEach(k => o[k] = c[k]); localStorage.setItem('hs2_' + fileSig(c.file), JSON.stringify(o)); }catch(e){}
}
function loadSaved(c){
  try{ const d = JSON.parse(localStorage.getItem('hs2_' + fileSig(c.file)) || 'null'); if(!d) return false;
    SAVED.forEach(k => { if(d[k] !== undefined) c[k] = d[k]; }); return true; }catch(e){ return false; }
}
function renderChars(){
  const box = $('#karList'); box.innerHTML = '';
  for(const c of S.chars){
    const b = document.createElement('button'); b.textContent = c.name + (c.img ? '' : ' ○');
    if(c.id === act().id) b.className = 'on';
    b.onclick = () => { S.active = c.id; renderChars(); };
    box.appendChild(b);
  }
  const add = document.createElement('button'); add.textContent = '+ Karakter';
  add.onclick = () => { let n = S.chars.length + 1; while(S.chars.some(x => key(x.name) === key('Karakter ' + n))) n++;
    S.active = newChar('Karakter ' + n).id; renderChars(); refreshDoc(true); };
  box.appendChild(add);
  const c = act();
  $('#kAd').value = c.name; $('#cinsiyet').value = c.gender; $('#yas').value = c.age; $('#yasYaz').textContent = c.age;
  $('#ses').value = c.voice; $('#tonAuto').checked = c.tonAuto; $('#rTon').disabled = c.tonAuto;
  $('#rTon').value = pitchOf(c); $('#tonYaz').textContent = pitchOf(c).toFixed(2);
  $('#rScale').value = c.scale; $('#rOff').value = c.off; $('#rMw').value = c.mw; $('#rEs').value = c.es;
  const bd = $('#yuzDurum'); bd.textContent = c.badge[0]; bd.className = 'badge ' + c.badge[1];
  $('#kSil').disabled = S.chars.length < 2;
  still();
}
async function detectFace(c){
  try{
    if(!FL){
      const V = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs');
      const fs = await V.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
      FL = await V.FaceLandmarker.createFromOptions(fs, {
        baseOptions:{ modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task' },
        runningMode:'IMAGE', numFaces:1 });
    }
    const img = c.img, k = document.createElement('canvas'); k.width = img.width; k.height = img.height;
    const g = k.getContext('2d'); g.fillStyle = '#b8b8b8'; g.fillRect(0, 0, k.width, k.height); g.drawImage(img, 0, 0);
    const res = FL.detect(k), L = res.faceLandmarks && res.faceLandmarks[0];
    if(!L) return false;
    const avg = ids => ({ x: ids.reduce((s, i) => s + L[i].x, 0)/ids.length, y: ids.reduce((s, i) => s + L[i].y, 0)/ids.length });
    c.pts = { mouth:avg([13, 14]), eyeL:avg([33, 133, 159, 145]), eyeR:avg([362, 263, 386, 374]) };
    c.mw = Math.abs(L[61].x - L[291].x)*.85;
    c.es = Math.max(Math.abs(L[33].x - L[133].x), Math.abs(L[362].x - L[263].x))*.62;
    return true;
  }catch(err){ console.warn(err); return false; }
}
/* Boydan çizilmiş karakter için belden yukarı kadraj (resim kırpılmaz, yalnızca görünen bölge saklanır) */
function autoFrame(c){
  const iw = c.img.width, ih = c.img.height, p = c.pts; c.crop = null;
  if(!p.eyeL || !p.eyeR || !p.mouth) return;
  const fx = (p.eyeL.x + p.eyeR.x)/2*iw, fy = ((p.eyeL.y + p.eyeR.y)/2*.6 + p.mouth.y*.4)*ih;
  const ed = Math.hypot((p.eyeR.x - p.eyeL.x)*iw, (p.eyeR.y - p.eyeL.y)*ih); if(ed < 4) return;
  const top = Math.max(0, fy - ed*3.2), bot = Math.min(ih, fy + ed*7.5);
  if(bot - top > ih*.85) return;                       // zaten yakın plan
  const cw = Math.min(iw, (bot - top)*.9), left = Math.max(0, Math.min(iw - cw, fx - cw/2));
  c.crop = { x:left, y:top, w:cw, h:bot - top };
}
function sampleSkin(c){
  const { eyeL, mouth } = c.pts; if(!c.img || !eyeL || !mouth) return;
  try{
    const iw = c.img.width, ih = c.img.height, g = c.img.getContext('2d');
    const x = Math.round(eyeL.x*iw), y = Math.round((eyeL.y + (mouth.y - eyeL.y)*.5)*ih);
    const d = g.getImageData(Math.max(0, x - 3), Math.max(0, y - 3), 7, 7).data; let R = 0, G = 0, B = 0, n = 0;
    for(let i = 0; i < d.length; i += 4){ if(d[i + 3] < 200) continue; R += d[i]; G += d[i + 1]; B += d[i + 2]; n++; }
    if(!n) return; R /= n; G /= n; B /= n;
    c.skin = `rgb(${R | 0},${G | 0},${B | 0})`; c.lip = `rgb(${(R*.72) | 0},${(G*.5) | 0},${(B*.5) | 0})`;
    c.comp.clear();
  }catch(e){}
}
async function assignImage(c, file){
  c.file = file; c.img = await loadImg(file, charMax);
  c.pts = { mouth:null, eyeL:null, eyeR:null }; c.crop = null; c.comp.clear();
  // İlk karakter resmi yataysa "tek resim" düzenine, dikey/şeffafsa ayrı düzene geç
  if(S.chars.filter(x => x.img).length === 1){
    if(c.img.width > c.img.height*1.2) setLayout('birlesik'); else if(S.layout === 'birlesik') setLayout('karakter');
  }
  if(loadSaved(c) && c.pts.mouth) c.badge = ['Yüz hazır (kayıtlı ayarlar)', 'ok'];
  else {
    c.badge = ['Yüz aranıyor...', '']; renderChars();
    if(await detectFace(c)){ autoFrame(c); c.badge = ['Yüz otomatik bulundu', 'ok']; }
    else { c.badge = ['Yüz bulunamadı, elle işaretle', 'warn']; if(c === act()) $('#elle').open = true; }
  }
  sampleSkin(c); saveChar(c);
}
$('#fChar').onchange = async e => {
  const files = [...e.target.files]; if(!files.length) return;
  const base = f => key((f.name || '').replace(/\.[^.]+$/, ''));
  let free = act();
  for(const f of files){
    let c = S.chars.find(x => base(f) === key(x.name)) || (files.length > 1 ? S.chars.find(x => !x.img && base(f).startsWith(key(x.name))) : null);
    if(!c){ if(free){ c = free; free = null; } else c = newChar((f.name || 'Karakter').replace(/\.[^.]+$/, '')); }
    else if(c === free) free = null;
    try{ await assignImage(c, f); }catch(err){ say(err.message || String(err)); }
  }
  e.target.value = ''; renderChars(); refreshDoc(true);
};
$('#kAd').onchange = e => {
  const c = act(), v = e.target.value.trim();
  if(v && !S.chars.some(x => x !== c && key(x.name) === key(v))) c.name = v; else if(v) say('Bu adda bir karakter zaten var.');
  renderChars(); refreshDoc(true);
};
$('#kSil').onclick = () => {
  if(S.chars.length < 2 || !confirm(`"${act().name}" silinsin mi?`)) return;
  S.chars = S.chars.filter(c => c !== act()); S.active = S.chars[0].id; renderChars(); refreshDoc(true);
};
$('#cinsiyet').onchange = e => { const c = act(); c.gender = e.target.value; saveChar(c); renderChars(); };
$('#yas').oninput = e => { const c = act(); c.age = +e.target.value; $('#yasYaz').textContent = c.age; saveChar(c);
  $('#rTon').value = pitchOf(c); $('#tonYaz').textContent = pitchOf(c).toFixed(2); };
$('#ses').onchange = e => { const c = act(); c.voice = e.target.value; saveChar(c); };
$('#tonAuto').onchange = e => { const c = act(); c.tonAuto = e.target.checked; if(!c.tonAuto) c.ton = autoPitch(c); saveChar(c); renderChars(); };
$('#rTon').oninput = e => { const c = act(); c.ton = +e.target.value; $('#tonYaz').textContent = c.ton.toFixed(2); saveChar(c); };
for(const [id, k] of [['rScale', 'scale'], ['rOff', 'off'], ['rMw', 'mw'], ['rEs', 'es']]){
  $('#' + id).oninput = e => { const c = act(); c[k] = +e.target.value; saveChar(c); still(); };
}
$('#btnDinle').onclick = async () => {
  const b = $('#btnDinle'), c = act(); b.disabled = true;
  try{
    const mine = DOC && DOC.lines.find(g => charOfLine(g) === c);
    const text = (mine && mine.text) || 'Merhaba, size başımdan geçen bir olayı anlatmak istiyorum.';
    say('Deneme sesi hazırlanıyor...');
    let buf = await synth(cleanText(text), voiceIdOf(c), f => say(`Ses modeli indiriliyor (yalnızca ilk sefer): %${Math.round(f*100)}`));
    buf = await pitchShift(buf, pitchOf(c));
    const a = ac(); await a.resume(); const s = a.createBufferSource(); s.buffer = buf; s.connect(a.destination); s.start();
    say('Çalıyor: ' + c.name + ' (' + voiceIdOf(c).replace(/^tr_TR-|-medium$/g, '') + ')');
  }catch(e){ say('Ses çalınamadı: ' + (e.message || e)); }
  b.disabled = false;
};

/* ================= SAHNELER, GÖRÜNTÜLER, LOGO, MÜZİK ================= */
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'tr', { numeric:true });
async function setBgs(files){
  S.bgs = []; S.chars.forEach(c => c.comp.clear());
  for(const f of [...files].sort(byName)){
    try{
      const img = await loadImg(f, 2048), k = Math.min(1, 1600/img.width), blur = document.createElement('canvas');
      blur.width = Math.round(img.width*k); blur.height = Math.round(img.height*k);
      const g = blur.getContext('2d'); g.filter = 'blur(' + Math.max(1.5, blur.width/700) + 'px)';   // arka planda hafif odak dışı
      g.drawImage(img, -6, -6, blur.width + 12, blur.height + 12);
      S.bgs.push({ id:'b' + (++BID), name:f.name || '', file:f, img, blur, amb:avgColor(img) });
    }catch(e){ say(e.message || String(e)); }
  }
  renderList('#bgListe', S.bgs, i => { S.bgs.splice(i, 1); setBgsDone(); });
}
function setBgsDone(){ renderList('#bgListe', S.bgs, i => { S.bgs.splice(i, 1); setBgsDone(); }); refreshDoc(true); still(); }
$('#fBg').onchange = async e => { if(!e.target.files.length) return; await setBgs(e.target.files); e.target.value = ''; setBgsDone(); };

const blurC = document.createElement('canvas'); blurC.width = 48; blurC.height = 27;
const blurX = blurC.getContext('2d');
async function loadMedia(file){
  if((file.type || '').startsWith('video') || /\.(mp4|webm|mov|3gp|mkv)$/i.test(file.name || '')){
    const url = URL.createObjectURL(file), el = document.createElement('video');
    el.muted = true; el.playsInline = true; el.preload = 'auto'; el.loop = false; el.src = url;
    await new Promise((res, rej) => { el.onloadeddata = res; el.onerror = () => rej(new Error('Video açılamadı: ' + file.name)); });
    return { kind:'video', el, url, file, name:file.name || '', w:el.videoWidth, h:el.videoHeight, dur:el.duration || 1 };
  }
  const el = await loadImg(file, 2048);
  return { kind:'image', el, file, name:file.name || '', w:el.width, h:el.height, dur:0 };
}
function dropMedia(){ S.media.forEach(m => { if(m.url){ try{ m.el.removeAttribute('src'); m.el.load(); URL.revokeObjectURL(m.url); }catch(e){} } }); S.media = []; }
async function setMediaFiles(files){
  dropMedia();
  for(const f of [...files].sort(byName)){ try{ S.media.push(await loadMedia(f)); }catch(e){ say(e.message || String(e)); } }
  mediaDone();
}
function mediaDone(){
  renderList('#medyaListe', S.media, i => { const m = S.media.splice(i, 1)[0]; if(m.url) URL.revokeObjectURL(m.url); mediaDone(); });
  refreshDoc(true); still();
}
$('#fMedya').onchange = async e => {
  const fs = e.target.files; if(!fs || !fs.length) return;
  say('Görüntüler yükleniyor...');
  await setMediaFiles(fs); e.target.value = '';
  if(S.media.length && S.layout === 'karakter') setLayout('ekran');
  say(`${S.media.length} görüntü eklendi.`);
};
function setLayout(v){ S.layout = v; $('#duzen').value = v; still(); }
$('#duzen').onchange = e => setLayout(e.target.value);
$('#fAudio').onchange = e => { S.audioFile = e.target.files[0] || null; };
$('#fMuzik').onchange = e => { S.musicFile = e.target.files[0] || null; };
$('#muzik').onchange = e => $('#muzikBox').classList.toggle('gizli', e.target.value !== 'dosya');
$('#kaynak').onchange = e => $('#fileBox').classList.toggle('gizli', e.target.value !== 'dosya');
async function setLogo(file){ S.logoFile = file || null; S.logo = file ? await loadImg(file, 512) : null; still(); }
$('#fLogo').onchange = e => setLogo(e.target.files[0]).catch(err => say(err.message || String(err)));

/* ================= SENARYO: ÇÖZÜMLEME, KARTLAR, UYARILAR ================= */
function parseDoc(){ const d = parseScript($('#metin').value, S.chars.map(c => c.name)); direct(d.lines); return d; }
let docTimer = null;
function refreshDoc(now){
  clearTimeout(docTimer);
  const run = () => {
    DOC = parseDoc();
    // senaryodaki @Ad tanımları karakter listesine işlenir (senaryoda yazan bilgi önceliklidir)
    let changed = false;
    for(const d of DOC.chars){
      let c = S.chars.find(x => key(x.name) === key(d.name));
      if(!c){ c = newChar(d.name); changed = true; }
      for(const k of ['gender', 'age', 'voice']) if(d[k] != null && c[k] !== d[k]){ c[k] = d[k]; changed = true; }
    }
    if(changed){ DOC = parseDoc(); renderChars(); }
    $('#kartSay').textContent = DOC.lines.length;
    if($('#kartlar').open) renderCards();
    showWarnings();
  };
  if(now) run(); else docTimer = setTimeout(run, 500);
}
function showWarnings(){
  const w = new Set(DOC.warnings), anyImg = S.chars.some(c => c.img);
  for(const g of DOC.lines){
    const c = charOfLine(g);
    if(anyImg && !c.img && S.layout !== 'sadece') w.add(`"${c.name}" için görsel seçilmedi; onun satırlarında yalnızca sesi duyulur.`);
    if(g.media != null && findRef(S.media, g.media) < 0) w.add(`[görsel ${g.media}] bulunamadı.`);
  }
  DOC.scenes.forEach(sc => { if(sc.bg && findRef(S.bgs, sc.bg) < 0) w.add(`Sahne görseli bulunamadı: ${sc.bg}`); });
  const a = [...w]; $('#uyari').textContent = a.slice(0, 4).join('\n') + (a.length > 4 ? `\n(+${a.length - 4} uyarı daha)` : '');
}
$('#metin').oninput = () => refreshDoc();
$('#etiketler').onclick = e => {
  const b = e.target.closest('button[data-t]'); if(!b) return;
  const ta = $('#metin'), a = ta.selectionStart == null ? ta.value.length : ta.selectionStart, z = ta.selectionEnd == null ? a : ta.selectionEnd;
  ta.setRangeText(b.dataset.t, a, z, 'end'); ta.focus(); refreshDoc(true);
};
$('#kartlar').addEventListener('toggle', () => { if($('#kartlar').open){ refreshDoc(true); } });
function renderCards(){
  const box = $('#kartListe'); box.innerHTML = '';
  const many = S.chars.length > 1;
  DOC.lines.forEach(g => {
    const d = document.createElement('div'); d.className = 'kart';
    const p = document.createElement('p');
    if(many){ const b = document.createElement('b'); b.textContent = charOfLine(g).name; p.appendChild(b); }
    p.appendChild(document.createTextNode(g.text.length > 120 ? g.text.slice(0, 120) + '…' : g.text));
    const ks = document.createElement('div'); ks.className = 'ks';
    const mk = (field, cur, autoLabel, items, aria) => {
      const s = document.createElement('select'); s.setAttribute('aria-label', aria);
      for(const [v, l] of [['', autoLabel], ...items]){ const o = document.createElement('option'); o.value = v; o.textContent = l; if(v === (cur || '')) o.selected = true; s.appendChild(o); }
      s.onchange = () => {
        const ta = $('#metin'); ta.value = setLineTags(ta.value, g, { ...g.inline, [field]: s.value || null }); refreshDoc(true);
      };
      ks.appendChild(s);
    };
    mk('mood', g.inline.mood, 'Oto: ' + MOOD_TR[g.inline.mood ? g.autoMood : g.mood], MOODS.map(m => [m, MOOD_TR[m]]), 'Duygu');
    mk('shot', g.inline.shot, 'Oto: ' + SHOT_TR[g.inline.shot ? g.autoShot : g.shot], SHOTS.map(m => [m, SHOT_TR[m]]), 'Plan');
    if(S.media.length){
      const mi = g.inline.media != null ? findRef(S.media, g.inline.media) : -1;
      mk('media', mi >= 0 ? String(mi + 1) : '', 'Görsel: aynı', S.media.map((m, k) => [String(k + 1), 'Görsel ' + (k + 1)]), 'Görsel');
    }
    d.append(p, ks); box.appendChild(d);
  });
}
$('#fMetin').onchange = async e => {
  const f = e.target.files[0]; if(!f) return;
  try{
    let t;
    if(/\.docx$/i.test(f.name)){
      if(!window.mammoth) await new Promise((res, rej) => { const sc = document.createElement('script');
        sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
      t = (await window.mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() })).value;
    } else {
      const b = await f.arrayBuffer();
      t = new TextDecoder('utf-8').decode(b);
      if(t.includes('\uFFFD')) t = new TextDecoder('windows-1254').decode(b);
    }
    $('#metin').value = t.replace(/\r/g, '').trim(); refreshDoc(true);
    say(`Senaryo yüklendi: ${DOC.lines.length} cümle.`);
  }catch(err){ say('Dosya okunamadı. .txt ya da .docx dosyası seç, olmazsa metni kopyala-yapıştır.'); }
};

/* ================= YERLEŞİM ================= */
const viewOf = (c, L) => (L !== 'birlesik' && c.crop) || { x:0, y:0, w:c.img.width, h:c.img.height };
const inView = (c, v, p) => ({ x:(p.x*c.img.width - v.x)/v.w, y:(p.y*c.img.height - v.y)/v.h });
const pt = (p, r) => ({ x:r.x + p.x*r.w, y:r.y + p.y*r.h });
function facePoint(c){
  const P = [c.pts.eyeL, c.pts.eyeR, c.pts.mouth].filter(Boolean);
  if(!P.length) return { x:.5, y:.3 };
  return { x:P.reduce((s, p) => s + p.x, 0)/P.length, y:P.reduce((s, p) => s + p.y, 0)/P.length };
}
function rect(c, L, bob = 0, br = 1){
  const v = viewOf(c, L), ar = v.w/v.h, port = H > W;
  if(L === 'birlesik'){
    const k = Math.max(W/v.w, H/v.h)*1.03*br, w = v.w*k, h = v.h*k;
    const x = Math.min(0, Math.max(W - w, W/2 - facePoint(c).x*w));       // dikey videoda yüz ortada kalır
    return { x, y:(H - h)/2 + bob*.25, w, h };
  }
  if(L === 'ekran' && S.media.length){
    const h = H*(port ? .34 : .62)*br, w = h*ar;
    return { x:W - w - W*.015, y:H - h + H*.012 + bob, w, h };
  }
  let h = H*(port ? .66 : .92)*c.scale*br, w = h*ar;
  if(port && w > W*1.05){ w = W*1.05*c.scale*br; h = w/ar; }
  return { x:W/2 - w/2 + c.off*W, y:H - h + H*.012 + bob, w, h };
}
/* Karakteri sahneyle kaynaştırma: sahnenin ışık rengi + yumuşak gölge. Karakter ve sahne çifti başına bir kez hesaplanır. */
function compOf(c, bg){
  let k = c.comp.get(bg.id); if(k !== undefined) return k;
  try{
    const amb = bg.amb, w = c.img.width, h = c.img.height;
    const t = document.createElement('canvas'); t.width = w; t.height = h; const tg = t.getContext('2d');
    tg.drawImage(c.img, 0, 0); tg.globalCompositeOperation = 'source-atop';
    tg.fillStyle = `rgba(${amb[0] | 0},${amb[1] | 0},${amb[2] | 0},.14)`; tg.fillRect(0, 0, w, h);
    const lg = tg.createLinearGradient(0, 0, w, 0);
    lg.addColorStop(0, 'rgba(255,240,220,.10)'); lg.addColorStop(.5, 'rgba(255,240,220,0)'); lg.addColorStop(1, 'rgba(0,0,0,.10)');
    tg.fillStyle = lg; tg.fillRect(0, 0, w, h);
    const pad = Math.round(w*.08), sh = document.createElement('canvas'); sh.width = w + pad*2; sh.height = h + pad*2;
    const sil = document.createElement('canvas'); sil.width = w; sil.height = h;
    const ig = sil.getContext('2d'); ig.drawImage(c.img, 0, 0); ig.globalCompositeOperation = 'source-in'; ig.fillStyle = '#000'; ig.fillRect(0, 0, w, h);
    const sg = sh.getContext('2d'); sg.filter = 'blur(' + Math.round(w*.025) + 'px)'; sg.drawImage(sil, pad, pad);
    k = { t, shadow:sh, pad, skin:mixRgb(c.skin, amb, .14) };
  }catch(e){ k = null; }
  c.comp.set(bg.id, k); return k;
}

/* ================= ÇİZİM ================= */
function drawMediaOne(m, kb, alpha, corner){
  if(!m || (m.kind === 'video' && m.el.readyState < 2)) return;
  const port = H > W;
  ctx.globalAlpha = alpha;
  blurX.drawImage(m.el, 0, 0, 48, 27);
  ctx.imageSmoothingEnabled = true; ctx.drawImage(blurC, 0, 0, W, H);
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, 0, W, H);
  const boxH = port && corner ? H*.6 : H;
  const k = Math.min(W/m.w, boxH/m.h)*.94*kb, dw = m.w*k, dh = m.h*k;
  const cx = corner && !port ? Math.min(W/2, Math.max(dw/2 + W*.02, W*.4)) : W/2;
  const cy = port && corner ? H*.04 + boxH/2 : H/2;
  ctx.drawImage(m.el, cx - dw/2, cy - dh/2, dw, dh);
  ctx.globalAlpha = 1;
}
function drawMediaLayer(mi, corner){
  if(!mi){ drawMediaOne(S.media[0], 1, 1, corner); return; }
  const kb = m => m && m.kind === 'image' ? 1 + .05*mi.prog : 1;
  if(mi.prev >= 0) drawMediaOne(S.media[mi.prev], 1.05, 1, corner);
  drawMediaOne(S.media[mi.k], kb(S.media[mi.k]), mi.prev >= 0 ? mi.fade : 1, corner);
}
function draw(fr){
  const { T = 0, o = 0, wf = 1, blink = false, sub = null, marks = false, zoom = 1, bob = 0, rot = 0, pop = 0, warm = 0, cool = 0,
          titleA = 0, title = '', endA = 0, endText = '', black = 0, media = null, ch = null, bg = null, layout = S.layout,
          useMedia = false, hint = false } = fr;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  ctx.fillStyle = '#10202b'; ctx.fillRect(0, 0, W, H);
  const showCh = !!(ch && ch.img) && !(layout === 'sadece' && useMedia);
  if(useMedia) drawMediaLayer(media, layout === 'ekran' && showCh);
  if(!useMedia && zoom > 1.001){
    let cx = W/2, cy = H/2;
    if(showCh){ const F = pt(inView(ch, viewOf(ch, layout), facePoint(ch)), rect(ch, layout)); cx = lerp(W/2, F.x, .85); cy = lerp(H/2, F.y, .85); }
    const hw = W/(2*zoom), hh = H/(2*zoom);
    cx = Math.min(W - hw, Math.max(hw, cx)); cy = Math.min(H - hh, Math.max(hh, cy));
    ctx.setTransform(zoom, 0, 0, zoom, W/2 - cx*zoom, H/2 - cy*zoom);
  }
  if(bg && !useMedia && (layout !== 'birlesik' || !showCh)){
    const B = bg.blur, k = Math.max(W/B.width, H/B.height), bw = B.width*k, bh = B.height*k;
    ctx.drawImage(B, (W - bw)/2, (H - bh)/2, bw, bh);
  }
  if(showCh){
    const v = viewOf(ch, layout), r = rect(ch, layout, bob, 1 + Math.sin(T*1.8)*.003 + pop), iw = ch.img.width;
    const px = r.x + r.w/2, py = r.y + r.h, sep = layout === 'karakter' || layout === 'ekran';
    const comp = sep && !useMedia && bg ? compOf(ch, bg) : null, P = n => pt(inView(ch, v, ch.pts[n]), r);
    ctx.save();
    if(layout !== 'birlesik'){ ctx.translate(px, py); ctx.rotate(rot); ctx.translate(-px, -py); }
    if(comp){
      const pd = comp.pad*r.w/v.w;
      ctx.globalAlpha = .38;
      ctx.drawImage(comp.shadow, v.x, v.y, v.w + comp.pad*2, v.h + comp.pad*2, r.x - pd + r.w*.012, r.y - pd + r.h*.006, r.w + pd*2, r.h + pd*2);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(comp ? comp.t : ch.img, v.x, v.y, v.w, v.h, r.x, r.y, r.w, r.h);
    if(ch.pts.mouth && o > .06){
      // ağız: şekil (genişlik) harften, açıklık harf + ses şiddetinden gelir
      const m = P('mouth'), mw = r.w*ch.mw*iw/v.w;
      const rx = mw/2*wf*(.8 + .2*o), ry = Math.max(mw*.38*o, 1.5), cy = m.y + ry*.25;
      ctx.save();
      ctx.beginPath(); ctx.ellipse(m.x, cy, rx, ry, 0, 0, Math.PI*2);
      ctx.fillStyle = '#4a1a1e'; ctx.fill(); ctx.clip();
      ctx.beginPath(); ctx.ellipse(m.x, cy + ry*.75, rx*.6, ry*.5, 0, 0, Math.PI*2);
      ctx.fillStyle = '#c9566a'; ctx.fill();
      if(wf > .7){ ctx.fillStyle = '#fffaf2'; ctx.fillRect(m.x - rx, cy - ry, rx*2, ry*.3); }
      ctx.restore();
      ctx.beginPath(); ctx.ellipse(m.x, cy, rx, ry, 0, 0, Math.PI*2);
      ctx.lineWidth = Math.max(1.5, mw*.05); ctx.strokeStyle = ch.lip; ctx.stroke();
    }
    if(blink && ch.pts.eyeL && ch.pts.eyeR){
      for(const n of ['eyeL', 'eyeR']){
        const p = P(n), e = r.w*ch.es*iw/v.w;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, e, e*.8, 0, 0, Math.PI*2); ctx.fillStyle = comp ? comp.skin : ch.skin; ctx.fill();
        ctx.beginPath(); ctx.moveTo(p.x - e*.9, p.y + e*.1); ctx.quadraticCurveTo(p.x, p.y + e*.45, p.x + e*.9, p.y + e*.1);
        ctx.lineWidth = Math.max(2, e*.12); ctx.strokeStyle = '#2b1d1a'; ctx.lineCap = 'round'; ctx.stroke();
      }
    }
    if(marks){
      const lab = { mouth:'Ağız', eyeL:'Sol göz', eyeR:'Sağ göz' };
      for(const n in ch.pts){ if(!ch.pts[n]) continue;
        const p = P(n), rad = (n === 'mouth' ? r.w*ch.mw/2 : r.w*ch.es)*iw/v.w;
        ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI*2);
        ctx.lineWidth = 3; ctx.strokeStyle = '#FFD166'; ctx.stroke();
        ctx.fillStyle = '#FFD166'; ctx.font = `700 ${Math.min(W, H)*.04}px Nunito, sans-serif`; ctx.textAlign = 'center';
        ctx.fillText(lab[n], p.x, p.y - rad - 6);
      }
    }
    ctx.restore();
  } else if(hint && !useMedia){
    ctx.fillStyle = '#B9CBD6'; ctx.font = `600 ${Math.min(W, H)*.05}px Nunito, sans-serif`; ctx.textAlign = 'center';
    ctx.fillText('Karakter görselini seç', W/2, H/2);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if(warm > .01){ ctx.fillStyle = `rgba(255,170,80,${.08*warm})`; ctx.fillRect(0, 0, W, H); }
  if(cool > .01){ ctx.fillStyle = `rgba(50,80,150,${.14*cool})`; ctx.fillRect(0, 0, W, H); }
  if(!marks){
    const R = Math.max(W, H), g = ctx.createRadialGradient(W/2, H/2, Math.min(W, H)*.35, W/2, H/2, R*.62);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${.3 + .2*cool})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  if(S.logo && !marks){
    const lw = W*(H > W ? .18 : .11), lh = lw*S.logo.height/S.logo.width, mg = Math.min(W, H)*.03;
    ctx.globalAlpha = .85; ctx.drawImage(S.logo, W - lw - mg, mg, lw, lh); ctx.globalAlpha = 1;
  }
  if(sub) drawSub(sub);
  if(titleA > .01 && title) textCard(title, titleA);
  if(endA > .01 && endText) textCard(endText, endA);
  if(black > .01){ ctx.fillStyle = `rgba(0,0,0,${Math.min(1, black)})`; ctx.fillRect(0, 0, W, H); }
}
/* Altyazı: sayfa sayfa gösterilir, o an okunan kelime sarı olur. "vurgu" stili büyük ve konturludur. */
function drawSub(sub){
  const port = H > W, vur = sub.style === 'vurgu';
  const fs = vur ? (port ? W*.085 : H*.078) : (port ? W*.05 : H*.042);
  ctx.font = vur ? `800 ${fs}px 'Baloo 2', sans-serif` : `700 ${fs}px Nunito, sans-serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const sp = ctx.measureText(' ').width, maxW = W*(port ? .86 : .8), rows = [];
  let row = [], rw = 0;
  sub.words.forEach((wd, i) => {
    const tx = vur ? wd.w.toLocaleUpperCase('tr') : wd.w, ww = ctx.measureText(tx).width;
    if(row.length && rw + sp + ww > maxW){ rows.push({ row, rw }); row = []; rw = 0; }
    rw += (row.length ? sp : 0) + ww; row.push({ tx, ww, i });
  });
  if(row.length) rows.push({ row, rw });
  const lh = fs*1.25, bh = rows.length*lh + fs*.6, by = (port ? H*.76 : H*.95) - bh;   // dikeyde Shorts düğmelerinin üstünde kalır
  if(!vur){
    const bw = Math.min(W*.96, Math.max(...rows.map(x => x.rw)) + fs*1.4);
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.beginPath(); if(ctx.roundRect) ctx.roundRect(W/2 - bw/2, by, bw, bh, fs*.4); else ctx.rect(W/2 - bw/2, by, bw, bh); ctx.fill();
  }
  rows.forEach((R, j) => {
    let x = W/2 - R.rw/2; const y = by + fs*.3 + lh*(j + .8);
    for(const it of R.row){
      if(vur){ ctx.lineJoin = 'round'; ctx.lineWidth = fs*.2; ctx.strokeStyle = 'rgba(0,0,0,.9)'; ctx.strokeText(it.tx, x, y); }
      ctx.fillStyle = it.i === sub.cur ? '#FFD166' : '#fff'; ctx.fillText(it.tx, x, y);
      x += it.ww + sp;
    }
  });
}
function wrap(text, maxW){
  const words = text.split(/\s+/), lines = []; let cur = '';
  for(const w of words){ const t = cur ? cur + ' ' + w : w; if(ctx.measureText(t).width > maxW && cur){ lines.push(cur); cur = w; } else cur = t; }
  if(cur) lines.push(cur); return lines;
}
function textCard(text, a){
  ctx.fillStyle = `rgba(16,32,43,${.72*a})`; ctx.fillRect(0, 0, W, H);
  const fs = Math.min(H*.085, W*.09); ctx.font = `800 ${fs}px 'Baloo 2', sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  const L = wrap(text, W*.8), lh = fs*1.1, y0 = H/2 - (L.length - 1)*lh/2 + fs*.3;
  ctx.fillStyle = `rgba(255,209,102,${a})`;
  L.forEach((l, i) => ctx.fillText(l, W/2, y0 + i*lh));
}
function still(){
  if(running || !S.chars.length) return;
  const c = act(), um = (S.layout === 'ekran' || S.layout === 'sadece') && S.media.length > 0;
  draw({ marks:$('#elle').open, ch:c.img ? c : null, bg:S.bgs[0] || null, layout:S.layout, useMedia:um, hint:true });
}
$('#elle').addEventListener('toggle', still);

/* ================= ELLE DÜZELTME ================= */
document.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
  mark = b.dataset.m;
  document.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x === b));
  say('Şimdi resimde ' + b.textContent.toLocaleLowerCase('tr') + ' noktasına dokun.');
});
cv.addEventListener('pointerdown', e => {
  const c = act(); if(!mark || !c.img || running) return;
  const b = cv.getBoundingClientRect(), x = (e.clientX - b.left)/b.width*W, y = (e.clientY - b.top)/b.height*H;
  const r = rect(c, S.layout), v = viewOf(c, S.layout);
  c.pts[mark] = { x:(v.x + (x - r.x)/r.w*v.w)/c.img.width, y:(v.y + (y - r.y)/r.h*v.h)/c.img.height };
  mark = null; document.querySelectorAll('[data-m]').forEach(x => x.classList.remove('on'));
  if(c.pts.mouth) c.badge = ['Yüz hazır', 'ok'];
  sampleSkin(c); saveChar(c); renderChars(); say('İşaretlendi.');
});
$('#testMouth').onclick = () => {
  const c = act(); if(!c.pts.mouth) return say('Önce ağzı işaretle.');
  const t0 = performance.now(), seq = [1, .62, 1.05, .48, .95];     // a, o, i, u, a
  (function f(){ const t = (performance.now() - t0)/1000;
    if(running) return;
    draw({ T:t, o:Math.abs(Math.sin(t*9))*.9, wf:seq[Math.floor(t*4) % seq.length], ch:c, bg:S.bgs[0] || null, layout:S.layout });
    if(t < 2) requestAnimationFrame(f); else still(); })();
};
$('#testBlink').onclick = () => {
  const c = act(); if(!c.pts.eyeL || !c.pts.eyeR) return say('Önce iki gözü de işaretle.');
  draw({ blink:true, ch:c, bg:S.bgs[0] || null, layout:S.layout }); setTimeout(still, 300);
};

/* ================= SES VE ZAMAN ÇİZELGESİ ================= */
/* Cümleleri karakterlere, sahnelere ve görüntülere bağlar */
function resolveLines(lines, doc){
  for(const g of lines){
    g.ch = charOfLine(g);
    const sc = g.scene >= 0 ? doc.scenes[g.scene] : null, bi = sc && sc.bg ? findRef(S.bgs, sc.bg) : -1;
    g.bg = S.bgs[bi >= 0 ? bi : 0] || null;
    g.layout = (sc && sc.layout) || S.layout;
    g.mediaIdx = g.media != null ? findRef(S.media, g.media) : -1;
  }
}
function voiceKey(){
  return JSON.stringify([$('#kaynak').value, $('#metin').value, S.chars.map(c => [c.name, voiceIdOf(c), pitchOf(c).toFixed(2)]), fileSig(S.audioFile)]);
}
async function ensureVoice(){
  const k = voiceKey();
  if(AUD && AUD.key === k){ resolveLines(AUD.lines, AUD.doc); return; }
  const a = ac(), doc = parseDoc(), lines = doc.lines, skipped = [];
  resolveLines(lines, doc);
  let buf;
  if($('#kaynak').value === 'dosya'){
    const f = S.audioFile; if(!f) throw new Error('"Ses kaynağı" bölümünden bir ses kaydı seç.');
    say('Ses kaydı okunuyor...');
    buf = toMono(await a.decodeAudioData(await f.arrayBuffer()));
  } else {
    if(!lines.length) throw new Error('Önce senaryo metnini yaz.');
    say('Ses motoru yükleniyor...');
    const bufs = []; let sr = 0;
    for(let i = 0; i < lines.length; i++){
      if(!running) throw new Error('Durduruldu');
      const g = lines[i], vid = voiceIdOf(g.ch), ck = vid + '|' + cleanText(g.text);
      let rec = null; try{ rec = await DB.get('voice', ck); }catch(e){}
      let b;
      if(rec){
        b = a.createBuffer(1, rec.data.length, rec.sr); b.copyToChannel(rec.data, 0);
        DB.put('voiceIdx', ck, { t:Date.now(), n:rec.data.byteLength }).catch(() => {});
      } else {
        say(`Seslendiriliyor: ${i + 1} / ${lines.length}`); bar(i/lines.length); notifyState(`🎙️ Ses ${i + 1}/${lines.length}`);
        const r = await synthRobust(g.text, vid, f => say(`Ses modeli indiriliyor (yalnızca ilk sefer): %${Math.round(f*100)}`));
        b = r.buf;
        if(r.skipped) skipped.push(g.text);
        else try{ const data = b.getChannelData(0).slice(); await DB.put('voice', ck, { sr:b.sampleRate, data });
                  await DB.put('voiceIdx', ck, { t:Date.now(), n:data.byteLength }); }catch(e){}
      }
      b = await pitchShift(b, pitchOf(g.ch));                // her karakter kendi tonuyla
      if(!sr) sr = b.sampleRate; else if(b.sampleRate !== sr) b = await resample(b, sr);
      bufs.push(b);
    }
    if(skipped.length === lines.length) throw new Error('Seslendirme yapılamadı. Ses modeli inmemiş olabilir; internet bağlantını kontrol edip yeniden dene.');
    const gapAfter = (g, nx) => (g.paraEnd ? .9 : /(\.\.\.|…)$/.test(g.text) ? .7 : /\?$/.test(g.text) ? .5 : .35) + (nx && nx.speaker !== g.speaker ? .2 : 0);
    const starts = []; let len = 0;
    lines.forEach((g, i) => { len += Math.round((g.pause || 0)*sr); starts.push(len); len += bufs[i].length + Math.round(gapAfter(g, lines[i + 1])*sr); });
    buf = a.createBuffer(1, Math.max(1, len), sr); const out = buf.getChannelData(0);
    lines.forEach((g, i) => { out.set(bufs[i].getChannelData(0), starts[i]); g.s = starts[i]/sr; g.e = (starts[i] + bufs[i].length)/sr; });
  }
  say('Ses düzeyi ayarlanıyor...');
  await normalize(buf, -16);
  const env = envelope(buf, FPS);
  if($('#kaynak').value === 'dosya' && lines.length) alignToRecording(lines, env);
  const tl = buildTimeline(lines, env), count = m => lines.filter(g => g.mood === m).length;
  AUD = { key:k, doc, buf, lines, env, n:env.length, dur:buf.duration, vis:lines.length ? tl.vis : null, lineIdx:tl.lineIdx, mood:tl.mood,
          mainMood: count('uzgun') > count('mutlu') ? 'uzgun' : 'mutlu', skipped };
}
async function musicSpec(){
  const kind = $('#muzik').value;
  if(kind !== 'dosya') return { kind };
  const f = S.musicFile; if(!f) throw new Error('Müzik dosyasını seç ya da fon müziğini "Yok" yap.');
  if(!MUS || MUS.sig !== fileSig(f)){
    say('Müzik okunuyor...');
    const b = toMono(await ac().decodeAudioData(await f.arrayBuffer())); await normalize(b, -16);
    MUS = { sig:fileSig(f), buf:b };
  }
  return { kind, buf:MUS.buf };
}

/* ================= GÖRÜNTÜ PLANI ================= */
function mediaPlan(P){
  const m = S.media.length; if(!m) return null;
  const L = AUD.lines, vd = AUD.dur; let marks = [];
  const tagged = L.filter(g => g.mediaIdx >= 0);
  if(tagged.length){                                    // etiketli: görüntü tam o cümlede değişir
    marks = tagged.map(g => ({ k:g.mediaIdx, a:g.s }));
    if(tagged[0] !== L[0]) marks.unshift({ k:0, a:0 });
  } else if(L.length >= m) for(let k = 0; k < m; k++) marks.push({ k, a:L[Math.floor(k*L.length/m)].s });
  else for(let k = 0; k < m; k++) marks.push({ k, a:k*vd/m });
  return marks.map((mk, j) => { const nx = marks[j + 1];
    return { k:mk.k, a: j === 0 ? -P.lead - 1 : mk.a, b: nx ? nx.a : Infinity, len: Math.max(1, (nx ? nx.a : vd) - Math.max(0, mk.a)) }; });
}
function mediaAt(P, T){
  if(!P.slots) return null;
  const t = T - P.lead; let j = P.slots.findIndex(s => t >= s.a && t < s.b); if(j < 0) j = 0;
  const s = P.slots[j], pv = j > 0 ? P.slots[j - 1] : null, local = Math.max(0, t - Math.max(s.a, -P.lead));
  const fade = pv && pv.k !== s.k ? Math.min(1, (t - s.a)/.45) : 1, prev = fade < 1 ? pv.k : -1;
  return { k:s.k, local, prog:Math.min(1, local/s.len), fade, prev, prevLocal: prev >= 0 ? Math.max(0, t - Math.max(pv.a, -P.lead)) : 0 };
}
const vidTime = (m, local) => m.dur > 0 ? local % m.dur : 0;
async function seekVideo(m, local){
  const target = vidTime(m, local);
  if(Math.abs(m.el.currentTime - target) < 1/15 && m.el.readyState >= 2) return;
  await new Promise(res => { let done = false; const fin = () => { if(!done){ done = true; res(); } };
    m.el.addEventListener('seeked', fin, { once:true }); setTimeout(fin, 800); m.el.currentTime = target; });
}
async function syncOffline(mi){
  if(!mi) return;
  for(const [k, loc] of [[mi.k, mi.local], [mi.prev, mi.prevLocal]]){
    if(k >= 0 && S.media[k] && S.media[k].kind === 'video') await seekVideo(S.media[k], loc);
  }
}
function syncLive(mi, on){
  S.media.forEach((m, k) => {
    if(m.kind !== 'video') return;
    const active = on && mi && (k === mi.k || k === mi.prev);
    if(!active){ if(!m.el.paused) m.el.pause(); return; }
    const target = vidTime(m, k === mi.k ? mi.local : mi.prevLocal);
    if(Math.abs(m.el.currentTime - target) > .35) m.el.currentTime = target;
    if(m.el.paused) m.el.play().catch(() => {});
  });
}
const stopVideos = () => S.media.forEach(m => { if(m.kind === 'video') m.el.pause(); });

/* ================= YÖNETMEN =================
   Saf fonksiyon: aynı proje ve aynı T için hep aynı kareyi tarif eder.
   Önizleme, video ve yarıda kalıp devam eden iş bu yüzden birebir aynıdır. */
function rng(seed){ return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0)/4294967296; }; }
function blinkPlan(D, seed){ const r = rng(seed || 7), a = []; let t = 1.2; while(t < D){ a.push(t); t += 2.5 + r()*2.5; } return a; }
const isBlink = (t, a) => a.some(b => t >= b && t < b + .14);
function camZoom(t, i){
  const g = AUD.lines; if(i < 0) return 1;
  const cur = g[i], prev = i > 0 ? g[i - 1].zoom : 1, k = cur.cut ? 1 : ease((t - cur.s)/.9);
  return lerp(prev, cur.zoom, k) + Math.min(.035, Math.max(0, t - cur.s)*.006);
}
function subAt(P, t){
  const pg = P.pages; let lo = 0, hi = pg.length - 1, j = -1;
  while(lo <= hi){ const mid = (lo + hi) >> 1; if(pg[mid].s <= t){ j = mid; lo = mid + 1; } else hi = mid - 1; }
  if(j < 0 || t >= pg[j].end) return null;
  let cur = -1; pg[j].words.forEach((w, i) => { if(w.s <= t) cur = i; });
  return { style:P.subStyle, words:pg[j].words, cur };
}
function director(P){
  const A = AUD, L = A.lines, blinks = blinkPlan(P.D, P.seed), narr = S.chars[0];
  return T => {
    const t = T - P.lead, f = Math.floor(t*FPS), inV = t >= 0 && f < A.n, fm = Math.max(0, Math.min(A.n - 1, f));
    const env = inV ? A.env[f] : 0;
    const i = t < 0 || !A.n ? -1 : A.lineIdx[fm], g = i >= 0 ? L[i] : null, gd = g || L[0] || null;   // açılışta ilk cümlenin sahnesi görünür
    const M = t < 0 || !A.n ? { uzgun:0, mutlu:0, saskin:0, dusunceli:0 }
            : { uzgun:A.mood.uzgun[fm], mutlu:A.mood.mutlu[fm], saskin:A.mood.saskin[fm], dusunceli:A.mood.dusunceli[fm] };
    let o = 0, wf = 1;
    if(env > .05){
      if(A.vis){ wf = A.vis.w[f]; o = A.vis.c[f] ? 0 : Math.max(A.vis.h[f]*(.45 + .55*env), env*.3); }
      else o = env;
    }
    let nod = 0, ask = 0;
    if(g && t > g.e && t < g.e + .45) nod = Math.sin(Math.PI*(t - g.e)/.45);
    if(g && /\?["'”’)]*$/.test(g.text)) ask = ease((t - (g.e - .6))/.4)*(1 - ease((t - g.e - .25)/.4));   // soru sonunda baş hafif yana eğilir
    const segT = g ? t - g.s : 9, pop = M.saskin*Math.max(0, 1 - segT/.4)*.015;
    const bob = Math.sin(T*1.3*(1 - .4*M.uzgun + .3*M.mutlu))*H*.004 - o*H*.003 + H*.008*M.uzgun + H*.006*nod;
    const rot = (Math.sin(T*.37)*.4 - 1.8*M.dusunceli + Math.sin(T*.9)*.8*M.mutlu + .6*nod + 2.2*ask)*Math.PI/180;
    const layout = gd ? gd.layout : S.layout, useMedia = (layout === 'ekran' || layout === 'sadece') && S.media.length > 0;
    return { T, o, wf, blink:isBlink(T, blinks), sub: P.pages.length && t >= 0 ? subAt(P, t) : null,
             zoom: P.camOn && (layout === 'karakter' || layout === 'birlesik') ? camZoom(Math.max(t, 0), i) : 1,
             bob, rot, pop, warm:M.mutlu, cool:M.uzgun, ch: gd ? gd.ch : narr, bg: gd ? gd.bg : (S.bgs[0] || null), layout, useMedia,
             titleA: P.title ? 1 - ease((T - (P.lead - .9))/.7) : 0, title:P.title,
             endA: P.endText ? ease((T - (P.lead + A.dur + .2))/.6) : 0, endText:P.endText,
             black: Math.max(1 - T/.5, (T - (P.D - 1))/1, 0), media: mediaAt(P, T) };
  };
}
function lock(on){ ['#btnRec', '#btnOn', '#btnDinle'].forEach(s => $(s).disabled = on); $('#btnDur').disabled = !on; }
function setRes(w, h){ W = w; H = h; cv.width = w; cv.height = h; }
const getTitle = () => $('#baslik').value.trim() || (DOC && DOC.title) || '';
function notifyState(text){
  document.title = text;
  try{ if('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title:text, artist:'Hikâye Stüdyosu' }); }catch(e){}
}

async function prepare(seed){
  // ucuz denetimler seslendirmeden önce yapılır
  const doc = parseDoc(); resolveLines(doc.lines, doc);
  const layouts = new Set([S.layout, ...doc.lines.map(g => g.layout)]);
  if((layouts.has('ekran') || layouts.has('sadece')) && !S.media.length) throw new Error('Bu düzen için önce ekran görüntüsü ya da kaydı ekle.');
  if(S.layout !== 'sadece'){
    const speakers = doc.lines.length ? [...new Set(doc.lines.map(g => g.ch))] : [S.chars[0]];
    if(!speakers.some(c => c.img)) throw new Error('Önce karakter görselini seç.');
    const bad = speakers.find(c => c.img && !c.pts.mouth);
    if(bad) throw new Error(`"${bad.name}" karakterinin ağzı bulunamadı. "Yüzü elle düzelt" bölümünden işaretle.`);
  }
  await ensureVoice();
  if(!running) return null;
  const [w, h] = $('#cozunurluk').value.split('x').map(Number);
  if(cv.width !== w || cv.height !== h) setRes(w, h);
  const title = getTitle(), lead = title ? 3.2 : .6, endText = $('#kapanis').value.trim(), tail = endText ? 3.8 : 1.5;
  const music = await musicSpec();
  say('Miksaj yapılıyor...');
  const speech = AUD.lines.length ? AUD.lines.map(g => ({ s:g.s, e:g.e })) : [{ s:0, e:AUD.dur }];
  const master = await mixMaster({ voice:AUD.buf, lead, tail, music, mood:AUD.mainMood, speech });
  const subStyle = $('#altyazi').value, port = h > w;
  const P = { master, lead, tail, title, endText, D:master.duration, w, h, seed: seed || 7, camOn:$('#kamera').checked, subStyle,
              pages: subStyle === 'yok' ? [] : pagesOf(AUD.lines, subStyle === 'vurgu' ? (port ? 16 : 26) : (port ? 44 : 84)) };
  P.slots = mediaPlan(P);
  LAST = P; $('#ekler').classList.remove('gizli'); $('#bolumYazi').classList.add('gizli');
  return P;
}
function fileName(ext){
  const c = S.chars.find(x => x.file);
  return (getTitle() || (c ? c.file.name.replace(/\.[^.]+$/, '') : '') || 'hikaye')
    .replace(/[^\wçğıöşüÇĞİÖŞÜ -]/g, '').trim().replace(/\s+/g, '_') + '.' + ext;
}
function download(blob, name){
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function offerDownload(blob, ext){
  if(lastUrl) URL.revokeObjectURL(lastUrl);
  const url = lastUrl = URL.createObjectURL(blob), ad = fileName(ext);
  const a = document.createElement('a'); a.className = 'indir'; a.href = url; a.download = ad;
  a.textContent = `Videoyu indir (${ext.toUpperCase()}, ${(blob.size/1e6).toFixed(0)} MB)`;
  $('#sonuc').innerHTML = ''; $('#sonuc').appendChild(a);
  try{ a.click(); }catch(e){}
}

/* --- Önizleme (gerçek zamanlı, ekran açık) --- */
async function playLive(P, a, t0){
  const dir = director(P);
  await new Promise(done => {
    (function loop(){
      const T = a.currentTime - t0, fr = dir(Math.max(0, T));
      syncLive(fr.media, fr.useMedia); draw(fr); bar(T/P.D);
      if(T < P.D && running) requestAnimationFrame(loop); else done();
    })();
  });
}
async function preview(){
  lock(true); running = true; $('#sonuc').innerHTML = '';
  try{
    const P = await prepare(); if(!P){ say('Durduruldu.'); return; }
    const a = ac(); await a.resume();
    const src = a.createBufferSource(); src.buffer = P.master; src.connect(a.destination);
    const t0 = a.currentTime + .15; src.start(t0);
    say('Önizleme oynatılıyor.');
    await playLive(P, a, t0);
    try{ src.stop(); }catch(e){}
    say(running ? 'Önizleme bitti.' : 'Durduruldu.');
  }catch(e){ say(e.message || String(e)); }
  finally{ stopVideos(); running = false; lock(false); still(); }
}

/* --- Video üretimi: arka planda, gerçek zamandan hızlı (WebCodecs) --- */
async function pickCodecs(w, h){
  if(!window.VideoEncoder || !window.AudioEncoder || !window.VideoFrame) return null;
  const br = Math.max(w, h) >= 1920 ? 6e6 : 3.5e6;
  let video = null, vname = null;
  for(const [codec, name] of [['avc1.640028', 'avc'], ['avc1.4d0028', 'avc'], ['avc1.42002a', 'avc'], ['avc1.42001f', 'avc'], ['vp09.00.40.08', 'vp9']]){
    const cfg = { codec, width:w, height:h, bitrate:br, framerate:FPS };
    try{ if((await VideoEncoder.isConfigSupported(cfg)).supported){ video = cfg; vname = name; break; } }catch(e){}
  }
  if(!video) return null;
  let audio = null, aname = null;
  for(const [codec, name] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]){
    const cfg = { codec, sampleRate:48000, numberOfChannels:1, bitrate:128000 };
    try{ if((await AudioEncoder.isConfigSupported(cfg)).supported){ audio = cfg; aname = name; break; } }catch(e){}
  }
  if(!audio) return null;
  return { video, vname, audio, aname };
}
const PART = FPS*10;   // 10 saniyelik parçalar halinde üretilir ve kaydedilir
function plainMeta(m){
  if(!m || !m.decoderConfig) return null;
  const d = m.decoderConfig;
  return { codec:d.codec, codedWidth:d.codedWidth, codedHeight:d.codedHeight,
           description: d.description ? new Uint8Array(d.description instanceof ArrayBuffer ? d.description : d.description.buffer.slice(d.description.byteOffset, d.description.byteOffset + d.description.byteLength)).slice() : undefined,
           colorSpace: d.colorSpace ? (d.colorSpace.toJSON ? d.colorSpace.toJSON() : { primaries:d.colorSpace.primaries, transfer:d.colorSpace.transfer, matrix:d.colorSpace.matrix, fullRange:d.colorSpace.fullRange })
                                    : { primaries:'bt709', transfer:'bt709', matrix:'bt709', fullRange:false } };
}
async function renderParts(P, C, job){
  const total = Math.ceil(P.D*FPS), nParts = Math.ceil(total/PART);
  job.totalParts = nParts; job.stage = 'video'; await saveJob(job);
  let p0 = 0; while(p0 < nParts && await DB.get('parts', job.id + ':' + p0)) p0++;
  const dir = director(P);                               // saf fonksiyon: kaldığı kareden doğrudan sürer
  if(p0 > 0) say(`Kaldığı yerden devam ediliyor: %${Math.floor(p0/nParts*100)}`);
  let lastPct = -1;
  for(let p = p0; p < nParts; p++){
    if(!running) return false;
    const chunks = []; let meta = null, err = null;
    const venc = new VideoEncoder({
      output:(c, m) => { const d = new Uint8Array(c.byteLength); c.copyTo(d);
        chunks.push({ t:c.type, ts:c.timestamp, du:c.duration || 0, d }); if(!meta) meta = plainMeta(m); },
      error:e => err = e });
    venc.configure(C.video);
    const a0 = p*PART, a1 = Math.min(total, a0 + PART);
    for(let i = a0; i < a1; i++){
      if(!running){ try{ venc.close(); }catch(e){} return false; }
      if(err) throw err;
      const fr = dir(i/FPS); if(fr.useMedia) await syncOffline(fr.media); draw(fr);
      const vf = new VideoFrame(cv, { timestamp: Math.round(i*1e6/FPS), duration: Math.round(1e6/FPS) });
      venc.encode(vf, { keyFrame: (i - a0) % (FPS*2) === 0 }); vf.close();
      while(venc.encodeQueueSize > 6) await sleep(4);
      const pct = Math.floor(i/total*100);
      if(pct !== lastPct){ lastPct = pct; bar(i/total); say(`Video hazırlanıyor: %${pct}`); notifyState(`🎬 %${pct} hazırlanıyor`); }
      if(i % 3 === 0) await nextTask();
    }
    await venc.flush(); try{ venc.close(); }catch(e){}
    if(err) throw err;
    await DB.put('parts', job.id + ':' + p, { chunks, meta });
    job.partsDone = p + 1; await saveJob(job);
  }
  return true;
}
/* Parçaları tek MP4'te birleştirir. Dosya telefonun kendi dosya alanına akıtılır; uzun videoda bellek dolmaz. */
async function muxAll(P, C, job){
  say('Parçalar birleştiriliyor...'); notifyState('🎬 Birleştiriliyor...');
  const MX = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5/+esm');
  const name = job.id + '.mp4'; let handle = null, writable = null, target;
  try{ const root = await opfs(); handle = await root.getFileHandle(name, { create:true }); writable = await handle.createWritable();
       target = new MX.FileSystemWritableFileStreamTarget(writable); }
  catch(e){ writable = null; target = new MX.ArrayBufferTarget(); }   // dosya alanı yoksa eski yöntem: bellekte
  const muxer = new MX.Muxer({ target, fastStart: writable ? false : 'in-memory', firstTimestampBehavior:'offset',
    video:{ codec:C.vname, width:P.w, height:P.h, frameRate:FPS },
    audio:{ codec:C.aname, numberOfChannels:1, sampleRate:48000 } });
  let err = null;
  const aenc = new AudioEncoder({ output:(c, m) => muxer.addAudioChunk(c, m), error:e => err = e });
  aenc.configure(C.audio);
  const pcm = P.master.getChannelData(0); let apos = 0;
  const pushAudio = upto => {
    while(apos < Math.min(upto, pcm.length)){
      const n = Math.min(4800, pcm.length - apos);
      const ad = new AudioData({ format:'f32-planar', sampleRate:48000, numberOfFrames:n, numberOfChannels:1,
        timestamp: Math.round(apos/48000*1e6), data: pcm.slice(apos, apos + n) });
      aenc.encode(ad); ad.close(); apos += n;
    }
  };
  let first = true;
  for(let p = 0; p < job.totalParts; p++){
    const rec = await DB.get('parts', job.id + ':' + p);
    if(!rec) throw new Error('Bir video parçası eksik, lütfen yeniden başlat.');
    for(const ch of rec.chunks){
      const e = new EncodedVideoChunk({ type:ch.t, timestamp:ch.ts, duration:ch.du, data:ch.d });
      muxer.addVideoChunk(e, first && rec.meta ? { decoderConfig:rec.meta } : undefined); first = false;
      pushAudio(Math.round(ch.ts/1e6*48000) + 4800);
    }
    bar((p + 1)/job.totalParts); await nextTask();
  }
  pushAudio(pcm.length); await aenc.flush();
  if(err) throw err;
  muxer.finalize();
  if(writable){ await writable.close(); return { blob:new Blob([await handle.getFile()], { type:'video/mp4' }), opfs:name }; }
  return { blob:new Blob([target.buffer], { type:'video/mp4' }) };
}
/* Eski yöntem: WebCodecs yoksa gerçek zamanlı kayıt (ekran açık kalmalı) */
function pickMime(){
  if(!window.MediaRecorder) return null;
  for(const m of ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'])
    if(MediaRecorder.isTypeSupported(m)) return m;
  return '';
}
async function renderRealtime(P){
  const mime = pickMime(); if(mime === null) throw new Error('Bu tarayıcı video üretmeyi desteklemiyor. Chrome ile aç.');
  const a = ac(); await a.resume();
  const src = a.createBufferSource(); src.buffer = P.master;
  const dest = a.createMediaStreamDestination(); src.connect(dest); src.connect(a.destination);
  const stream = new MediaStream([...cv.captureStream(FPS).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const rec = new MediaRecorder(stream, { ...(mime ? { mimeType:mime } : {}), videoBitsPerSecond: Math.max(P.w, P.h) >= 1920 ? 8e6 : 5e6 });
  const chunks = []; rec.ondataavailable = e => { if(e.data.size) chunks.push(e.data); }; rec.start(1000);
  say('Bu telefonda hızlı üretim yok; video gerçek zamanlı kaydediliyor. Ekranı açık tut.');
  const t0 = a.currentTime + .15; src.start(t0);
  await playLive(P, a, t0);
  try{ src.stop(); }catch(e){}
  await new Promise(r => { rec.onstop = r; rec.stop(); });
  const type = rec.mimeType || 'video/webm';
  return { blob:new Blob(chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm' };
}

/* ================= PROJE GÖRÜNTÜSÜ (iş kaydı ve proje kütüphanesi aynı biçimi kullanır) ================= */
const CHAR_KEYS = ['name', 'gender', 'age', 'voice', 'tonAuto', 'ton', 'file', 'pts', 'crop', 'scale', 'off', 'mw', 'es', 'skin', 'lip'];
function currentOpts(){
  return { res:$('#cozunurluk').value, cam:$('#kamera').checked, sub:$('#altyazi').value, music:$('#muzik').value,
           kaynak:$('#kaynak').value, end:$('#kapanis').value };
}
function applyOpts(o){
  o = o || {};
  $('#cozunurluk').value = o.res || '1280x720'; $('#kamera').checked = o.cam !== false; $('#altyazi').value = o.sub || 'klasik';
  $('#muzik').value = o.music || 'yok'; $('#kaynak').value = o.kaynak || 'ai'; $('#kapanis').value = o.end || '';
  $('#muzikBox').classList.toggle('gizli', $('#muzik').value !== 'dosya'); $('#fileBox').classList.toggle('gizli', $('#kaynak').value !== 'dosya');
  const [w, h] = $('#cozunurluk').value.split('x').map(Number); setRes(w, h);
}
function snapshot(){
  return { v:2, title:$('#baslik').value, text:$('#metin').value, opts:currentOpts(), layout:S.layout,
           chars:S.chars.map(c => { const o = {}; CHAR_KEYS.forEach(k => o[k] = c[k]); return o; }),
           bgs:S.bgs.map(b => b.file), media:S.media.map(m => m.file), audioFile:S.audioFile, musicFile:S.musicFile, logoFile:S.logoFile };
}
function signature(){
  const sn = snapshot(), sig = f => fileSig(f);
  return JSON.stringify([sn.title, sn.text, sn.opts, sn.layout, sn.chars.map(c => ({ ...c, file:sig(c.file) })), sn.bgs.map(sig), sn.media.map(sig),
                         sig(sn.audioFile), sig(sn.musicFile), sig(sn.logoFile)]);
}
async function restore(sn){
  AUD = null; LAST = null; MUS = null; S.chars = []; $('#ekler').classList.add('gizli'); $('#sonuc').innerHTML = '';
  for(const d of sn.chars || []){
    const c = newChar(d.name || 'Anlatıcı'); CHAR_KEYS.forEach(k => { if(d[k] !== undefined) c[k] = d[k]; });
    if(c.file){ try{ c.img = await loadImg(c.file, charMax); c.badge = [c.pts.mouth ? 'Yüz hazır (kayıtlı)' : 'Yüz işaretli değil', c.pts.mouth ? 'ok' : 'warn']; }catch(e){ c.file = null; } }
  }
  if(!S.chars.length) newChar('Anlatıcı');
  S.active = S.chars[0].id; S.layout = sn.layout || 'karakter'; $('#duzen').value = S.layout;
  await setBgs(sn.bgs || []);
  dropMedia(); for(const f of sn.media || []){ try{ S.media.push(await loadMedia(f)); }catch(e){} }
  S.audioFile = sn.audioFile || null; S.musicFile = sn.musicFile || null;
  await setLogo(sn.logoFile || null).catch(() => {});
  $('#metin').value = sn.text || ''; $('#baslik').value = sn.title || '';
  applyOpts(sn.opts);
  renderList('#bgListe', S.bgs, i => { S.bgs.splice(i, 1); setBgsDone(); });
  renderList('#medyaListe', S.media, i => { const m = S.media.splice(i, 1)[0]; if(m.url) URL.revokeObjectURL(m.url); mediaDone(); });
  refreshDoc(true); renderChars();
}

/* ================= İŞ KAYDI (kaldığı yerden devam) ================= */
const saveJob = job => DB.put('jobs', 'aktif', job);
async function clearJob(job){
  try{ await DB.delPrefix('parts', job.id + ':'); }catch(e){}
  try{ await DB.del('jobs', 'aktif'); }catch(e){}
  await opfsClean(null);
}
async function showBanner(){
  let job = null; try{ job = await DB.get('jobs', 'aktif'); }catch(e){}
  const box = $('#devam');
  if(!job){ box.classList.add('gizli'); return; }
  box.classList.remove('gizli');
  const ad = job.name || 'Video';
  if(job.stage === 'bitti'){
    box.querySelector('h2').textContent = 'Hazır video';
    $('#devamYazi').textContent = `"${ad}" videosu hazır. İndirmediysen şimdi indirebilirsin.`;
    $('#btnDevam').textContent = 'Videoyu indir';
  } else {
    box.querySelector('h2').textContent = 'Yarım kalan video';
    const pct = job.totalParts ? Math.floor((job.partsDone || 0)/job.totalParts*100) : 0;
    $('#devamYazi').textContent = job.stage === 'video'
      ? `"${ad}" videosunun %${pct} kadarı hazır. Kaldığı yerden devam edebilirsin.`
      : `"${ad}" videosu seslendirme aşamasında kaldı. Biten cümleler kayıtlı, kaldığı yerden devam eder.`;
    $('#btnDevam').textContent = 'Kaldığı yerden devam et';
  }
}
$('#btnDevam').onclick = async () => {
  const job = await DB.get('jobs', 'aktif'); if(!job) return showBanner();
  if(job.stage === 'bitti'){
    const blob = job.opfs ? await opfsFile(job.opfs) : job.final;
    if(!blob){ say('Kayıtlı video bulunamadı; yeniden oluşturman gerekiyor.'); await clearJob(job); return showBanner(); }
    offerDownload(new Blob([blob], { type:'video/mp4' }), 'mp4'); say('Video indiriliyor.'); return;
  }
  keepAlive(true);
  try{ say('Kayıtlı iş açılıyor...'); await restore(job.snap); }catch(e){ say('Kayıtlı iş açılamadı: ' + (e.message || e)); keepAlive(false); return; }
  produce(job);
};
$('#btnSil').onclick = async () => {
  const job = await DB.get('jobs', 'aktif');
  if(job && !confirm('Kayıtlı video işi silinsin mi?')) return;
  if(job) await clearJob(job);
  showBanner(); say('Kayıtlı iş silindi.');
};
async function produce(resumeJob){
  keepAlive(true);                 // dokunuş anında başlamalı: sekmeyi arka planda canlı tutar
  let job = resumeJob || null;
  if(!job){
    let old = null; try{ old = await DB.get('jobs', 'aktif'); }catch(e){}
    const sig = signature();
    if(old && old.sig === sig && old.stage !== 'bitti') job = old;
    else {
      if(old && old.stage !== 'bitti' && !confirm('Yarım kalan başka bir video var. Silinip bu video başlatılsın mı?')){ keepAlive(false); return; }
      if(old) await clearJob(old);
      const c = S.chars.find(x => x.file);
      job = { id:'is' + Date.now(), sig, created:Date.now(), stage:'ses', partsDone:0, totalParts:0, seed:Math.floor(Math.random()*1e9),
              name: getTitle() || (c ? c.name : 'Video'), snap:snapshot() };
      try{ await saveJob(job); }catch(e){ say('Uyarı: iş kaydedilemedi, yarıda kalırsa baştan başlar.'); }
    }
  }
  try{ navigator.storage && navigator.storage.persist && navigator.storage.persist(); }catch(e){}
  lock(true); running = true; $('#sonuc').innerHTML = ''; $('#devam').classList.add('gizli');
  notifyState('🎬 Hazırlanıyor...');
  const started = performance.now();
  try{
    const P = await prepare(job.seed); if(!P){ say('Durduruldu. Kaldığı yerden devam edebilirsin.'); return; }
    const C = await pickCodecs(P.w, P.h);
    let out;
    if(C){
      const ok = await renderParts(P, C, job);
      if(!ok){ say('Durduruldu. Uygulamayı tekrar açınca kaldığı yerden devam edebilirsin.'); notifyState('Hikâye Stüdyosu'); return; }
      const mx = await muxAll(P, C, job);
      out = { blob:mx.blob, ext:'mp4' };
      job.stage = 'bitti'; job.snap = null;
      if(mx.opfs) job.opfs = mx.opfs; else job.final = mx.blob;
      try{ await DB.delPrefix('parts', job.id + ':'); await saveJob(job); }catch(e){}
      if(mx.opfs) opfsClean(mx.opfs);
      pruneVoice();
    } else { out = await renderRealtime(P); try{ await DB.del('jobs', 'aktif'); }catch(e){} }
    offerDownload(out.blob, out.ext);
    const dk = ((performance.now() - started)/60000).toFixed(1), sk = AUD.skipped;
    say(`Video hazır (${dk} dakika). İndirip YouTube'a yükleyebilirsin.` +
        (sk.length ? ` Uyarı: ${sk.length} cümle seslendirilemedi ve yerine kısa sessizlik kondu: "${sk[0].slice(0, 50)}..."` : ''));
    notifyState('✅ Video hazır - Hikâye Stüdyosu');
    keepAlive(false); chime();
  }catch(e){
    say((e.message === 'Durduruldu' ? 'Durduruldu.' : 'Video üretilemedi: ' + (e.message || e)) + ' Kaldığı yerden devam edebilirsin.');
    notifyState('⚠️ Durdu - Hikâye Stüdyosu');
    try{ navigator.vibrate && navigator.vibrate(600); }catch(_){}
  }finally{
    keepAlive(false); stopVideos(); running = false; lock(false); still(); showBanner();
  }
}
$('#btnOn').onclick = () => preview();
$('#btnRec').onclick = () => produce();
$('#btnDur').onclick = () => { running = false; };
$('#cozunurluk').onchange = e => { const [w, h] = e.target.value.split('x').map(Number); setRes(w, h); still(); };

/* ================= EKLER: ALTYAZI DOSYASI, BÖLÜMLER, KÜÇÜK RESİM ================= */
$('#btnSrt').onclick = () => {
  if(!LAST || !AUD || !AUD.lines.length) return say('Altyazı dosyası için senaryo metni gerekli.');
  const pages = LAST.pages.length ? LAST.pages : pagesOf(AUD.lines, 84);
  download(new Blob([toSRT(pages, LAST.lead)], { type:'text/plain' }), fileName('srt')); say('Altyazı dosyası indirildi.');
};
$('#btnBolum').onclick = async () => {
  if(!LAST || !AUD) return;
  const t = chaptersText(AUD.lines, LAST.lead);
  if(!t) return say('Bölüm listesi için senaryoya "## Bölüm adı" satırları ekle.');
  const box = $('#bolumYazi'); box.value = t; box.classList.remove('gizli');
  try{ await navigator.clipboard.writeText(t); say('Bölüm listesi kopyalandı; YouTube açıklamasına yapıştır.'); }catch(e){ say('Bölüm listesi aşağıda; kopyalayıp YouTube açıklamasına yapıştır.'); }
};
$('#btnThumb').onclick = () => {
  if(!LAST || !AUD || running) return;
  const P = LAST, g = AUD.lines[0], T = P.lead + (g ? g.s + Math.min(.6, (g.e - g.s)/2) : .5);
  if(cv.width !== P.w || cv.height !== P.h) setRes(P.w, P.h);
  draw({ ...director(P)(T), sub:null, titleA:0, endA:0, black:0, zoom:1.18, blink:false });
  if(P.title){                                        // başlık: büyük, konturlu, alt üçte birde
    const fs = Math.min(H*.13, W*.1); ctx.font = `800 ${fs}px 'Baloo 2', sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const L = wrap(P.title.toLocaleUpperCase('tr'), W*.9).slice(0, 3), lh = fs*1.08, y0 = H*.93 - (L.length - 1)*lh;
    ctx.lineJoin = 'round'; ctx.lineWidth = fs*.22; ctx.strokeStyle = 'rgba(0,0,0,.92)'; ctx.fillStyle = '#FFD166';
    L.forEach((l, i) => { ctx.strokeText(l, W/2, y0 + i*lh); ctx.fillText(l, W/2, y0 + i*lh); });
  }
  cv.toBlob(b => { if(b){ download(b, fileName('png')); say('Küçük resim indirildi.'); } setTimeout(still, 1200); }, 'image/png');
};

/* ================= PROJE KÜTÜPHANESİ ================= */
async function renderProjects(){
  const box = $('#prListe'); box.innerHTML = '';
  let list = []; try{ list = (await DB.all('projects')).map(x => x.v).sort((a, b) => b.updated - a.updated); }catch(e){}
  for(const p of list){
    const d = document.createElement('div'); d.className = 'proje';
    const s = document.createElement('span'); s.textContent = p.name;
    const sm = document.createElement('small'); sm.textContent = new Date(p.updated).toLocaleString('tr-TR', { dateStyle:'medium', timeStyle:'short' }); s.appendChild(sm);
    const o = document.createElement('button'); o.textContent = 'Aç';
    o.onclick = async () => { if(running) return; say('Proje açılıyor...'); try{ await restore(p.snap); PROJ = p.id; say(`"${p.name}" açıldı.`); }catch(e){ say('Proje açılamadı: ' + (e.message || e)); } };
    const x = document.createElement('button'); x.textContent = 'Sil';
    x.onclick = async () => { if(!confirm(`"${p.name}" projesi silinsin mi?`)) return; await DB.del('projects', p.id); if(PROJ === p.id) PROJ = null; renderProjects(); };
    d.append(s, o, x); box.appendChild(d);
  }
}
$('#prKaydet').onclick = async () => {
  const c = S.chars.find(x => x.file), id = PROJ || 'p' + Date.now();
  const name = getTitle() || (c ? c.name : '') || 'Adsız proje';
  try{ await DB.put('projects', id, { id, name, updated:Date.now(), snap:snapshot() }); PROJ = id; say(`"${name}" kaydedildi.`); renderProjects(); }
  catch(e){ say('Proje kaydedilemedi (telefonda yer kalmamış olabilir): ' + (e.message || e)); }
};
$('#prYeni').onclick = async () => {
  if(running || !confirm('Ekrandaki çalışma kapatılıp boş bir proje açılsın mı? Kaydetmediğin değişiklikler gider.')) return;
  PROJ = null; await restore({ chars:[], opts:{} }); say('Yeni proje.');
};
$('#prDisa').onclick = () => {
  const sn = snapshot(), meta = ['name', 'gender', 'age', 'voice', 'tonAuto', 'ton'];
  const out = { v:2, title:sn.title, text:sn.text, opts:sn.opts, layout:sn.layout, chars:sn.chars.map(c => { const o = {}; meta.forEach(k => o[k] = c[k]); return o; }) };
  download(new Blob([JSON.stringify(out, null, 1)], { type:'application/json' }), fileName('json'));
};
$('#prIceBtn').onclick = () => $('#prIce').click();
$('#prIce').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if(!f || running) return;
  try{
    const d = JSON.parse(await f.text()); if(!d || typeof d.text !== 'string') throw new Error('biçim tanınmadı');
    $('#metin').value = d.text; $('#baslik').value = d.title || ''; applyOpts(d.opts); if(d.layout) setLayout(d.layout);
    for(const m of d.chars || []){
      const c = S.chars.find(x => key(x.name) === key(m.name || '')) || newChar(m.name || 'Karakter');
      for(const k of ['gender', 'age', 'voice', 'tonAuto', 'ton']) if(m[k] !== undefined) c[k] = m[k];
    }
    AUD = null; refreshDoc(true); renderChars(); say('Proje içe aktarıldı. Resim ve videoları yeniden seç.');
  }catch(err){ say('Proje dosyası okunamadı: ' + (err.message || err)); }
};

/* ================= BAŞLANGIÇ ================= */
S.active = newChar('Anlatıcı').id;
refreshDoc(true); renderChars(); showBanner(); renderProjects();
if('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
