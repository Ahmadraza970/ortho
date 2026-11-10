import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg = window.ORTHO_CONFIG || {};
const supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: window.localStorage }
});

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let currentUser = null;

// Login wale user ka pehla naam (Google account se) — greeting me sirf wahi
// naam aayega jo user ka apna hai. Naam na mile to greeting bina naam ki.
// (Ahmad ka naam hardcode tha — dusra koi install kare to use bhi "Ahmad"
// dikhta tha. Bug pakda Ahmad ne khud, 2026-11-10.)
function myFirstName() {
  try {
    const md = (currentUser && currentUser.user_metadata) || {};
    const full = String(md.full_name || md.name || '').trim();
    const first = full.split(/\s+/)[0] || '';
    return /^[A-Za-zÀ-ɏ]{2,20}$/.test(first) ? first : '';
  } catch { return ''; }
}
function greetingLine() {
  const nm = myFirstName();
  return `Assalamualaikum${nm ? ' ' + nm : ''} 🌤️ Main Ortho — tumhara health saathi.`;
}
let checkins = [];
let doctors = [];
let profileData = null;

const SLEEP_LABEL = { achhi: 'Achhi 😴', beech: 'Beech wali', kharab: 'Kharab 😖' };
const STUDY_LABEL = { koi_nahi: 'Padhai par koi asar nahi', thoda: 'Padhai par thoda asar', zyada: 'Padhai par zyada asar' };
/* Logged-out chat check-in ka device-local record (date-stamped). Login hone par
   mergeLocalCheckin() ise account ke daily record me mila deta hai. */
const LOCAL_CHECKIN_KEY = 'ortho_local_checkin_v1';

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

/* ================= AUTH =================
   Ek hi auth init: getSession() ek baar + onAuthStateChange.
   App hamesha khula rehta hai — Chat aur Guide bina login ke chalte hain.
   Login sirf data wale kaam (check-in save, record, doctors, profile) ke liye
   chahiye; logged-out haalat me ek inline login card dikhta hai — full-screen
   wall kabhi nahi, aur tab badalne par dobara kabhi nahi. */
let loginDismissed = false;
let lastUid = null;
let chatWelcomed = false;

/* OAuth / magic-link return par URL me error aa sakta hai (error= / error_description,
   query ya hash me). Raw error kabhi nahi dikhana — login card dikha do aur URL saaf
   kar do taaki reload par dobara na aaye. detectSessionInUrl client init me true hai,
   isiliye safal returns (tokens) Supabase khud sambhal leta hai; hum sirf error case
   dekhte hain aur tokens wale URL ko haath nahi lagate. */
let authUrlError = false;
function cleanAuthErrorFromUrl() {
  const q = new URLSearchParams(window.location.search);
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  if (q.get('error') || q.get('error_description') || h.get('error') || h.get('error_description')) {
    authUrlError = true;
    history.replaceState(null, '', window.location.pathname);
  }
}

async function init() {
  cleanAuthErrorFromUrl();
  $('#guideBody').innerHTML = window.GUIDE_HTML || '';
  const { data } = await supabase.auth.getSession();
  await setUser(data.session?.user ?? null);
  supabase.auth.onAuthStateChange((_e, session) => { setUser(session?.user ?? null); });
  if (authUrlError && !currentUser) {
    $('#loginCard').hidden = false;
    window.scrollTo({ top: 0 });
  }
}

async function setUser(user) {
  currentUser = user;
  const loggedIn = !!user;
  $('#loginCard').hidden = loggedIn || loginDismissed;
  $$('.login-needed').forEach((el) => { el.hidden = loggedIn; });
  $$('.auth-content').forEach((el) => { el.hidden = !loggedIn; });
  if (loggedIn) {
    $('#userEmailLine').textContent = 'Login: ' + (user.email || '');
    renderGoogleLink(user);
    if (lastUid !== user.id) { lastUid = user.id; await afterLogin(); }
  } else {
    lastUid = null;
    if (!chatWelcomed) { chatWelcomed = true; restoreChatHistory(); chatWelcome(); }
  }
}

function showLoginCard() {
  loginDismissed = false;
  if (!currentUser) $('#loginCard').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* Profile tab ka Google-link state: user.identities me provider 'google' ho to
   account pehle se juda hai — button ki jagah sirf status dikhega. */
function renderGoogleLink(user) {
  const state = $('#googleLinkState');
  const btn = $('#googleLinkBtn');
  if (!state || !btn || !user) return;
  const linked = (user.identities || []).some((i) => i.provider === 'google');
  if (linked) {
    state.textContent = 'Google account: juda hua hai ✓';
    btn.hidden = true;
  } else {
    state.textContent = 'Google account: joda nahi hai';
    btn.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Google jodo';
  }
}

$('#loginDismiss').addEventListener('click', () => { loginDismissed = true; $('#loginCard').hidden = true; });
$$('.show-login-btn').forEach((b) => b.addEventListener('click', showLoginCard));

let seeded = false;
async function afterLogin() {
  // OAuth/link return ke baad identities taze (fresh) user se padho — session wala
  // user object kabhi-kabhi purana ho sakta hai, Profile ka Google state isi par tikta hai.
  const { data: fresh } = await supabase.auth.getUser();
  if (fresh?.user) { currentUser = fresh.user; renderGoogleLink(fresh.user); }
  await ensureSeedCheckin();
  await mergeLocalCheckin();
  await migrateLocalChatHistory();
  await loadEverything();
  await restoreChatHistory();
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

/* Logged-out haalat me chat check-in device par (localStorage, date-stamped) save
   hota hai. Login hote hi wahi record account me merge kar do — taaki chat aur
   form ek hi daily record rakhein. Server par us din ka record pehle se ho to
   use chhuo mat, sirf local copy hata do. */
async function mergeLocalCheckin() {
  let rec = null;
  try { rec = JSON.parse(localStorage.getItem(LOCAL_CHECKIN_KEY) || 'null'); } catch { rec = null; }
  if (!rec || !rec.date) return;
  try {
    const { data } = await supabase.from('checkins').select('id').eq('date', rec.date).maybeSingle();
    if (!data) {
      await supabase.from('checkins').insert({
        user_id: currentUser.id, date: rec.date,
        sleep: rec.sleep ?? null, nose: rec.nose ?? null, headache: rec.headache ?? null,
        note: rec.note ?? null
      });
    }
    localStorage.removeItem(LOCAL_CHECKIN_KEY);
  } catch { /* merge na ho paye to local record bana rehne do — agle login par phir koshish hogi */ }
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
  else {
    msg($('#magicMsg'), '✅ Link bhej diya hai! Apna email kholo aur link par tap karo.');
    // Usi email me 6 number ka code bhi aata hai — link scan ho jaye to code se
    // turant login ho sakta hai; hint dikhao aur code wali row khud khol do.
    $('#otpHint').hidden = false;
    revealOtpRow();
  }
});

/* ================= EMAIL OTP CODE LOGIN =================
   Kuch inbox (jaise Zoho Mail) aaney wale link ko khud scan karke single-use
   token kha lete hain — isiliye link kabhi-kabhi "purana" ho jata hai. 6 number
   ka code scan nahi ho sakta; wo code UPAR wale signInWithOtp se gayi email me
   hi aata hai (Supabase Magic Link template me {{ .Token }}). Yaha koi alag
   send nahi hai — sirf verify. Safal verify par session banta hai aur init()
   wala onAuthStateChange -> setUser -> afterLogin poora login khud sambhal
   leta hai; isiliye success par yaha kuch extra nahi karna. */
function cleanOtpCode(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.length === 6 ? digits : null;
}

function revealOtpRow() {
  $('#otpRow').hidden = false;
  $('#otpToggle').hidden = true;
}

$('#otpToggle').addEventListener('click', revealOtpRow);
$('#otpInput').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
});
$('#otpInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); loginWithCode(); }
});

