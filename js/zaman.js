/* Hikâye Stüdyosu — zaman çizelgesi.
   Ses zarfından ve cümle metinlerinden; ağız şekillerini, kelime zamanlarını, altyazı sayfalarını üretir.
   Saf fonksiyonlar: aynı girdi her zaman aynı çıktıyı verir (önizleme = video, yarıda kalan iş aynen devam eder). */

export const FPS = 30;

/* Türkçe yazıldığı gibi okunur: harften ağız şekline doğrudan geçilebilir.
   w: genişlik çarpanı, h: açıklık, d: göreli süre, c: dudaklar kapalı */
const VOWEL = { a:[.95, 1], e:[1, .7], i:[1.05, .45], 'ı':[.9, .45], o:[.62, .85], 'ö':[.62, .8], u:[.48, .5], 'ü':[.48, .5], 'â':[.95, 1], 'î':[1.05, .45], 'û':[.48, .5] };
function shapeOf(ch){
  const v = VOWEL[ch];
  if(v) return { w:v[0], h:v[1], d:1, c:0 };
  if(ch === 'm' || ch === 'b' || ch === 'p') return { w:.8, h:0, d:.55, c:1 };
  if(ch === 'f' || ch === 'v') return { w:.82, h:.14, d:.6, c:0 };
  if(/\p{L}/u.test(ch)) return { w:.86, h:.3, d:.6, c:0 };
  if(/\d/.test(ch)) return { w:.9, h:.6, d:2.2, c:0 };        // rakamın okunuşu uzundur
  if(/\s/.test(ch)) return { w:.8, h:.05, d:.2, c:0 };
  return { w:.8, h:0, d:.35, c:0 };                             // noktalama
}

/* Bir cümlenin harflerini, cümlenin ses aralığındaki SESLİ karelere dağıtır.
   Sessiz kareler (virgül duraklamaları) çok az pay alır; böylece harfler konuşulan yere denk gelir. */
function alignLine(text, env, f0, f1, W, Hh, C){
  const orig = Array.from(text), shapes = [], U = new Float32Array(orig.length + 1);
  for(let k = 0; k < orig.length; k++){ const sh = shapeOf(orig[k].toLocaleLowerCase('tr')[0]); shapes.push(sh); U[k + 1] = U[k] + sh.d; }
  const Ut = U[orig.length] || 1, nf = f1 - f0, cum = new Float32Array(nf + 1);
  for(let f = 0; f < nf; f++) cum[f + 1] = cum[f] + (env[f0 + f] > .04 ? 1 : .12);
  const Wt = cum[nf] || 1;
  let k = 0;
  for(let f = 0; f < nf && shapes.length; f++){
    const q = (cum[f] + cum[f + 1])/2/Wt*Ut;
    while(k < shapes.length - 1 && U[k + 1] <= q) k++;
    const sh = shapes[k]; W[f0 + f] = sh.w; Hh[f0 + f] = sh.h; C[f0 + f] = sh.c;
  }
  const tAt = u => {
    if(nf <= 0) return f0/FPS;
    const target = u/Ut*Wt; let lo = 0, hi = nf;
    while(lo < hi){ const mid = (lo + hi) >> 1; if(cum[mid + 1] < target) lo = mid + 1; else hi = mid; }
    if(lo >= nf) return f1/FPS;
    return (f0 + lo + (target - cum[lo])/((cum[lo + 1] - cum[lo]) || 1))/FPS;
  };
  const words = []; let a = -1;
  for(let j = 0; j <= orig.length; j++){
    const sp = j === orig.length || /\s/.test(orig[j]);
    if(!sp && a < 0) a = j;
    if(sp && a >= 0){ words.push({ w:orig.slice(a, j).join(''), s:tAt(U[a]), e:tAt(U[j]) }); a = -1; }
  }
  return words;
}
function smooth(x){
  let p = x[0];
  for(let i = 0; i < x.length; i++){ const c = x[i], n = i + 1 < x.length ? x[i + 1] : c; x[i] = p*.25 + c*.5 + n*.25; p = c; }
}

/* lines[i].s / .e (saniye) dolu olmalı. Her cümleye .words ekler; kare başına ağız ve duygu izlerini döndürür. */
export function buildTimeline(lines, env){
  const n = env.length, w = new Float32Array(n).fill(.8), h = new Float32Array(n), c = new Uint8Array(n);
  const clamp = f => Math.max(0, Math.min(n, f));
  for(const g of lines){
    const f0 = clamp(Math.round(g.s*FPS)), f1 = Math.max(f0, clamp(Math.round(g.e*FPS)));
    g.words = alignLine(g.text, env, f0, f1, w, h, c);
  }
  smooth(w); smooth(h);
  for(let f = 0; f < n; f++) if(c[f]) h[f] = 0;
  const lineIdx = new Int32Array(n).fill(-1);
  for(let f = 0, i = -1; f < n; f++){ const t = f/FPS; while(i + 1 < lines.length && lines[i + 1].s <= t) i++; lineIdx[f] = i; }
  // duygu izleri: hedef duyguya yumuşak geçiş (kare başına sabit adım: zamandan bağımsız, tekrarlanabilir)
  const mood = { uzgun:new Float32Array(n), mutlu:new Float32Array(n), saskin:new Float32Array(n), dusunceli:new Float32Array(n) };
  const k = 1 - Math.exp(-2.1/FPS);
  for(const m in mood){
    let v = 0; const tr = mood[m];
    for(let f = 0; f < n; f++){ const g = lineIdx[f] >= 0 ? lines[lineIdx[f]] : null; v += ((g && g.mood === m ? 1 : 0) - v)*k; tr[f] = v; }
  }
  return { vis:{ w, h, c }, lineIdx, mood };
}

