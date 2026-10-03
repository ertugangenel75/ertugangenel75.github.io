/* Hikâye Stüdyosu — senaryo dili.
   Metni proje modeline çevirir: karakterler, sahneler, cümleler ve etiketleri.
   Saf fonksiyonlar; DOM ya da ses kullanmaz, bu yüzden tek başına sınanabilir.

   Söz dizimi:
     # Başlık                        video başlığı
     ## Bölüm adı                    YouTube bölüm işareti (sonraki cümleye bağlanır)
     @Elif: kadın, 30, ses=dfki      karakter tanımı
     == koridor.jpg | düzen: ekran   yeni sahne (sahne görseli adı ya da sırası, isteğe bağlı düzen)
     Elif [üzgün, yakın]: Metin.     konuşan + satırın tamamına etiket
     [mutlu] Cümle.                  yalnızca sonraki cümleye etiket
     [görsel 2] [duraklama 1.5]      görüntü değiştir, bekle
   Etiketsiz düz metin de çalışır; duygu ve kamera otomatik seçilir. */

export const MOODS = ['notr', 'uzgun', 'mutlu', 'saskin', 'dusunceli'];
export const MOOD_TR = { notr:'nötr', uzgun:'üzgün', mutlu:'mutlu', saskin:'şaşkın', dusunceli:'düşünceli' };
export const SHOTS = ['genis', 'orta', 'yakin'];
export const SHOT_TR = { genis:'geniş', orta:'orta', yakin:'yakın' };

const lc = s => String(s).toLocaleLowerCase('tr');
/* Türkçe harfleri sadeleştirilmiş, küçük harfli karşılaştırma anahtarı */
export const key = s => lc(s).replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's')
  .replace(/ü/g, 'u').replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u').replace(/\s+/g, ' ').trim();

const MOOD_KEYS = { notr:'notr', sakin:'notr', normal:'notr', uzgun:'uzgun', huzunlu:'uzgun', mutlu:'mutlu', neseli:'mutlu',
  saskin:'saskin', dusunceli:'dusunceli' };
const SHOT_KEYS = { genis:'genis', uzak:'genis', orta:'orta', yakin:'yakin' };
const LAYOUT_KEYS = { tek:'birlesik', 'tek resim':'birlesik', birlesik:'birlesik', ayri:'karakter', karakter:'karakter',
  ekran:'ekran', sadece:'sadece', goruntu:'sadece' };
const VOICES = { dfki:'tr_TR-dfki-medium', fahrettin:'tr_TR-fahrettin-medium', fettah:'tr_TR-fettah-medium' };

/* "[üzgün, yakın, görsel 2, duraklama 1.5]" içeriğini çözer */
export function parseTags(body){
  const out = { mood:null, shot:null, media:null, pause:0, unknown:[] };
  for(const raw of String(body).split(/\s*,\s*(?!\d)/)){
    const tok = raw.trim(); if(!tok) continue;
    const k = key(tok).replace(/ plan$/, '');
    let m;
    if(MOOD_KEYS[k]) out.mood = MOOD_KEYS[k];
    else if(SHOT_KEYS[k]) out.shot = SHOT_KEYS[k];
    else if((m = key(tok).match(/^(gorsel|goruntu|resim|video)\s*:?\s*(.+)$/))){
      const v = tok.replace(/^\S+?\s*:?\s+|^[^:]+:\s*/, '').trim();
      out.media = v || m[2];
    }
    else if((m = k.match(/^(duraklama|bekle|sus)\s*:?\s*([\d.,]+)?/))) out.pause = Math.min(10, parseFloat((m[2] || '1').replace(',', '.')) || 1);
    else out.unknown.push(tok);
  }
  return out;
}
export function fmtTags(t){
  const a = [];
  if(t.mood) a.push(MOOD_TR[t.mood]);
  if(t.shot) a.push(SHOT_TR[t.shot]);
  if(t.media != null && t.media !== '') a.push('görsel ' + t.media);
  if(t.pause) a.push('duraklama ' + (+t.pause).toFixed(1).replace(/\.0$/, ''));
  return a.length ? '[' + a.join(', ') + ']' : '';
}