async function loginWithCode() {
  const email = $('#emailInput').value.trim();
  if (!email) { msg($('#magicMsg'), 'Pehle upar email daalo 🌿', true); $('#emailInput').focus(); return; }
  const code = cleanOtpCode($('#otpInput').value);
  if (!code) { msg($('#magicMsg'), 'Code 6 number ka hona chahiye — email wala code phir se daalo.', true); return; }
  const btn = $('#otpBtn');
  btn.disabled = true; btn.textContent = 'Rukho…';
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
  btn.disabled = false; btn.textContent = 'Code se login karo';
  if (error) msg($('#magicMsg'), 'Code galat ya purana hai — email wala sabse naya code daalo', true);
  // Safal: onAuthStateChange khud setUser/afterLogin chala dega.
}

$('#otpBtn').addEventListener('click', loginWithCode);

/* Google sign-in (OAuth). Safal ho to browser Google ki taraf redirect ho jata hai —
   wapas aane par session detectSessionInUrl se khud mil jata hai. Kuch bhi fail ho
   (provider abhi live na ho, net atak jaye) to ek saaf bot line; raw error kabhi nahi. */
$('#googleBtn').addEventListener('click', async () => {
  const btn = $('#googleBtn');
  btn.disabled = true;
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/' }
    });
    if (error) throw error;
  } catch {
    btn.disabled = false;
    await botSay('Google login abhi nahi ho paya — email link wala tareeka chal raha hai');
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  await supabase.auth.signOut();
  checkins = []; doctors = []; profileData = null; seeded = false; chatWelcomed = false; draft = {}; chatState = 'idle'; flowDate = null; flowNagged = false; pendingPhoto = null; chatRestored = false; restoredInDom = false; chatTouched = false;
  chatLog.innerHTML = ''; chatChips.innerHTML = '';
  setUser(null);
});

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
let loadInFlight = null;
async function loadEverything() {
  // Ek hi load ek baar — auth events se do load saath chal jayein to doctors
  // seed do-baar ho jata tha (QA 2026-11-10: har doctor 3-3 baar dikha).
  if (loadInFlight) return loadInFlight;
  loadInFlight = (async () => {
    const [c, d, p] = await Promise.all([
      supabase.from('checkins').select('*').order('date', { ascending: false }).limit(120),
      supabase.from('doctors').select('*').order('created_at', { ascending: true }),
      supabase.from('profiles').select('*').maybeSingle()
    ]);
    checkins = c.data || [];
    doctors = d.data || [];
    // Purane duplicate seed rows khud saaf karo — naam se pehla wala rakho, baaki delete.
    if (doctors.length > 1) {
      const seenNames = new Set(); const keep = []; const dupeIds = [];
      for (const doc of doctors) {
        const k = (doc.name || '').trim().toLowerCase();
        if (seenNames.has(k)) dupeIds.push(doc.id); else { seenNames.add(k); keep.push(doc); }
      }
      if (dupeIds.length) {
        doctors = keep;
        try { await supabase.from('doctors').delete().in('id', dupeIds).eq('user_id', currentUser.id); } catch {}
      }
    }
    if (!doctors.length) { await seedDoctors(); }
    profileData = p.data || null;
    if (p.data) {
      $('#pMed').value = p.data.medicine_name || '';
      $('#pMedTime').value = p.data.medicine_timing || '';
      $('#pNote').value = p.data.note || '';
    }
    renderProfileCard();
    $('#fDate').value = localDateStr();
    loadFormForDate(localDateStr());
    renderDoctors();
    renderRecord();
  })();
  try { await loadInFlight; } finally { loadInFlight = null; }
}

let seedInFlight = false;
async function seedDoctors() {
  if (seedInFlight) return; // do-baar seed = duplicate doctors (QA 2026-11-10)
  seedInFlight = true;
  try {
    const defaults = [
      { name: 'Dr. Samresh Kashyap', detail: 'MS-ENT · 21 saal ka tajurba', place: 'Shankar Niwas, Nasriganj Road, Bikramganj 802212 (Dehri + Sasaram bhi)', phone: '+917982192014', note: 'Pehle phone karke Bikramganj wala din confirm karna.' },
      { name: 'Dr. Manoranjan Kumar', detail: 'MS-ENT · 23 saal ka tajurba', place: 'Pinnacle Hospital, Rajendra Nagar, Patna', phone: '9304956487', note: '' },
      { name: 'AIIMS Patna — ENT OPD', detail: 'Sarkaari hospital · ENT department', place: 'AIIMS Patna', phone: '+916122451070', note: 'OPD Mon–Fri, subah 08:00–12:30. Online registration: ors.gov.in' }
    ];
    const rows = defaults.map((x) => ({ ...x, user_id: currentUser.id }));
    const { data } = await supabase.from('doctors').insert(rows).select();
    doctors = data || defaults;
  } finally { seedInFlight = false; }
}

