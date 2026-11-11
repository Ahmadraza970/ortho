<div align="center">

<img src="og-image.png" alt="Ortho — Your Health Companion" width="720">

# 🌿 Ortho — Your Health Companion

**Daily sinus check-in, health records, AI answers, medicine identification from a photo, ENT doctors and a sinus guide — in one calm, clean app.**

![Live](https://img.shields.io/badge/Status-Live-0B6E4F?style=flat-square)
![Android APK](https://img.shields.io/badge/Android-APK%20download-3DDC84?style=flat-square)
![PWA](https://img.shields.io/badge/PWA-installable-0B6E4F?style=flat-square)
![Backend](https://img.shields.io/badge/Backend-Supabase-3ECF8E?style=flat-square)
![Hosting](https://img.shields.io/badge/Hosting-Vercel-000000?style=flat-square)
![Language](https://img.shields.io/badge/UI-English-F59E0B?style=flat-square)

### 🔗 Landing Page

**📲 https://orthodoctorr.vercel.app/download.html**

_That is also where you get the Android APK and the link to the web version._

</div>

## What is it?

Ortho is a **personal health-assistant app (PWA + Android)** — started for the daily check-in and record of allergic sinusitis, and now an **all-in-one health information companion**. Install it on your phone and it opens just like an app — from the browser too, and from the Android APK.

> ⚕️ **Limit (always remember):** Ortho is only a companion for **information and records**. It does **not** give a firm diagnosis and does **not** give personal prescriptions (medicine advice) — that is always the doctor's job.

## Features

- 💬 **AI chat (with a real brain)** — ask any health question openly: medicine information, common illnesses, home remedies, surgery basics, which specialist when, dental basics, sexual health and healthy information about periods. Answers come in the language you ask in — English in, English out; Hinglish in, Hinglish out. Chat history stays saved in your account.
- 📷 **Medicine identification from a photo** — send a photo of a medicine packet/strip; the app first gets the **name confirmed** by you, then tells you what that medicine is for.
- ✅ **Daily check-in** — from chat or from the form: sleep, blocked nose (0–10), headache (0–10), effect on study, note. Chat and form write to the **same single record for the same day**; once the day is done, the app does not keep nagging you.
- 📈 **Records / patterns** — full history, a chart of blocked nose + headache, averages and worst days. Every old record can be **edited and deleted** — nothing is locked.
- 🩺 **Doctors** — a list of ENT doctors with tap-to-call; you can **add/edit/delete** your own doctor too.
- 📖 **Sinus guide** — how the sinuses are built, how allergy works, the right way to use a spray, what a doctor checks, the treatment ladder (general information) and **danger signs (red flags)**.
- 👍👎 **Feedback on every answer** — 👍/👎 under every AI answer; feedback is reviewed to keep improving the app.
- 👤 **Profile** — a summary of your troubles; the medicine name/time given by your doctor and your own note can be edited by you.
- 🔔 **Web Push** — a gentle English reminder every morning (the function is live; turn it ON with one tap in the app).
- 🔐 **Login** — with **Google** or with the **6-digit code that arrives by email**. Chat and guide work even without login; when you log in, your data is saved safely in your account.

## Privacy

- Every user's data stays **only in that user's own account** — Row Level Security (RLS) is on the database; no user can see another user's records.
- The service-role key is never in client code; only the RLS-protected anon key goes to the browser. The AI's API key stays only on the server (Edge Function).
- Delete means real delete — a record that is deleted is gone.

## Tech

| Part | Tech |
|---|---|
| Frontend | Static HTML/CSS/JS (no framework), PWA (manifest + service worker) |
| Backend | Supabase — Postgres + Auth + Edge Functions |
| AI | Supabase Edge Function → OpenRouter (free models — text + vision) |
| Email | Custom SMTP (Zoho) — login code arrives under the name "Ortho" |
| Hosting | Vercel (auto-deploy from GitHub `main`) |
| Android | TWA (Bubblewrap) — signed APK, the web app inside the app |
| Push | Web Push (VAPID) — private key only in a Supabase secret |

## Running / deploying

For the exact backend provisioning and deploy steps, see:
**[`docs/PROVISION-RUNBOOK.md`](docs/PROVISION-RUNBOOK.md)**

## Honest limits

- The AI runs on a **free quota** (~50 questions/day across all users) — if the quota runs out, AI answers may pause for a while; check-in, records, doctors and guide always keep working.
- Photo identification can sometimes read a wrong name — that is why the app first gets it **confirmed** by you, and the information is always general, never personal advice.
- Google sign-in is currently in testing mode (registered test users only); email-code login is open to everyone.

---

<div align="center">

**Made by Ahmad** · [ahmadrazaa.me](https://ahmadrazaa.me)

</div>