/* Cümlelere böler; her cümlenin kaynak metindeki konumunu da verir. Ondalık sayılar (3.5) bölünmez. */
function splitSentences(s){
  const out = [], re = /(?:[^.!?…]|\.(?=\d))+(?:\.\.\.|[.!?…])*["'”’)]*\s*/g; let m;
  while((m = re.exec(s))){
    const txt = m[0].trim(); if(!txt || !/[\p{L}\p{N}]/u.test(txt)) continue;
    const a = m.index + (m[0].length - m[0].trimStart().length);
    if(txt.length <= 220){ out.push({ text:txt, a }); continue; }
    // çok uzun cümle: virgüllerden, çok kısa parçalar bırakmadan böl
    let start = 0; const cm = /,\s+/g; let c;
    while((c = cm.exec(txt))){
      if(c.index + 1 - start >= 70 && txt.length - cm.lastIndex >= 40){ out.push({ text:txt.slice(start, c.index + 1), a:a + start }); start = cm.lastIndex; }
    }
    out.push({ text:txt.slice(start), a:a + start });
  }
  return out;
}

export function parseScript(src, knownNames = []){
  const text = String(src).replace(/\r/g, '');
  const doc = { title:'', chars:[], scenes:[], lines:[], warnings:[] };
  const names = new Map(knownNames.map(n => [key(n), n]));
  const fresh = () => ({ mood:null, shot:null, media:null, pause:0, ranges:[] });
  let pend = fresh(), scene = -1, speaker = null, newPara = true, chapter = null, pos = 0;

  for(const raw of text.split('\n')){
    const ls = pos; pos += raw.length + 1;
    const t = raw.trim();
    if(!t){ newPara = true; continue; }
    let m;
    if((m = t.match(/^##\s*(.+)$/))){ chapter = m[1].trim(); newPara = true; continue; }
    if((m = t.match(/^#\s*(.+)$/))){ if(!doc.title) doc.title = m[1].trim(); continue; }
    if((m = t.match(/^@\s*([^:@]+?)\s*(?::\s*(.*))?$/))){
      const c = { name:m[1].trim(), gender:null, age:null, voice:null, img:null };
      for(const f of (m[2] || '').split(',')){
        const k = key(f); if(!k) continue;
        let v;
        if(k === 'kadin' || k === 'erkek') c.gender = k === 'kadin' ? 'Kadın' : 'Erkek';
        else if(/^\d{1,3}$/.test(k)) c.age = Math.max(15, Math.min(65, +k));
        else if((v = k.match(/^ses\s*[=:]\s*(\w+)/))){ if(VOICES[v[1]]) c.voice = VOICES[v[1]]; else doc.warnings.push('Bilinmeyen ses: ' + f.trim()); }
        else if(/\.(png|jpe?g|webp|gif)$/.test(k)) c.img = f.trim();
        else doc.warnings.push(`"${c.name}" tanımında anlaşılmayan bilgi: ${f.trim()}`);
      }
      if(!names.has(key(c.name))){ names.set(key(c.name), c.name); }
      const old = doc.chars.findIndex(x => key(x.name) === key(c.name));
      if(old >= 0) doc.chars[old] = c; else doc.chars.push(c);
      continue;
    }
    if((m = t.match(/^==+\s*(.*?)\s*=*$/))){
      const parts = m[1].replace(/^sahne\s*:\s*/i, '').split('|').map(x => x.trim());
      const sc = { bg:parts[0] || null, layout:null };
      for(const p of parts.slice(1)){
        const d = key(p).match(/^duzen\s*:?\s*(.+)$/);
        if(d && LAYOUT_KEYS[d[1]]) sc.layout = LAYOUT_KEYS[d[1]]; else doc.warnings.push('Sahne satırında anlaşılmayan bilgi: ' + p);
      }
      doc.scenes.push(sc); scene = doc.scenes.length - 1; newPara = true; continue;
    }

    // içerik satırı: baştaki "Ad [etiket]:" konuşanı belirler (yalnızca tanımlı karakter adlarıyla)
    let content = raw, base = ls, lineTags = null;
    if((m = raw.match(/^(\s*)([^\[\]:]{1,40}?)\s*(\[[^\]\n]*\])?\s*:\s*/)) && names.has(key(m[2]))){
      speaker = key(m[2]); newPara = true;
      lineTags = m[3] ? parseTags(m[3].slice(1, -1)) : null;
      if(lineTags) lineTags.unknown.forEach(u => doc.warnings.push('Bilinmeyen etiket: [' + u + ']'));
      content = raw.slice(m[0].length); base = ls + m[0].length;
    }
    const re = /\[([^\]\n]*)\]/g; let last = 0, first = true, tg;
    const addText = (a, b) => {
      for(const s of splitSentences(content.slice(a, b))){
        const lt = lineTags || {};
        doc.lines.push({
          text:s.text, speaker, scene, chapter,
          tagMood: pend.mood || lt.mood || null, tagShot: pend.shot || lt.shot || null,
          media: pend.media != null ? pend.media : (first && lt.media != null ? lt.media : null),
          pause: (pend.pause || 0) + (first ? (lt.pause || 0) : 0),
          paraStart: newPara && doc.lines.length > 0,
          pos: base + a + s.a, tagRanges: pend.ranges,
          inline: { mood:pend.mood, shot:pend.shot, media:pend.media, pause:pend.pause }
        });
        pend = fresh(); newPara = false; first = false; chapter = null;
      }
    };
    while((tg = re.exec(content))){
      if(tg.index > last) addText(last, tg.index);
      const p = parseTags(tg[1]);
      p.unknown.forEach(u => doc.warnings.push('Bilinmeyen etiket: [' + u + ']'));
      if(p.mood) pend.mood = p.mood;
      if(p.shot) pend.shot = p.shot;
      if(p.media != null) pend.media = p.media;
      if(p.pause) pend.pause += p.pause;
      pend.ranges.push([base + tg.index, base + re.lastIndex, base === ls && /^(\s*\[[^\]\n]*\]\s*)+$/.test(raw)]);
      last = re.lastIndex;
    }
    if(last < content.length) addText(last, content.length);
  }
  doc.lines.forEach((g, i) => { const nx = doc.lines[i + 1]; g.paraEnd = !nx || nx.paraStart; });
  return doc;
}

/* Bir cümlenin etiketlerini kaynak metinde değiştirir (kart düzenleyicisi bunu kullanır).
   Eski etiket parçaları silinir, cümlenin başına tek bir birleşik etiket yazılır. */
export function setLineTags(src, line, tags){
  let text = String(src).replace(/\r/g, ''), pos = line.pos;
  const spans = [];
  for(const [a, b, whole] of line.tagRanges){
    let A = a, B = b;
    if(whole){ A = text.lastIndexOf('\n', a - 1) + 1; B = text.indexOf('\n', b); B = B < 0 ? text.length : B + 1; }
    else while(text[B] === ' ') B++;
    spans.push([A, B]);
  }
  spans.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for(const sp of spans){ const l = merged[merged.length - 1]; if(l && sp[0] <= l[1]) l[1] = Math.max(l[1], sp[1]); else merged.push([sp[0], sp[1]]); }
  for(const [A, B] of merged.reverse()){
    text = text.slice(0, A) + text.slice(B);
    if(A < pos) pos -= Math.min(B, pos) - A;
  }
  const tag = fmtTags(tags);
  return text.slice(0, pos) + (tag ? tag + ' ' : '') + text.slice(pos);
}

/* ================= DUYGU TESPİTİ =================
   "kök*" kelime başında aranır, boşluk içeren girdiler ifade olarak, diğerleri tam kelime olarak eşleşir.
   Böylece "acıktım" üzgün, "yasa" yas sayılmaz. */
const LEX = {
  uzgun: ['ağla*', 'gözyaş*', 'üzgün*', 'üzül*', 'üzdü*', 'hüzün*', 'hüzn*', 'acı', 'acıyı', 'acısı', 'acısını', 'acılar', 'acıyla', 'acıdan',
    'öldü*', 'ölüm*', 'vefat*', 'kaybett*', 'kaybı*', 'yalnızlı*', 'yalnızdı*', 'yalnızım', 'kork*', 'pişman*', 'kırıldı*', 'kırgın*', 'keder*',
    'yas', 'yası', 'yasını', 'yasta', 'özle*', 'veda*', 'ayrıl*', 'yıkıl*', 'çaresiz*', 'umutsuz*', 'dert*', 'sancı*', 'yaralı*', 'mezar*', 'cenaze*', 'gitti artık'],
  mutlu: ['mutlu*', 'sevin*', 'güldü*', 'gülüm*', 'gülerek', 'harika*', 'başard*', 'kazand*', 'sevgi*', 'umut', 'umudu*', 'umutla*', 'umutlu*',
    'teşekkür*', 'neşe*', 'kahkaha*', 'huzur*', 'şükür*', 'muhteşem*', 'sarıld*', 'iyi ki', 'çok güzel'],
  saskin: ['birden', 'birdenbire', 'aniden', 'inanama*', 'şaşır*', 'şaşkın*', 'şok', 'şoka', 'şoke', 'meğer*', 'hayret*', 'donup', 'donakal*', 'bir anda', 'ne göreyim'],
  dusunceli: ['hatırl*', 'düşün*', 'belki', 'acaba', 'bilmiyorum', 'merak*', 'çocukken', 'yıllar önce', 'o zamanlar']
};
export function moodOf(s){
  const words = lc(s).match(/[\p{L}]+/gu) || [], joined = ' ' + words.join(' ') + ' ';
  let best = 'notr', bs = 0;
  for(const m in LEX){
    let sc = 0;
    for(const e of LEX[m]){
      if(e.includes(' ')){ if(joined.includes(' ' + e)) sc++; }
      else if(e.endsWith('*')){ const st = e.slice(0, -1); if(words.some(w => w.startsWith(st))) sc++; }
      else if(words.includes(e)) sc++;
    }
    if(m === 'saskin' && /!/.test(s)) sc += .6;
    if(sc > bs){ bs = sc; best = m; }
  }
  return best;
}

/* ================= YÖNETMEN KURALLARI =================
   Her cümleye duygu ve plan atar. Etiket varsa otomatik seçimin önüne geçer. */
const ZOOM = { genis:1, orta:1.15, yakin:1.32 };
export function direct(lines){
  let prev = 'notr', carry = 0, n = 0;
  const cycle = ['genis', 'orta', 'yakin', 'orta'];
  lines.forEach((g, i) => {
    let m = moodOf(g.text);
    if(m === 'notr' && prev !== 'notr' && carry < 2){ m = prev; carry++; } else carry = 0;
    g.autoMood = m; g.mood = g.tagMood || m; prev = g.mood;
    const p = lines[i - 1];
    g.cut = i > 0 && (g.paraStart || g.speaker !== p.speaker || g.scene !== p.scene);
    let shot;
    if(i === 0 || g.cut){ shot = 'genis'; n = 0; }
    else if(g.mood === 'uzgun' || g.mood === 'saskin') shot = 'yakin';
    else { n++; shot = cycle[Math.floor(n/2) % cycle.length]; }
    g.autoShot = shot; g.shot = g.tagShot || shot; g.zoom = ZOOM[g.shot];
  });
  return lines;
}