async function saveCheckin(payload) {
  if (!currentUser) throw new Error('no-session');
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
  if (!currentUser) { msg($('#checkinMsg'), 'Save karne ke liye pehle login karo — upar wale card se login link mangwao.', true); showLoginCard(); return; }
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
    // Aaj ka record form se badla — chat me koi purana pending flow ho to use bhi
    // khatm kar do; chat-side state ab isi record se DONE padhega.
    if ($('#fDate').value === localDateStr()) clearPendingFlow();
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
  if (!currentUser) { msg($('#doctorMsg'), 'Doctor add karne ke liye pehle login karo — upar wale card se login link mangwao.', true); showLoginCard(); return; }
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
/* Google identity ko MAUJOODA account se jodo — taaki email magic-link wala user aur
   Google login ek hi user rahe, data (check-ins/doctors) do hisso me na bante.
   NOTE: ye tabhi chalega jab project settings me "Manual linking" ON ho; OFF ho to
   linkIdentity error dega — use catch karke saaf line dikhayenge, button bekaar-safe
   rahega (parent dashboard se setting on karega). */
$('#googleLinkBtn').addEventListener('click', async () => {
  if (!currentUser) { showLoginCard(); return; }
  const btn = $('#googleLinkBtn');
  btn.disabled = true; btn.textContent = 'Google se jod raha hai…';
  try {
    const { error } = await supabase.auth.linkIdentity({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/' }
    });
    if (error) throw error;
    // Safal: browser Google ki taraf gaya; return par onAuthStateChange -> setUser ->
    // renderGoogleLink state khud refresh kar dega.
  } catch {
    btn.disabled = false; btn.textContent = 'Google jodo';
    msg($('#googleLinkMsg'), 'Google abhi nahi jud paya — thodi der baad phir try karo.', true);
  }
});

/* "Meri takleef" card ki dawa wali line hamesha form ke current data se bane —
   pehle ye static thi, save ke baad bhi purani dikhti thi (QA 2026-11-10). */
function renderProfileCard() {
  const el = $('#pfMedLine');
  if (!el) return;
  const med = ($('#pMed').value || '').trim();
  const time = ($('#pMedTime').value || '').trim();
  el.innerHTML = med
    ? `<b>Abhi ki dawa:</b> ${escapeHtml(med)}${time ? ' — ' + escapeHtml(time) : ''}`
    : '<b>Abhi ki dawa:</b> Koi dawa nahi chal rahi';
}

$('#profileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) { msg($('#profileMsg'), 'Save karne ke liye pehle login karo — upar wale card se login link mangwao.', true); showLoginCard(); return; }
  const { error } = await supabase.from('profiles').upsert({
    user_id: currentUser.id,
    medicine_name: $('#pMed').value.trim() || null,
    medicine_timing: $('#pMedTime').value.trim() || null,
    note: $('#pNote').value.trim() || null,
    updated_at: new Date().toISOString()
  });
  if (!error) { profileData = { ...(profileData || {}), medicine_name: $('#pMed').value.trim() || null, medicine_timing: $('#pMedTime').value.trim() || null }; renderProfileCard(); }
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
  if (!currentUser) { msg(out, 'Notifications ke liye pehle login karo — upar wale card se login link mangwao.', true); showLoginCard(); return; }
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

/* ================= CHAT (guided check-in + local intents + AI brain) ================= */
const chatLog = $('#chatLog');
const chatChips = $('#chatChips');
let chatState = 'idle';
let draft = {};
/* Pending check-in flow ki suraksha:
   flowDate — flow kis din ka hai; din badalte hi flow purana (expire) mana jayega.
   flowNagged — is stall me "(Wapas check-in par…)" reminder ek baar dikh chuka hai?
   Dono sirf memory me rehte hain — app reload par pending flow khud khatm. */
let flowDate = null;
let flowNagged = false;

/* Aaj ka record — pehle server/load kiye hue checkins me, warna device-local
   (logged-out) record me. Dono ka shape ek jaisa hai (sleep/nose/headache). */
function todayRecord() {
  return checkins.find((r) => r.date === localDateStr()) || localTodayRecord();
}
function localTodayRecord() {
  try {
    const rec = JSON.parse(localStorage.getItem(LOCAL_CHECKIN_KEY) || 'null');
    return rec && rec.date === localDateStr() ? rec : null;
  } catch { return null; }
}
function saveLocalCheckin(rec) {
  try { localStorage.setItem(LOCAL_CHECKIN_KEY, JSON.stringify(rec)); } catch {}
}
/* Check-in din me EK hi baar: aaj ka record tabhi "ho chuka" hai jab teeno bunyadi
   jawab (neend + naak band + sar dard) maujood hon. */
function checkinDoneToday() {
  const r = todayRecord();
  return !!(r && r.sleep != null && r.nose != null && r.headache != null);
}
function todayDoneLine() {
  const r = todayRecord();
  return `Aaj ka check-in ho chuka hai ✓ — Neend: ${SLEEP_LABEL[r.sleep] || r.sleep}, Naak band: ${r.nose}/10, Sar dard: ${r.headache}/10. Kuch badalna ho to Check-in tab se edit kar lo.`;
}
/* Pending flow ko chup-chaap khatm karna — state, draft aur on-screen chips teeno saaf. */
function clearPendingFlow() {
  chatState = 'idle'; draft = {}; flowDate = null; flowNagged = false;
  chatChips.innerHTML = '';
}
/* Flow abhi zinda hai ya nahi — din badal gaya ho ya aaj ka check-in (chat/form se)
   poora ho chuka ho to flow apne aap khatm; isiliye nagging dobara kabhi nahi aati. */
function flowPending() {
  if (!['sleep', 'nose', 'head', 'note'].includes(chatState)) return false;
  if (flowDate !== localDateStr() || checkinDoneToday()) { clearPendingFlow(); return false; }
  return true;
}

function renderBotHTML(text) {
  // Bot/model output untrusted hai: pehle HTML escape, phir sirf chhota sa markdown.
  const escaped = escapeHtml(String(text ?? ''));
  return escaped.split(/\r?\n/).map((line) => {
    // Markdown blockquote ka agla "> " hata do — escape ke baad wo "&gt; " banta hai,
    // bina hataye bubble me kachra ">" dikhta tha. Baaki escape-first suraksha waisi hi.
    let out = line.replace(/^\s*&gt;\s+/, '').replace(/^&gt;$/, '');
    out = out.replace(/^[-*]\s+/, '• ');
    out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    return out;
  }).join('<br>');
}
function botSay(text, delay = 300, opts = {}) {
  return new Promise((res) => setTimeout(() => {
    const div = document.createElement('div');
    div.className = 'msg bot'; div.innerHTML = renderBotHTML(text);
    // Asal text data attribute me rakha hai — chatHistoryForAI isi ko padhegi,
    // taaki bubble ke andar ke feedback buttons (👍/👎) history me na ghusein.
    div.dataset.rawText = String(text ?? '');
    chatLog.appendChild(div);
    // Chat history me save — opts.skipPersist sirf static greeting/welcome lines ke liye
    if (!opts.skipPersist) persistChatMessage('bot', div.dataset.rawText);
    addFeedbackRow(div);
    scrollChat(); res();
  }, delay));
}
function meSay(text) {
  const div = document.createElement('div');
  div.className = 'msg me'; div.textContent = text;
  chatLog.appendChild(div);
  persistChatMessage('user', text);
  scrollChat();
}

/* ---------- FEEDBACK (👍/👎 — improvement loop) ----------
   Har bot jawab ke neeche chhote 👍 👎 buttons. Login ho to Supabase `feedback`
   table me insert hota hai (rating 1 / -1 + jawab ka asal text, 500 chars tak) —
   Zara ise dashboard se padh kar brain/knowledge sudharegi.
   Table abhi apply na hui ho to insert fail hoga: buttons chup-chaap wapas aa
   jayenge taaki user phir try kar sake; raw error kabhi nahi dikhta. */
function addFeedbackRow(div) {
  const row = document.createElement('div');
  row.className = 'fbrow';
  const up = document.createElement('button');
  up.type = 'button'; up.className = 'fbbtn'; up.textContent = '👍';
  up.setAttribute('aria-label', 'Jawab achha laga');
  const down = document.createElement('button');
  down.type = 'button'; down.className = 'fbbtn'; down.textContent = '👎';
  down.setAttribute('aria-label', 'Jawab theek nahi laga');
  up.addEventListener('click', () => submitFeedback(div, row, 1));
  down.addEventListener('click', () => submitFeedback(div, row, -1));
  row.append(up, down);
  div.appendChild(row);
}

async function submitFeedback(div, row, rating) {
  if (!currentUser) {
    await botSay('Feedback ke liye pehle login karna hoga 🌿 Login ke baad tumhara 👍/👎 meri sudhaar wali list me jud jayega.');
    showLoginCard();
    return;
  }
  const btns = row.querySelectorAll('.fbbtn');
  btns.forEach((b) => { b.disabled = true; });
  row.classList.add('sending');
  const { error } = await supabase.from('feedback').insert({
    user_id: currentUser.id,
    rating,
    message_text: (div.dataset.rawText || '').slice(0, 500)
  });
  row.classList.remove('sending');
  if (error) {
    btns.forEach((b) => { b.disabled = false; });
    return;
  }
  row.innerHTML = '<span class="fbthanks">Dhanyavaad 🙏</span>';
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
  // Restore ki hui history pehle start par bani rehti hai — greeting uske NEECHE judta
  // hai. Baad ke restarts (jaise "check-in" trigger) par log hamesha ki tarah saaf hota hai.
  if (!(first && restoredInDom)) chatLog.innerHTML = '';
  restoredInDom = false;
  chatChips.innerHTML = ''; draft = {}; flowDate = null; flowNagged = false;
  await botSay(greetingLine(), first ? 150 : 100, { skipPersist: true });
  // Din me ek hi check-in: aaj ka poora ho chuka ho to koi flow/options nahi —
  // sirf ek line me aaj ka haal, bas.
  if (checkinDoneToday()) {
    chatState = 'idle';
    await botSay(todayDoneLine());
    return;
  }
  chatState = 'start';
  const today = todayRecord();
  if (!currentUser) await botSay('Ek chhoti baat — abhi tum login nahi ho, to aaj ka record is device par save hoga; login karne par wahi record tumhare account me jud jayega 🌿');
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
  flowDate = localDateStr();
  flowNagged = false;
  await botSay('Pehle ye batao — raat ko neend kaisi thi?');
  setChips([
    { label: 'Achhi 😴', val: 'achhi' },
    { label: 'Beech wali', val: 'beech' },
    { label: 'Kharab 😖', val: 'kharab' }
  ], (it) => { meSay(it.label); draft.sleep = it.val; askNose(); });
}

async function askNose() {
  // Beech flow me aaj ka check-in kisi aur raaste (form tab) se poora ho gaya ho to ruk jao
  if (checkinDoneToday()) { clearPendingFlow(); await botSay(todayDoneLine()); return; }
  chatState = 'nose';
  flowNagged = false;
  await botSay('Ab naak ka haal — abhi naak kitni band lag rahi hai?\n(0 = bilkul khuli, 10 = poori band)');
  numChips((v) => { draft.nose = v; askHead(); });
}

async function askHead() {
  if (checkinDoneToday()) { clearPendingFlow(); await botSay(todayDoneLine()); return; }
  chatState = 'head';
  flowNagged = false;
  await botSay('Aur sar dard? (0 = bilkul nahi, 10 = sabse tez)');
  numChips((v) => { draft.headache = v; askNote(); });
}

async function askNote() {
  if (checkinDoneToday()) { clearPendingFlow(); await botSay(todayDoneLine()); return; }
  chatState = 'note';
  flowNagged = false;
  await botSay('Koi chhota note hai aaj ke liye? Neeche likh sakte ho — ya "Note nahi hai" tap kar do.');
  setChips([{ label: 'Note nahi hai', val: 'skip' }], async (it) => { meSay(it.label); finishChat(null); });
}

async function finishChat(noteText) {
  chatChips.innerHTML = '';
  // Aaj ka check-in kisi aur raaste se pehle hi poora ho chuka ho to stale draft se use mat badlo
  if (checkinDoneToday()) { clearPendingFlow(); await botSay(todayDoneLine()); return; }
  chatState = 'saving';
  await botSay('Ek second — save kar raha hun…', 150);
  const doneMsg = `Ho gaya ✅\nAaj ka record: Neend ${draft.sleep ? SLEEP_LABEL[draft.sleep] : '—'} · Naak band ${draft.nose}/10 · Sar dard ${draft.headache}/10`;
  if (!currentUser) {
    // Logged-out: record device par date-stamped save — aaj dobara check-in nahi
    // puchega, aur login par mergeLocalCheckin() ise account me mila dega.
    saveLocalCheckin({ date: localDateStr(), sleep: draft.sleep ?? null, nose: draft.nose ?? null, headache: draft.headache ?? null, note: noteText || null });
    chatState = 'idle'; flowDate = null; flowNagged = false;
    await botSay(doneMsg);
    await botSay('Ye record abhi is device par save hai 🌿 Login karne par tumhare account me jud jayega. Aur aaj ke liye check-in dobara nahi puchhunga — kal phir milega.');
    await botSay(tipFor(draft.nose, draft.headache));
    return;
  }
  try {
    await saveCheckin({ date: localDateStr(), sleep: draft.sleep ?? null, nose: draft.nose, headache: draft.headache, note: noteText || null });
  } catch {
    chatState = 'idle';
    await botSay('Arey — save nahi hua 😔 Net check karke "check-in" likh kar phir try karna.');
    return;
  }
  chatState = 'idle'; flowDate = null; flowNagged = false;
  await botSay(doneMsg);
  await botSay(tipFor(draft.nose, draft.headache));
}

function tipFor(nose, head) {
  if (nose >= 8 || head >= 8) {
    return '⚠️ Ye number zyada hai. Guide ke khatre wale sanket yaad rakhna — aankh ke aas-paas soojan, tez bukhaar ya saans lene me dikkat ho to der bilkul mat karna: ghar par batao aur doctor ko dikhao.\nAaram ke liye: garam bhaap (steam) lo, aur saline (namak paani) se naak saaf karna madad karta hai.';
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

async function chatWelcome() {
  // Welcome lines static hain — history me save NAHI hoti, warna har session me
  // restore ke upar dobara-tibara judti jayengi.
  await botSay(greetingLine(), 150, { skipPersist: true });
  await botSay('Main ye kar sakta hun:\n• "check-in" likho — aaj ka record (neend, naak band, sar dard)\n• 📖 Guide tab — sinus ki seedhi, saaf jankari\n• 🩺 Doctors tab — tumhare 3 ENT doctors, tap karke call\nAsli sawal-jawab ke liye Zara se WhatsApp par baat karna — wahan sawal pehle puchh kar samjhaya jata hai. Yahan bas likh do ya options tap kar do 🌿', 300, { skipPersist: true });
}

const FALLBACKS = [
  'Samajh gaya 🌿 Main khaas taur par in kaamo ke liye hun: "check-in" likho to aaj ka record bhar deta hun, 📖 Guide tab me sinus ki jankari hai, aur 🩺 Doctors tab me tumhare ENT doctors hain. Kya karna hai?',
  'Ye wala sawal mere chhote se dayre ke bahar hai 😊 Lekin ye zaroor kar sakta hun — check-in record karna, Guide ki jankari dikhana, Doctors ki list kholna. "check-in" likhna hai to bas likh do.',
  'Hmm, is par main pakka jawab nahi de sakta 🌿 Asli sawal-jawab ke liye Zara se WhatsApp par baat karo. Yahan main check-in, Guide aur Doctors me madad karta hun — bolo, kya chahiye?'
];
let lastFallback = -1;
function nextFallback() {
  let i = Math.floor(Math.random() * FALLBACKS.length);
  if (i === lastFallback) i = (i + 1) % FALLBACKS.length;
  lastFallback = i;
  return FALLBACKS[i];
}

/* Dawai-sawal ki pehchan (sendChatText step 4 me istemal):
   MED_RX_RE — SIRF prescription-maangne wali bhasha: kaunsi dawai LU, dose kitni, kab tak lu,
   dawai likh do/suggest karo, prescription. Jaankari wale sawal ("Glynaze konsi dawa h",
   "Torex kya karti h", "X ke baare me batao") isse match NAHI hone chahiye — wo brain ke hain.
   MED_INFO_RE — dawai-ish shabd; logged-out jaankari sawal ko login ki taraf bhejne ke liye. */
const MED_RX_RE = /(dawai|dawa|dava|goli|tablet|medicine|spray)\s+(lu|loon|lun|lo|khaun|khau|kha lu|kha lo|le lu|le lo|lena chahiye|leni chahiye|khani chahiye|le sakta|le sakti|kha sakta|kha sakti)\b|\b(dose|dosage|khurak)\b|kitn[ei]\s*(mg|ml|gram)\b|kab\s+tak\s+[^.?!]{0,24}\b(lu|loon|lun|khaun|khau|khana|khaana|lena|leni)\b|dawai\s+(likh|suggest|prescribe|batao)\b|prescription|mujhe\s+dawai|mere\s+liye\s+dawai/;
const MED_INFO_RE = /(dawai|dwaai|dvaai|dawa|dava|tablet|goli|medicine|capsule|syrup|injection|ointment|cream|spray)|(kya|kis)\s+(kaam|karti|karta|liye)\b|ke\s+baare\s+me|(ka|ki|ke)\s+(use|istemal|jankari|jaankari)\b|kya\s+hai\b/;

/* AI brain — local intent na mile to ortho-chat Edge Function (sirf logged-in user ke liye).
   Function ka contract: body { messages: [{ role, content }] } -> { reply, model }.
   Kuch bhi fail ho (net slow, timeout, function error) to chup-chaap local fallback chalega —
   user ko raw error kabhi nahi dikhega. */
function chatHistoryForAI() {
  return [...chatLog.children]
    .filter((el) => el.classList.contains('msg') && !el.classList.contains('typing'))
    // Bot bubbles ke liye dataset.rawText (botSay me set) — warna .fbrow ke 👍/👎
    // aur "Dhanyavaad" text history me ghus jata. User bubbles par dataset nahi hai.
    .map((el) => ({ role: el.classList.contains('me') ? 'user' : 'assistant', content: (el.dataset.rawText ?? el.textContent).trim() }))
    .filter((m) => m.content.length > 0)
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
}
function showTyping() {
  const div = document.createElement('div');
  div.className = 'msg bot typing';
  div.textContent = 'Ortho soch raha hai…';
  chatLog.appendChild(div); scrollChat();
  return div;
}
async function askOrthoBrain(extraUserText) {
  const messages = chatHistoryForAI();
  // Photo flow jaisi jagah se ek tay-shuda sawal bhejna ho to wo history ke aakhir me jud jata hai
  if (extraUserText) messages.push({ role: 'user', content: String(extraUserText).slice(0, 2000) });
  // Free tier par kabhi-kabhi pehli call aise hi fail ho jati hai (hiccup) — ek retry zaroor.
  // Typing bubble caller ke paas hai; wo retry ke dauraan bhi bana rehta hai.
  let lastErr = new Error('ai-failed');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 60000));
      const call = supabase.functions.invoke('ortho-chat', { body: { messages } });
      const { data, error } = await Promise.race([call, timeout]);
      if (error || !data || typeof data.reply !== 'string' || !data.reply.trim()) throw new Error('ai-failed');
      return data.reply.trim();
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}

/* ================= DAWAI PHOTO FLOW =================
   Photo -> function ka vision branch sirf NAAM padhta hai -> user confirm kare
   ("haan"/"nahi") -> tabhi AI brain se us dawai ki jaankari aati hai.
   Naam galat nikle ya photo na padh paye to user khud naam type kar sakta hai.
   Pending state: { stage: 'confirm', name } | { stage: 'await_name' } | null.
   Check-in trigger aate hi ye flow chup-chaap khatm ho jata hai (sendChatText step 1). */
let pendingPhoto = null;
const PHOTO_YES_RE = /^(haan|ha|han|ji|yes|yep|yup|sahi|hai|yehi|yahi|theek|thik|bilkul|ok)\b/;
const PHOTO_NO_RE = /^(nahi|nahin|na|no|nope|galat|wrong)\b/;

function meSayPhoto(dataUrl) {
  const div = document.createElement('div');
  div.className = 'msg me';
  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = 'Dawai ki photo';
  img.style.cssText = 'max-width:180px;max-height:240px;border-radius:10px;display:block';
  div.appendChild(img);
  chatLog.appendChild(div);
  // Photo ka data-URL history me NAHI rakha jata (bahut bada hota hai) — sirf ek
  // chhota nishan, taaki restore hui baat-cheet ka silsila samajh aata rahe.
  persistChatMessage('user', '📷 Dawai ki photo');
  scrollChat();
}

function downscaleImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const MAX = 1024;
        const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img-load')); };
    img.src = url;
  });
}