/* Altyazı sayfaları: uzun cümle birkaç sayfaya bölünür, her sayfa kendi kelimelerinin süresince görünür. */
export function pagesOf(lines, maxChars){
  const pages = [];
  lines.forEach((g, li) => {
    let cur = [], len = 0;
    const flush = () => { if(cur.length){ pages.push({ line:li, s:cur[0].s, e:cur[cur.length - 1].e, words:cur }); cur = []; len = 0; } };
    for(const wd of g.words || []){
      const L = Array.from(wd.w).length;
      if(cur.length && len + 1 + L > maxChars) flush();
      cur.push(wd); len += (len ? 1 : 0) + L;
      if(/[.!?…,;:]$/.test(wd.w) && len > maxChars*.6) flush();
    }
    flush();
  });
  pages.forEach((p, i) => {
    const nx = pages[i + 1], hold = lines[p.line].e + .35;
    p.end = Math.max(p.e, nx ? (nx.line === p.line ? nx.s : Math.min(nx.s, hold)) : hold);
  });
  return pages;
}

const two = (n, w = 2) => String(Math.floor(n)).padStart(w, '0');
function srtTime(t){ t = Math.max(0, t); return `${two(t/3600)}:${two(t/60 % 60)}:${two(t % 60)},${two(Math.round((t % 1)*1000) % 1000, 3)}`; }
export function toSRT(pages, lead){
  return pages.map((p, i) => `${i + 1}\n${srtTime(lead + p.s)} --> ${srtTime(lead + p.end)}\n${p.words.map(x => x.w).join(' ')}\n`).join('\n');
}
function clock(t){ t = Math.max(0, Math.floor(t)); const h = Math.floor(t/3600), m = Math.floor(t/60) % 60, s = t % 60; return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`; }
/* YouTube açıklamasına yapıştırılacak bölüm listesi ("## Bölüm adı" satırlarından) */
export function chaptersText(lines, lead){
  const out = [];
  for(const g of lines) if(g.chapter) out.push([out.length ? lead + g.s : 0, g.chapter]);
  return out.map(([t, n]) => clock(t) + ' ' + n).join('\n');
}

/* Kendi ses kaydı: cümle sınırlarını harf oranına göre tahmin eder, sonra en yakın sessizliğe oturtur. */
export function alignToRecording(lines, env){
  const n = env.length, L = lines.length; if(!L || !n) return;
  const voiced = f => env[f] > .04;
  const cum = new Float32Array(n + 1);
  for(let f = 0; f < n; f++) cum[f + 1] = cum[f] + (voiced(f) ? 1 : .05);
  let first = 0, last = n; while(first < n && !voiced(first)) first++; while(last > first && !voiced(last - 1)) last--;
  const gaps = [];                                    // en az ~0,27 sn süren sessizlikler
  for(let f = first, a = -1; f <= last; f++){
    const v = f < last && voiced(f);
    if(!v && a < 0) a = f;
    if(v && a >= 0){ if(f - a >= 8) gaps.push([a, f]); a = -1; }
  }
  const total = lines.reduce((s, g) => s + g.text.length, 0) || 1, Wt = cum[n];
  const starts = [first], ends = [];
  let acc = 0, gi = 0, fp = 0;
  for(let i = 0; i < L - 1; i++){
    acc += lines[i].text.length;
    const target = acc/total*Wt; while(fp < n && cum[fp + 1] < target) fp++;
    let best = -1, bd = 46;                           // ±1,5 sn içinde en yakın sessizlik
    for(let j = gi; j < gaps.length; j++){
      const mid = (gaps[j][0] + gaps[j][1])/2, d = Math.abs(mid - fp);
      if(mid <= starts[i]) continue;
      if(d < bd){ bd = d; best = j; }
      if(mid - fp > 46) break;
    }
    if(best >= 0){ ends.push(gaps[best][0]); starts.push(gaps[best][1]); gi = best + 1; }
    else { const b = Math.max(fp, starts[i] + 1); ends.push(b); starts.push(b); }
  }
  ends.push(last);
  lines.forEach((g, i) => { g.s = Math.min(starts[i], n)/FPS; g.e = Math.max(g.s, Math.min(ends[i], n)/FPS); });
}
