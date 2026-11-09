import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg = window.ORTHO_CONFIG || {};
const supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let currentUser = null;
let checkins = [];
let doctors = [];

const SLEEP_LABEL = { achhi: 'Achhi 😴', beech: 'Beech wali', kharab: 'Kharab 😖' };
const STUDY_LABEL = { koi_nahi: 'Padhai par koi asar nahi', thoda: 'Padhai par thoda asar', zyada: 'Padhai par zyada asar' };

function localDateStr(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fmtDate(ds) {
  if (!ds) return '';
  const d = new Date(ds + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}
function msg(el, text, isErr = false) {
  el.textContent = text;
  el.classList.toggle('err', isErr);
}

/* ================= SERVICE WORKER ================= */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

/* ================= AUTH ================= */
async function init() {
  $('#guideBody').innerHTML = window.GUIDE_HTML || '';
  const { data } = await supabase.auth.getSession();
  setUser(data.session?.user ?? null);
  supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
}

async function setUser(user) {
  currentUser = user;
  const loggedIn = !!user;
  $('#loginView').hidden = loggedIn;
  $('#appView').hidden = !loggedIn;
  if (loggedIn) {
    $('#userEmailLine').textContent = 'Login: ' + (user.email || '');
    await afterLogin();
  }
}

let seeded = false;
async function afterLogin() {
  await ensureSeedCheckin();
  await loadEverything();
  if (!seeded) { seeded = true; startChat(true); }
}

async function ensureSeedCheckin() {
  // Ahmad ka asal pehla record (WhatsApp se, 2026-11-09): naak band 4. Sirf tab jodo jab us din ka koi record na ho.
  const { data } = await supabase.from('checkins').select('id').eq('date', '2026-11-09').maybeSingle();
  if (!data) {
    await supabase.from('checkins').insert({
      user_id: currentUser.id, date: '2026-11-09', nose: 4,
      note: 'Pehla record — WhatsApp par bataya tha (9 Nov, shaam).'
    });
  }
}

$('#magicForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#emailInput').value.trim();
  const btn = $('#magicBtn');
  btn.disabled = true; btn.textContent = 'Bhej raha hai…';
  const { error } = await supabase.auth.signInWithOtp({
    email, options: { emailRedirectTo: window.location.origin + '/' }
  });
  btn.disabled = false; btn.textContent = 'Login link bhejo';
  if (error) msg($('#magicMsg'), 'Link nahi gaya — email phir se check karke try karo.', true);
  else msg($('#magicMsg'), '✅ Link bhej diya hai! Apna email kholo aur link par tap karo.');
});

$('#logoutBtn').addEventListener('click', async () => { await supabase.auth.signOut(); location.reload(); });

/* ================= TABS ================= */
$$('.tab-btn').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
function switchTab(tab) {
  $$('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab-page').forEach((p) => { p.hidden = p.dataset.page !== tab; });
  if (tab === 'record') renderRecord();
  if (tab === 'checkin') loadFormForDate($('#fDate').value || localDateStr());
  window.scrollTo({ top: 0 });
}

/* ================= DATA ================= */
async function loadEverything() {
  const [c, d, p] = await Promise.all([
    supabase.from('checkins').select('*').order('date', { ascending: false }).limit(120),
    supabase.from('doctors').select('*').order('created_at', { ascending: true }),
    supabase.from('profiles').select('*').maybeSingle()
  ]);
  checkins = c.data || [];
  doctors = d.data || [];
  if (!doctors.length) { await seedDoctors(); }
  if (p.data) {
    $('#pMed').value = p.data.medicine_name || '';
    $('#pMedTime').value = p.data.medicine_timing || '';
    $('#pNote').value = p.data.note || '';
  }
  $('#fDate').value = localDateStr();
  loadFormForDate(localDateStr());
  renderDoctors();
  renderRecord();
}