async function sendMedicineInfoQuery(name) {
  const query = `Mujhe '${name}' dawai ke baare me jaankari do — ye kis kaam aati hai, aur iske baare me aam taur par kya jaanna chahiye?`;
  const typing = showTyping();
  try {
    const reply = await askOrthoBrain(query);
    typing.remove();
    await botSay(reply, 150);
  } catch {
    typing.remove();
    await botSay('Abhi jaankari nahi mil payi 😔 Net slow lag raha hai — thodi der baad dawai ka naam likh kar phir try karna, ya Zara se WhatsApp par puchh lena.');
  }
}

// Photo-pending haalat me aaya hua text. true = text yahin kharch ho gaya;
// false = pending khatm, normal flow aage chalega (meSay abhi nahi hua hai).
async function handlePhotoPending(raw, t) {
  if (!pendingPhoto) return false;
  if (pendingPhoto.stage === 'confirm') {
    if (PHOTO_NO_RE.test(t)) {
      pendingPhoto = { stage: 'await_name' };
      meSay(raw);
      await botSay('Theek hai, koi baat nahi 🌿 Dawai ka naam khud type karke bhej do — main usi ki jaankari de dunga.');
      return true;
    }
    if (PHOTO_YES_RE.test(t)) {
      const name = pendingPhoto.name;
      pendingPhoto = null;
      meSay(raw);
      await sendMedicineInfoQuery(name);
      return true;
    }
    pendingPhoto = null; // na haan na nahi — flow chhodo, normal baat aage badhe
    return false;
  }
  if (pendingPhoto.stage === 'await_name') {
    const name = raw.trim().slice(0, 80);
    pendingPhoto = null;
    meSay(raw);
    await sendMedicineInfoQuery(name);
    return true;
  }
  pendingPhoto = null;
  return false;
}