async function seedDoctors() {
  const defaults = [
    { name: 'Dr. Samresh Kashyap', detail: 'MS-ENT · 21 saal ka tajurba', place: 'Shankar Niwas, Nasriganj Road, Bikramganj 802212 (Dehri + Sasaram bhi)', phone: '+917982192014', note: 'Pehle phone karke Bikramganj wala din confirm karna.' },
    { name: 'Dr. Manoranjan Kumar', detail: 'MS-ENT · 23 saal ka tajurba', place: 'Pinnacle Hospital, Rajendra Nagar, Patna', phone: '9304956487', note: '' },
    { name: 'AIIMS Patna — ENT OPD', detail: 'Sarkaari hospital · ENT department', place: 'AIIMS Patna', phone: '+916122451070', note: 'OPD Mon–Fri, subah 08:00–12:30. Online registration: ors.gov.in' }
  ];
  const rows = defaults.map((x) => ({ ...x, user_id: currentUser.id }));
  const { data } = await supabase.from('doctors').insert(rows).select();
  doctors = data || defaults;
}

async function saveCheckin(payload) {
  payload.user_id = currentUser.id;
  const { error } = await supabase.from('checkins').upsert(payload, { onConflict: 'user_id,date' });
  if (error) throw error;
  const { data } = await supabase.from('checkins').select('*').order('date', { ascending: false }).limit(120);
  checkins = data || [];
}

/* ================= CHECK-IN FORM ================= */
let formSleep = null;
$$('#sleepChips .chip').forEach((ch) => ch.addEventListener('click', () => {
  formSleep = ch.dataset.val;
  $$('#sleepChips .chip').forEach((c) => c.classList.toggle('sel', c === ch));
}));
$('#fNose').addEventListener('input', (e) => { $('#noseVal').textContent = e.target.value; });
$('#fHead').addEventListener('input', (e) => { $('#headVal').textContent = e.target.value; });
$('#fDate').addEventListener('change', (e) => loadFormForDate(e.target.value));

function loadFormForDate(dateStr) {
  const row = checkins.find((r) => r.date === dateStr);
  formSleep = row?.sleep ?? null;
  $$('#sleepChips .chip').forEach((c) => c.classList.toggle('sel', c.dataset.val === formSleep));
  $('#fNose').value = row?.nose ?? 0; $('#noseVal').textContent = row?.nose ?? 0;
  $('#fHead').value = row?.headache ?? 0; $('#headVal').textContent = row?.headache ?? 0;
  $('#fStudy').value = row?.study_impact ?? '';
  $('#fNote').value = row?.note ?? '';
  $('#checkinTitle').textContent = dateStr === localDateStr() ? 'Aaj ka check-in' : 'Check-in badlo — ' + fmtDate(dateStr);
}

$('#checkinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#saveCheckinBtn');
  btn.disabled = true; btn.textContent = 'Save ho raha hai…';
  try {
    await saveCheckin({
      date: $('#fDate').value,
      sleep: formSleep,
      nose: parseInt($('#fNose').value, 10),
      headache: parseInt($('#fHead').value, 10),
      study_impact: $('#fStudy').value || null,
      note: $('#fNote').value.trim() || null
    });
    msg($('#checkinMsg'), '✅ Save ho gaya!');
  } catch { msg($('#checkinMsg'), 'Save nahi hua — net check karke phir try karo.', true); }
  btn.disabled = false; btn.textContent = 'Save karo';
});

/* ================= RECORD ================= */
function renderRecord() {
  const list = $('#historyList');
  const sum = $('#recordSummary');
  if (!checkins.length) {
    sum.innerHTML = '';
    $('#chartCard').hidden = true;
    list.innerHTML = '<div class="empty-box">Abhi koi record nahi hai.<br>Pehla check-in Chat ya Check-in tab se karo 🌿</div>';
    return;
  }
  const withNums = checkins.filter((r) => r.nose != null || r.headache != null);
  const avg = (k) => {
    const v = withNums.map((r) => r[k]).filter((x) => x != null);
    return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '—';
  };
  const worst = withNums.length
    ? withNums.reduce((a, b) => ((b.nose || 0) + (b.headache || 0) > (a.nose || 0) + (a.headache || 0) ? b : a))
    : null;
  sum.innerHTML = `
    <div class="sum-card"><div class="sum-num">${avg('nose')}</div><div class="sum-label">Average naak band /10</div></div>
    <div class="sum-card"><div class="sum-num">${avg('headache')}</div><div class="sum-label">Average sar dard /10</div></div>
    <div class="sum-card"><div class="sum-num">${checkins.length}</div><div class="sum-label">Kul din ka record</div></div>
    <div class="sum-card"><div class="sum-num" style="font-size:19px;padding-top:5px">${worst ? fmtDate(worst.date) : '—'}</div><div class="sum-label">Sabse kharab din</div></div>`;
  renderChart(withNums);
  list.innerHTML = checkins.map((r) => `
    <div class="hist-item">
      <div class="hist-top"><span class="hist-date">${fmtDate(r.date)}</span></div>
      <div class="hist-nums">👃 Naak band: <b>${r.nose ?? '—'}/10</b> · 🤕 Sar dard: <b>${r.headache ?? '—'}/10</b>${r.sleep ? ' · Neend: ' + SLEEP_LABEL[r.sleep] : ''}${r.study_impact ? '<br>' + STUDY_LABEL[r.study_impact] : ''}</div>
      ${r.note ? `<div class="hist-note">📝 ${escapeHtml(r.note)}</div>` : ''}
      <div class="hist-actions">
        <button class="btn-small" data-edit="${r.date}">✏️ Badlo</button>
        <button class="btn-small danger" data-del="${r.date}">🗑️ Mitao</button>
      </div>
    </div>`).join('');
  list.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    $('#fDate').value = b.dataset.edit; switchTab('checkin');
  }));
  list.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(fmtDate(b.dataset.del) + ' ka record mita dun?')) return;
    await supabase.from('checkins').delete().eq('user_id', currentUser.id).eq('date', b.dataset.del);
    checkins = checkins.filter((r) => r.date !== b.dataset.del);
    renderRecord();
  }));
}