$('#chatPhotoBtn').addEventListener('click', () => { $('#chatPhoto').click(); });
$('#chatPhoto').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  chatTouched = true;
  let dataUrl;
  try {
    dataUrl = await downscaleImageFile(file);
  } catch {
    await botSay('Photo khul nahi payi 😔 Ek baar phir photo chun kar bhejo, ya dawai ka naam type kar do — main jaankari de dunga.');
    return;
  }
  meSayPhoto(dataUrl);
  if (!currentUser) {
    pendingPhoto = null;
    await botSay('Photo mil gayi 📷 Lekin dawai ki pehchan login ke baad hi chalegi — pehle upar wale card se login kar lo, phir photo bhejna, main naam padh dunga 🌿');
    showLoginCard();
    return;
  }
  const typing = showTyping();
  let data = null;
  let failed = false;
  try {
    const res = await supabase.functions.invoke('ortho-chat', { body: { image: dataUrl } });
    if (res.error) failed = true; else data = res.data;
  } catch { failed = true; }
  typing.remove();
  // Guard: naam kam se kam 3 characters ka ho — "S" jaisa tukda confirm prompt me kabhi nahi jayega
  if (!failed && data && typeof data.medicine_name === 'string' && data.medicine_name.trim().length >= 3) {
    const name = data.medicine_name.trim();
    pendingPhoto = { stage: 'confirm', name };
    await botSay(`Photo me dawai ka naam ye padha maine: "${name}". Kya yehi dawai hai? 'Haan' ya 'Nahi' likho.`);
  } else {
    // photo_unreadable ya invoke fail — ek hi graceful line, raw error kabhi nahi
    pendingPhoto = { stage: 'await_name' };
    await botSay('Photo saaf nahi padhi gayi 😔 Roshni me, paas se dobara photo bhejo — ya dawai ka naam yahin type kar do, main usi ki jaankari de dunga.');
  }
});