function renderChart(rowsAsc) {
  const rows = [...rowsAsc].sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
  const card = $('#chartCard');
  if (rows.length < 2) { card.hidden = true; return; }
  card.hidden = false;
  const W = 320, H = 150, P = 24;
  const X = (i) => P + (i * (W - 2 * P)) / (rows.length - 1);
  const Y = (v) => H - P - (v / 10) * (H - 2 * P);
  const line = (k, color) => {
    const pts = rows.map((r, i) => (r[k] == null ? null : `${X(i)},${Y(r[k])}`)).filter(Boolean).join(' ');
    const dots = rows.map((r, i) => (r[k] == null ? '' : `<circle cx="${X(i)}" cy="${Y(r[k])}" r="3.2" fill="${color}"/>`)).join('');
    return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>${dots}`;
  };
  const grid = [0, 5, 10].map((v) => `<line x1="${P}" y1="${Y(v)}" x2="${W - P}" y2="${Y(v)}" stroke="#E4EAE6"/><text x="2" y="${Y(v) + 4}" font-size="9" fill="#5C6B64">${v}</text>`).join('');
  $('#chartWrap').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Naak band aur sar dard ka pattern chart">${grid}${line('nose', '#0B6E4F')}${line('headache', '#D97706')}</svg>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ================= DOCTORS ================= */
function renderDoctors() {
  const wrap = $('#doctorList');
  if (!doctors.length) {
    wrap.innerHTML = '<div class="empty-box">Abhi koi doctor nahi hai.<br>Neeche apna doctor jodo 👇</div>';
    return;
  }
  wrap.innerHTML = doctors.map((d) => `
    <div class="doc-card">
      <div class="doc-name">${escapeHtml(d.name)}</div>
      ${d.detail ? `<div class="doc-detail">${escapeHtml(d.detail)}</div>` : ''}
      ${d.place ? `<div class="doc-place">📍 ${escapeHtml(d.place)}</div>` : ''}
      ${d.note ? `<div class="doc-note">📝 ${escapeHtml(d.note)}</div>` : ''}
      <div class="doc-actions">
        ${d.phone ? `<a class="btn-call" href="tel:${escapeHtml(d.phone.replace(/\s/g, ''))}">📞 Call karo</a>` : ''}
        <button class="btn-small danger" data-doc-del="${d.id}">🗑️ Mitao</button>
      </div>
    </div>`).join('');
  wrap.querySelectorAll('[data-doc-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Ye doctor entry mita dun?')) return;
    await supabase.from('doctors').delete().eq('id', b.dataset.docDel).eq('user_id', currentUser.id);
    doctors = doctors.filter((x) => String(x.id) !== b.dataset.docDel);
    renderDoctors();
  }));
}

$('#doctorForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    user_id: currentUser.id,
    name: $('#dName').value.trim(),
    detail: $('#dDetail').value.trim() || null,
    place: $('#dPlace').value.trim() || null,
    phone: $('#dPhone').value.trim() || null,
    note: $('#dNote').value.trim() || null
  };
  const { data, error } = await supabase.from('doctors').insert(payload).select().single();
  if (error) { msg($('#doctorMsg'), 'Doctor add nahi hua — phir try karo.', true); return; }
  doctors.push(data);
  e.target.reset();
  msg($('#doctorMsg'), '✅ Doctor add ho gaya!');
  renderDoctors();
});

/* ================= PROFILE ================= */
$('#profileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { error } = await supabase.from('profiles').upsert({
    user_id: currentUser.id,
    medicine_name: $('#pMed').value.trim() || null,
    medicine_timing: $('#pMedTime').value.trim() || null,
    note: $('#pNote').value.trim() || null,
    updated_at: new Date().toISOString()
  });
  msg($('#profileMsg'), error ? 'Save nahi hua — phir try karo.' : '✅ Save ho gaya!', !!error);
});

/* ================= PUSH ================= */
function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

$('#pushBtn').addEventListener('click', async () => {
  const out = $('#pushMsg');
  try {
    if (!('PushManager' in window)) { msg(out, 'Is browser me push support nahi hai. App ko home screen par add karke kholo, phir try karo.', true); return; }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { msg(out, 'Permission nahi mili. Phone ki Settings → Apps → Ortho → Notifications se ON kar sakte ho.', true); return; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(cfg.VAPID_PUBLIC_KEY)
      });
    }
    const j = sub.toJSON();
    const { error } = await supabase.from('push_subscriptions').upsert({
      user_id: currentUser.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth
    }, { onConflict: 'endpoint' });
    if (error) throw error;
    msg(out, '✅ Notifications ON ho gayi! Roz subah pyaar bhari yaad aayegi 🌤️');
    $('#pushBtn').textContent = 'Notifications ON hai ✅';
  } catch { msg(out, 'Kuch gadbad hui — thodi der baad phir try karo.', true); }
});

/* ================= CHAT (guided check-in, rule-based) ================= */
const chatLog = $('#chatLog');
const chatChips = $('#chatChips');
let chatState = 'idle';
let draft = {};

function botSay(text, delay = 300) {
  return new Promise((res) => setTimeout(() => {
    const div = document.createElement('div');
    div.className = 'msg bot'; div.textContent = text;
    chatLog.appendChild(div); scrollChat(); res();
  }, delay));
}
function meSay(text) {
  const div = document.createElement('div');
  div.className = 'msg me'; div.textContent = text;
  chatLog.appendChild(div); scrollChat();
}
function scrollChat() { window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }
function setChips(items, onPick, asGrid = false) {
  chatChips.innerHTML = '';
  chatChips.className = 'chat-chips' + (asGrid ? ' num-grid' : '');
  items.forEach((it) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = it.label;
    b.addEventListener('click', () => { chatChips.innerHTML = ''; onPick(it); });
    chatChips.appendChild(b);
  });
  scrollChat();
}
const numChips = (cb) => setChips(
  Array.from({ length: 11 }, (_, i) => ({ label: String(i), val: i })),
  (it) => { meSay(String(it.val)); cb(it.val); }, true);

async function startChat(first = false) {
  chatLog.innerHTML = ''; chatChips.innerHTML = ''; draft = {}; chatState = 'start';
  const today = checkins.find((r) => r.date === localDateStr());
  await botSay('Assalamualaikum Ahmad 🌤️ Main Ortho — tumhara health saathi.', first ? 150 : 100);
  if (today && (today.nose != null || today.sleep)) {
    await botSay(`Aaj ka check-in pehle se hai ✅ (Naak band ${today.nose ?? '—'}/10, sar dard ${today.headache ?? '—'}/10). Update karna hai?`);
    setChips([
      { label: 'Haan, update karo', val: 'yes' },
      { label: 'Nahi, rehne do', val: 'no' }
    ], async (it) => {
      meSay(it.label);
      if (it.val === 'yes') askSleep();
      else { chatState = 'idle'; await botSay('Theek hai 🌿 Jab mann ho, "check-in" likh bhej dena — main phir se puchh lunga.'); }
    });
  } else {
    await botSay('Aaj ka chhota sa check-in kar lete hain — bas 3 sawal, 1 minute lagega. 🌿');
    askSleep();
  }
}

async function askSleep() {
  chatState = 'sleep';
  await botSay('Pehle ye batao — raat ko neend kaisi thi?');
  setChips([
    { label: 'Achhi 😴', val: 'achhi' },
    { label: 'Beech wali', val: 'beech' },
    { label: 'Kharab 😖', val: 'kharab' }
  ], (it) => { meSay(it.label); draft.sleep = it.val; askNose(); });
}

async function askNose() {
  chatState = 'nose';
  await botSay('Ab naak ka haal — abhi naak kitni band lag rahi hai?\n(0 = bilkul khuli, 10 = poori band)');
  numChips((v) => { draft.nose = v; askHead(); });
}

async function askHead() {
  chatState = 'head';
  await botSay('Aur sar dard? (0 = bilkul nahi, 10 = sabse tez)');
  numChips((v) => { draft.headache = v; askNote(); });
}

async function askNote() {
  chatState = 'note';
  await botSay('Koi chhota note hai aaj ke liye? Neeche likh sakte ho — ya "Note nahi hai" tap kar do.');
  setChips([{ label: 'Note nahi hai', val: 'skip' }], async (it) => { meSay(it.label); finishChat(null); });
}

async function finishChat(noteText) {
  chatState = 'saving';
  await botSay('Ek second — save kar raha hun…', 150);
  try {
    await saveCheckin({ date: localDateStr(), sleep: draft.sleep ?? null, nose: draft.nose, headache: draft.headache, note: noteText || null });
  } catch { await botSay('Arey — save nahi hua 😔 Net check karke "check-in" likh kar phir try karna.'); chatState = 'idle'; return; }
  chatState = 'idle';
  await botSay(`Ho gaya ✅\nAaj ka record: Neend ${draft.sleep ? SLEEP_LABEL[draft.sleep] : '—'} · Naak band ${draft.nose}/10 · Sar dard ${draft.headache}/10`);
  await botSay(tipFor(draft.nose, draft.headache));
}

function tipFor(nose, head) {
  if (nose >= 8 || head >= 8) {
    return '⚠️ Ahmad, ye number zyada hai. Guide ke khatre wale sanket yaad rakhna — aankh ke aas-paas soojan, tez bukhaar ya saans lene me dikkat ho to der bilkul mat karna: ghar par batao aur doctor ko dikhao.\nAaram ke liye: garam bhaap (steam) lo, aur saline (namak paani) se naak saaf karna madad karta hai.';
  }
  if (nose >= 5) {
    return 'Naak kaafi band hai aaj 🤧 Sone se pehle bhaap (steam) ya saline rinse try karo, aur sir thoda uncha karke sona — raat ko band-pan kam lagega, neend gehri hogi to kal ki padhai bhi sambhalegi.';
  }
  if (nose >= 1) {
    return 'Halki band hai — sambhal jayegi 🌿 Kamre ki dhool saaf rakhna aur thandi hawa seedha chehre par na lage, bas itna dhyaan kaafi hai.';
  }
  return 'Aaj naak bilkul saaf hai 🎉 Aise din hi badhne chahiye. Padhai par poora dhyaan do — Ortho record sambhal raha hai.';
}

$('#chatSend').addEventListener('click', sendChatText);
$('#chatText').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChatText(); });
async function sendChatText() {
  const inp = $('#chatText');
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  if (chatState === 'note') { meSay(text); finishChat(text); return; }
  if (/check-?in/i.test(text) && (chatState === 'idle')) { meSay(text); startChat(); return; }
  meSay(text);
  await botSay('Main abhi guided check-in mode me hun 😊 Upar ke options se jawab do — ya naya check-in chahiye to "check-in" likho.');
}

init();