async function sendChatText() {
  const inp = $('#chatText');
  const raw = inp.value.trim();
  if (!raw) return;
  inp.value = '';
  chatTouched = true; // user is session me bol chuka hai — ab restore dobara render nahi karega
  const t = raw.toLowerCase();
  const norm = t.replace(/[\s\-_]+/g, '');

  // 1) Check-in trigger — kisi bhi spelling me ("check-in", "Check in", "checkin", "CHECK-IN"),
  //    kisi bhi state me (saving ke alawa). Aaj ka check-in ho chuka ho to flow ki
  //    jagah sirf summary line aati hai (neeche dekho).
  //    Photo flow pending ho to wo yahan chup-chaap khatm ho jata hai.
  if (norm.includes('checkin')) {
    pendingPhoto = null;
    if (chatState !== 'saving') {
      meSay(raw);
      // Aaj ka check-in ho chuka ho to flow dobara NAHI — sirf ek line ka summary
      if (checkinDoneToday()) { clearPendingFlow(); await botSay(todayDoneLine()); }
      else startChat();
    }
    return;
  }

  // 1b) Dawai photo flow ka pending jawab (confirm haan/nahi, ya khud type kiya naam) —
  //     baaki saare intents se PEHLE pakda jata hai.
  if (pendingPhoto) {
    const consumed = await handlePhotoPending(raw, t);
    if (consumed) return;
  }

  // 1c) Din badal gaya ho to purana pending flow chup-chaap saaf — kal ke sawal aaj nahi ghumenge
  if (['sleep', 'nose', 'head', 'note'].includes(chatState) && flowDate !== localDateStr()) clearPendingFlow();

  // 2) Note state — likha hua text hi aaj ka note hai
  if (chatState === 'note') { meSay(raw); finishChat(raw); return; }

  // 3) Chal rahe sawal ke typed jawab (chips ke saath-saath typing bhi chalegi)
  if (chatState === 'sleep') {
    const v = /(achhi|acchi|good|theek|mast)/.test(t) ? 'achhi'
      : /(beech|medium|average|thodi)/.test(t) ? 'beech'
      : /(kharab|buri|bad|bekar|nahi aayi)/.test(t) ? 'kharab' : null;
    if (v) { meSay(raw); draft.sleep = v; askNose(); return; }
  }
  if (chatState === 'nose' || chatState === 'head') {
    const m = t.match(/\b(10|[0-9])\b/);
    if (m) {
      const n = parseInt(m[1], 10);
      meSay(raw);
      if (chatState === 'nose') { draft.nose = n; askHead(); } else { draft.headache = n; askNote(); }
      return;
    }
  }
  if (chatState === 'saving') { meSay(raw); return; }

  // 4) Simple intents — flow chal raha ho to bhi jawab milega.
  //    Reminder "(Wapas check-in par…)" ek stall me SIRF EK BAAR lagta hai; agli
  //    unrelated baat par flow chup-chaap khatm ho jata hai (chips bhi saaf) —
  //    aur aaj ka check-in ho chuka ho to flowPending() khud hi saaf kar deta hai.
  meSay(raw);
  let inFlow = flowPending() && ['sleep', 'nose', 'head'].includes(chatState);
  let flowNote = '';
  if (inFlow) {
    if (!flowNagged) { flowNote = '\n\n(Wapas check-in par — upar diye options me se jawab tap kar do, main wahi ruka hun 🌿)'; flowNagged = true; }
    else { clearPendingFlow(); inFlow = false; }
  }
  const loginLine = 'Ye jaankari tumhare account ke record me hai — dekhne ke liye login chahiye 🌿 Upar wale card se login link mangwa lo.';

  // 4a) Personal data — sirf asal loaded record se jawab; data na ho to saaf mana, andaz kabhi nahi
  if (/(meri|mera) (dawai|dava|dawa|medicine|spray)/.test(t)) {
    if (!currentUser) await botSay(loginLine + flowNote);
    else if (profileData && profileData.medicine_name) {
      await botSay(`Profile me tumne ye dawai likhi hai: ${profileData.medicine_name}${profileData.medicine_timing ? ' · Time: ' + profileData.medicine_timing : ''}\nYe sirf tumhari apni likhi hui jaankari hai — dawai ke kisi bhi badlaav ka faisla sirf doctor karega 🌿` + flowNote);
    } else {
      await botSay('Profile me abhi koi dawai likhi nahi hai — tumne bataya bhi tha ki abhi koi dawai chal nahi rahi 🌿 Doctor koi dawai de to Profile tab me naam aur time likh lena, yaad rahega.' + flowNote);
    }
    return;
  }
  if (/(mera|mere) doctor|doctor ka (number|naam|phone|no)/.test(t)) {
    if (!currentUser) await botSay(loginLine + flowNote);
    else if (!doctors.length) await botSay('Abhi doctors list khaali hai 🌿 🩺 Doctors tab me apna doctor add kar sakte ho.' + flowNote);
    else {
      await botSay('Tumhare doctors 🩺:\n' + doctors.map((d) => `• ${d.name}${d.phone ? ' — ' + d.phone : ''}`).join('\n') + '\nCall karne ke liye 🩺 Doctors tab me number par tap karo.' + flowNote);
    }
    return;
  }
  if (/(trend|progress|hafta kaisa|hafta bhar|behtar|badhtar|sudhaar|sudhar|week kaisa)/.test(t)) {
    if (!currentUser) await botSay(loginLine + flowNote);
    else {
      const rows = checkins.filter((r) => r.nose != null);
      if (rows.length < 2) {
        await botSay(`Trend dekhne ke liye kam se kam 2 din ka record chahiye 🌿 Abhi ${rows.length} din ka number hai — roz "check-in" karte raho, pattern khud saaf hoga.` + flowNote);
      } else {
        const last7 = rows.slice(0, 7);
        const avgOf = (arr) => arr.reduce((a, r) => a + r.nose, 0) / arr.length;
        const half = Math.ceil(last7.length / 2);
        const recentAvg = avgOf(last7.slice(0, half));
        const olderAvg = avgOf(last7.slice(half));
        let dir;
        if (!last7.slice(half).length) dir = '';
        else if (olderAvg - recentAvg > 0.5) dir = `\nPehle wale dino ke muqable (avg ${olderAvg.toFixed(1)}) ab naak band ke number kam aaye hain (avg ${recentAvg.toFixed(1)}) 🌿`;
        else if (recentAvg - olderAvg > 0.5) dir = `\nPehle wale dino ke muqable (avg ${olderAvg.toFixed(1)}) in dino naak band ke number zyada aaye hain (avg ${recentAvg.toFixed(1)}) 🤧 Ye pattern doctor ko dikhane me kaam aayega — isiliye record zaroori hai.`;
        else dir = `\nPehle ke muqable lagbhag waisa hi chal raha hai (avg ${recentAvg.toFixed(1)}) — number na zyada upar, na neeche.`;
        await botSay(`Pichhle ${last7.length} check-ins me average naak band ${avgOf(last7).toFixed(1)}/10 raha.${dir}\nPoora graph 📈 Record tab me hai.` + flowNote);
      }
    }
    return;
  }
  if (/(last|pichla|pichhla|aakhri)\s*(check|record)|kal\s*(ka|ki|wala|wali)\s*(check|record|haal)|kal naak kaisi thi|mera (last|pichla)/.test(t)) {
    if (!currentUser) await botSay(loginLine + flowNote);
    else if (!checkins.length) await botSay('Abhi koi check-in record nahi hai 🌿 Pehla record bharne ke liye "check-in" likho.' + flowNote);
    else {
      const r = checkins[0];
      await botSay(`Tumhara last check-in ${fmtDate(r.date)} ka hai:\n👃 Naak band: ${r.nose ?? '—'}/10 · 🤕 Sar dard: ${r.headache ?? '—'}/10${r.sleep ? '\nNeend: ' + SLEEP_LABEL[r.sleep] : ''}${r.note ? '\n📝 Note: ' + r.note : ''}\nPoora record 📈 Record tab me hai.` + flowNote);
    }
    return;
  }

  // 4b) Sinus FAQ — general jankari (sinus-deep-guide se), possibility language, koi diagnosis nahi
  const GUIDE_END = '\nPoori detail Guide tab me hai.';
  if (/(khatr|danger|red flag|emergency|maathe.*soojan|aankh.*soojan|soojan.*aankh|gardan.*akdan)/.test(t)) {
    await botSay('⚠️ Khatre ke sanket — inme der bilkul nahi, turant ghar par batao aur doctor ko dikhao:\n• Aankh ke aas-paas soojan, aankh dard, ya dhundla/dohra dikhna\n• Maathe par soojan, ya badhta hua tez sar dard\n• Tez bukhaar ke saath chehre par tez dard-soojan\n• Gardan me akdan\nYe sanket hon to intezaar nahi — seedha doctor.' + GUIDE_END + flowNote);
    return;
  }
  if (/(saline|namak (paani|pani)|neti|rinse|naak dhona|naak saaf kar)/.test(t)) {
    await botSay('Saline rinse matlab namak paani se naak saaf karna 🌿 Ye mucus ko patla karke sinus ke raste kholne me madad kar sakta hai — doctors aam taur par iski salah dete hain.\n⚠️ Sabse zaroori safety: paani hamesha ubla-thanda kiya hua (ya sterile) ho — seedha nal ka paani kabhi nahi.' + GUIDE_END + flowNote);
    return;
  }
  if (/(spray (kaise|lagane|lagana|istemal|use kar)|spray ka tareeka|spray tareeka)/.test(t)) {
    await botSay('Spray ka sahi tareeka 🌿 Pehle naak saaf karo, phir nozzle ko naak ki bahar wali deewaar ki taraf rakho — seedha beech wali haddi (septum) ki taraf nahi, warna roz ke istemal se naak se khoon aa sakta hai.\nHalki saans lete hue spray karo, zor se soonghna nahi aur sir peeche mat jhukao.\nSteroid spray ka asar turant nahi aata — roz sahi istemal par 1–2 hafte me poora asar dikh sakta hai; beech me chhod dena sabse aam galti hai.' + GUIDE_END + flowNote);
    return;
  }
  if (/(sinus (kya|hota|hote|hai)|sinusitis (kya|hota))/.test(t)) {
    await botSay('Sinus khopdi ki haddiyon ke andar hawa bhari 4 jodi gufaayein (cavities) hain — gaalon me, maathe me, aankhon ke beech aur naak ke peeche 🌿\nYe saans ki hawa ko garam-nam karte hain, awaaz ko gunj dete hain aur mucus bana kar naak saaf rakhte hain.\nJab inke chhote raste band ho jayein to mucus andar fas sakta hai — wahi se band naak aur bhaari-pan shuru ho sakta hai.' + GUIDE_END + flowNote);
    return;
  }
  if (/(naak band kyun|naak (kyun|kyu) band|band kyun hoti|allergy (se|me|kaise)|allergen)/.test(t)) {
    await botSay('Ho sakta hai iski wajah allergy ho 🌿 Dhool, pollen ya thandi hawa jaisa allergen naak ki andar wali chamdi (mucosa) ko chhuta hai to body histamine jaise chemical chhodti hai — mucosa phool jati hai aur mucus zyada banta hai.\nPhooli hui mucosa sinus ke chhote raste band kar sakti hai aur andar dabaav ban sakta hai — isiliye band naak ke saath maathe/gaalon me bhaari-pan ho sakta hai.' + GUIDE_END + flowNote);
    return;
  }
  if (/(ent|doctor ko kab|kab dikhana|kab dikhayen|kab jaana chahiye|kab jana chahiye)/.test(t)) {
    await botSay('ENT ko dikhana tab khaas zaroori ho sakta hai jab takleef lambe samay se chal rahi ho, baar-baar wapas aa rahi ho ya ghar ke upaayon se aaram na mil raha ho 🌿\nDoctor naak ke andar endoscopy se dekh sakta hai; zaroorat ho to CT scan ya allergy test bhi ho sakta hai — asal wajah wahi se saaf hoti hai.\nTumhare case me doctor ki talaash chal hi rahi hai — 🩺 Doctors tab me 3 ENT ki list taiyaar hai.' + GUIDE_END + flowNote);
    return;
  }
  if (/(neend.*(tip|salah|ke liye)|sone ke|padhai.*(tip|salah)|study.*(tip|focus)|dhyaan)/.test(t)) {
    await botSay('Neend aur padhai ke liye aam salah 🌿 Sone se pehle saline rinse karna aur sir thoda uncha (extra takiya) karke sona — raat ko band-pan kam mehsoos ho sakta hai; neend gehri ho to agle din dhyaan bhi behtar reh sakta hai.\nKamre ki dhool saaf rakhna aur bistar hafte me dhona dust-mite allergy me sabse zyada kaam kar sakta hai. AC ya thandi hawa seedha chehre par na lage.' + GUIDE_END + flowNote);
    return;
  }

  if (/^(assalamualaikum|hi+|hello|hey|namaste|salam|aoa)\b/.test(t)) {
    await botSay('Namaste 🌤️ Main theek hun, tum batao — aaj naak kaisi hai?\n"check-in" likho to record kar deta hun, ya Guide / Doctors tab dekh lo.' + flowNote);
    return;
  }
  // Dawai ke sawal — pehle yahan ek bada catch-all tha jo har dawai-ish shabd par local
  // inkaar thop deta tha; galat tha, kyunki jaankari wale sawal bhi ruk jate the.
  // Ab: (a) prescription-maangne wali bhasha (MED_RX_RE) par local inkaar SIRF logged-out par —
  // logged-in par wahi sawal brain ke paas jata hai, brain ka apna prompt info-only /
  // no-prescription rule context ke saath lagata hai.
  // (b) jaankari wala sawal (naam, "kya kaam karti hai") logged-in par seedha brain ko —
  // beech wale symptom/guide intents use na rok dein, isiliye brain yahin bulaya jata hai.
  // (c) logged-out jaankari sawal par login ki taraf — jaankari login ke baad AI se milti hai.
  if (MED_RX_RE.test(t) && !currentUser) {
    await botSay('Dawai wala sawal samajh sakta hun — lekin iska jawab main nahi de sakta 🌿\nDawai ka faisla — kaunsi, kitni, kab tak — sirf doctor karte hain, kyunki wo tumhari naak dekh kar aur purani report samajh kar faisla lete hain. Galat dawai faayde ki jagah nuksaan kar sakti hai.\nTum ye kar sakte ho:\n• 🩺 Doctors tab — tumhare 3 ENT doctors hain, naam ke paas wale number se seedha call lag jayegi\n• 📖 Guide tab — sinus aur spray ke sahi tareeke ki general jankari\n• Asal sawal-jawab ke liye Zara se WhatsApp par baat karo — wahan main sawal pehle puchh kar samjhati hun.' + flowNote);
    return;
  }
  if (MED_RX_RE.test(t) || MED_INFO_RE.test(t)) {
    if (!currentUser) {
      await botSay('Dawai ki jaankari ke liye pehle login karna hoga 🌿 Login ke baad kisi bhi dawai ke baare me AI se jaankari mil jayegi — kis kaam aati hai, aam taur par kya dhyaan rakhna chahiye. Upar wale card se login link mangwa lo.' + flowNote);
      showLoginCard();
      return;
    }
    const typing = showTyping();
    try {
      const reply = await askOrthoBrain();
      typing.remove();
      await botSay(reply + flowNote, 150);
      return;
    } catch {
      typing.remove();
    }
    await botSay(nextFallback() + flowNote);
    return;
  }
  if (/(doctor|ent|hospital|clinic|appointment)/.test(t)) {
    await botSay('Doctors ki list 🩺 Doctors tab me hai — 3 ENT doctors, number par tap karte hi call lag jayegi. Pehle Dr. Samresh Kashyap (Bikramganj) ko phone karke unka Bikramganj wala din confirm kar lena 🌿' + flowNote);
    return;
  }
  if (/(naak|band|sar dard|sardard|headache|sinus|zukam|cold|sardi|bukhaar|fever|neend|khaansi|khansi|gala)/.test(t)) {
    await botSay('Sun kar afsos hua 🤧 Apna haal record kar lo to pattern saaf dikhega — "check-in" likho, main 3 chhote sawal puchh lunga.\nUs topic ki general jankari 📖 Guide tab me bhi hai. Aur haan — aankh ke aas-paas soojan, tez bukhaar ya saans ki dikkat ho to intezaar mat karna, ghar par bata kar doctor ko dikhana.' + flowNote);
    return;
  }
  if (/(record|history|pattern|graph|chart|purana)/.test(t)) {
    await botSay('Tumhara pattern 📈 Record tab me hai — roz ke number, average aur graph ke saath. ' + (currentUser ? 'Neeche Record tap karke dekh lo.' : 'Record dekhne ke liye login chahiye — upar wale card se link mangwa lo.') + flowNote);
    return;
  }
  if (/(guide|jankari|jaankari|padhna|samjhao|batao)/.test(t)) {
    await botSay('Sinus ki saari general jankari 📖 Guide tab me hai — sinus kya hota hai, spray ka sahi tareeka, ghar par dekhbhaal aur khatre ke sanket. Neeche Guide tap karo 🌿' + flowNote);
    return;
  }

  // 5) Kuch samajh na aaye — flow me ho to pending sawal ki taraf.
  //    Warna: logged-in user ke liye AI brain (ortho-chat); fail ho to ghumta hua local fallback.
  if (inFlow) {
    await botSay('Is sawal ka jawab upar ke options se tap kar do 🌿 — ya naya shuru karna ho to "check-in" likho.');
    return;
  }
  if (currentUser) {
    const typing = showTyping();
    try {
      const reply = await askOrthoBrain();
      typing.remove();
      await botSay(reply, 150);
      return;
    } catch {
      typing.remove();
    }
  }
  await botSay(nextFallback());
}

/* ================= CHAT HISTORY (save + restore + 🧹 clear) =================
   Har chat message save hota hai taaki app dobara kholne par pichli baat wapas dikhe:
   - Logged-in: Supabase `chat_messages` table (sirf apni rows; RLS). Table abhi
     dashboard se apply hona baaki ho to insert/select chup-chaap fail hote hain —
     chat kabhi nahi rukti, bas history us samay save/restore nahi hoti.
   - Logged-out: sirf is device par, localStorage `ortho_local_chat_v1` (aakhri 60).
   Restore session me EK hi baar hota hai, greeting/startChat se PEHLE, aur
   restored bot messages par feedback (👍/👎) row NAHI lagti — wo sirf live
   jawabon ke liye hai. */
const LOCAL_CHAT_KEY = 'ortho_local_chat_v1';
const CHAT_HISTORY_MAX = 60;
let chatRestored = false;  // is session me restore ho chuka (dobara render nahi hoga)
let restoredInDom = false; // restore ne DOM me kuch render kiya — pehla startChat use mitayega nahi
let chatTouched = false;   // user is session me kuch bol/bhej chuka hai — ab restore nahi hoga

function capChatHistory(arr) { return arr.slice(-CHAT_HISTORY_MAX); }
function sortChatOldestFirst(rows) { return [...rows].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); }
function parseLocalChat(raw) {
  try {
    const a = JSON.parse(raw || '[]');
    return Array.isArray(a) ? a.filter((m) => m && (m.role === 'user' || m.role === 'bot') && typeof m.text === 'string') : [];
  } catch { return []; }
}
function loadLocalChat() {
  try { return parseLocalChat(localStorage.getItem(LOCAL_CHAT_KEY)); } catch { return []; }
}
function saveLocalChat(arr) {
  try { localStorage.setItem(LOCAL_CHAT_KEY, JSON.stringify(capChatHistory(arr))); } catch {}
}

/* botSay/meSay ke choke point se bula jata hai. Har failure SILENT hai —
   persistence kabhi chat ko rok ya error-dikha nahi sakti. */
function persistChatMessage(role, text) {
  try {
    const clean = String(text ?? '').trim();
    if (!clean) return;
    if (currentUser) {
      const p = supabase.from('chat_messages').insert({ user_id: currentUser.id, role, text: clean });
      if (p && typeof p.then === 'function') p.then(() => {}, () => {});
    } else {
      const arr = loadLocalChat();
      arr.push({ role, text: clean });
      saveLocalChat(arr);
    }
  } catch { /* save na ho paye to bhi chat chalti rahegi */ }
}

/* Restored message — feedback row NAHI, intents/brain bilkul nahi; bot ke liye
   renderBotHTML + dataset.rawText taaki chatHistoryForAI sahi kaam kare. */
function renderRestoredMessage(m) {
  const div = document.createElement('div');
  if (m.role === 'user') {
    div.className = 'msg me';
    div.textContent = m.text;
  } else {
    div.className = 'msg bot';
    div.innerHTML = renderBotHTML(m.text);
    div.dataset.rawText = m.text;
  }
  chatLog.appendChild(div);
}

async function restoreChatHistory() {
  if (chatRestored || chatTouched) return;
  chatRestored = true;
  let rows = [];
  if (currentUser) {
    try {
      const { data, error } = await supabase.from('chat_messages')
        .select('role, text, created_at')
        .order('created_at', { ascending: false })
        .limit(CHAT_HISTORY_MAX);
      if (!error && data) rows = sortChatOldestFirst(data);
    } catch { rows = []; }
  } else {
    rows = loadLocalChat();
  }
  // Fetch ke dauraan user kuch bol chuka ho to ab render mat karo — baat-cheet bikhar jayegi
  if (chatTouched || !rows.length) return;
  rows.forEach(renderRestoredMessage);
  restoredInDom = true;
  scrollChat();
}

/* Login par: device-local history account me le jao — SIRF tab jab account ki
   history abhi khaali ho. Account me pehle se history ho to wahi jeet ti hai,
   sirf local copy hat jati hai. Migrated rows ka order banaye rakhne ke liye
   created_at me 1-1 second ka antar rakha hai. */
async function migrateLocalChatHistory() {
  if (!currentUser) return;
  const local = loadLocalChat();
  if (!local.length) return;
  try {
    const { data, error } = await supabase.from('chat_messages').select('id').limit(1);
    if (error) return; // table abhi na bani ho to local bana rahe — agle login par phir koshish
    if (data && data.length) {
      try { localStorage.removeItem(LOCAL_CHAT_KEY); } catch {}
      return;
    }
    const base = Date.now();
    const rows = local.map((m, i) => ({
      user_id: currentUser.id, role: m.role, text: m.text,
      created_at: new Date(base + i * 1000).toISOString()
    }));
    const { error: insErr } = await supabase.from('chat_messages').insert(rows);
    if (!insErr) { try { localStorage.removeItem(LOCAL_CHAT_KEY); } catch {} }
  } catch { /* migration fail ho to local history device par bani rehti hai */ }
}

/* 🧹 Chat saaf — pehle confirm, phir account/device se delete, phir taaza start.
   startChat aaj ka check-in DONE ho to khud sirf summary line dikhata hai. */
async function clearChatHistory() {
  if (!confirm('Puri chat saaf kar dun? Ye wapas nahi aayegi.')) return;
  try {
    if (currentUser) {
      const { error } = await supabase.from('chat_messages').delete().eq('user_id', currentUser.id);
      if (error) throw error;
    } else {
      try { localStorage.removeItem(LOCAL_CHAT_KEY); } catch {}
    }
  } catch {
    await botSay('Chat saaf nahi ho payi 😔 Net check karke phir try karo.', 150, { skipPersist: true });
    return;
  }
  pendingPhoto = null;
  chatRestored = true; restoredInDom = false;
  startChat();
}
$('#chatClearBtn').addEventListener('click', clearChatHistory);

init();
