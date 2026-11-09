<div align="center">

<img src="og-image.png" alt="Ortho — Tumhara Health Saathi" width="720">

# 🌿 Ortho — Tumhara Health Saathi

**Roz ka sinus check-in, pattern record, ENT doctors aur sinus guide — ek saaf, shant app me.**

![PWA](https://img.shields.io/badge/PWA-installable-0B6E4F?style=flat-square)
![Backend](https://img.shields.io/badge/Backend-Supabase-3ECF8E?style=flat-square)
![Hosting](https://img.shields.io/badge/Hosting-Vercel-000000?style=flat-square)
![Language](https://img.shields.io/badge/UI-Roman%20Hinglish-F59E0B?style=flat-square)

</div>

## Kya hai ye?

Ortho ek **personal health-assistant web app (PWA)** hai — allergic sinusitis ke roz ke check-in aur record ke liye bana hai. Phone par home screen se install hokar bilkul app ki tarah khulta hai, aur roz subah pyaar bhari Hinglish notification bhi bhej sakta hai.

> ⚕️ **Seema (hamesha yaad rahe):** Ortho sirf **jankari aur record** ka saathi hai. Ye **diagnosis nahi** karta aur **dawa ki salah nahi** deta — wo hamesha doctor ka kaam hai.

## Features

- 💬 **Guided check-in chat** — Ortho ek-ek karke 3 sawal puchta hai (neend, naak band 0–10, sar dard 0–10), tap-wale option chips ke saath. Jawab ke baad chhota summary aur numbers ke hisaab se guide se ek kaam ki tip. *(Ye chat rule-based guided flow hai — koi AI brain nahi; asli samajh-wali baat-cheet WhatsApp par Zara se hoti hai.)*
- ✅ **Check-in form** — wahi check-in form se bhi: sliders, neend ke chips, padhai par asar, note. Chat aur form **ek hi din ke ek hi record** ko likhte hain.
- 📈 **Record / pattern** — poori history, naak band + sar dard ka chart, average aur sabse kharab din. Har purana record **badla aur mitaya** ja sakta hai — kuch locked nahi.
- 🩺 **Doctors** — ENT shortlist tap-to-call ke saath; apna doctor khud **add/delete** bhi kar sakte ho.
- 📖 **Sinus guide** — sinus ki banawat, allergy ka mechanism, spray ka sahi tareeka, doctor kya check karta hai, ilaaj ki seedhi (general jankari) aur **khatre ke sanket**.
- 👤 **Profile** — takleef ka summary; dawa ka naam/time (jab doctor de) aur apni note khud edit kar sakte ho.
- 🔔 **Web Push** — roz subah ka reminder, Muse jaise warm Hinglish words me. *(WhatsApp wala subah ka check-in iske saath-saath chalta rahega — push uska badlaav nahi, ek aur sahulat hai.)*

## Privacy

- Login zaroori hai (email magic-link); bina login ke koi data nahi dikhta.
- Har user ka data **sirf usi ke account** me rehta hai — database par Row Level Security (RLS) lagi hai.
- Service-role key client code me kabhi nahi hoti; browser me sirf RLS-protected anon key jati hai.

## Tech

| Hissa | Tech |
|---|---|
| Frontend | Static HTML/CSS/JS (koi framework nahi), PWA (manifest + service worker + push) |
| Backend | Supabase — Postgres + Auth + Edge Functions |
| Hosting | Vercel |
| Push | Web Push (VAPID) — private key sirf Supabase secret me |

## Chalana / deploy karna

Code taiyaar hai. Backend provisioning aur live deploy ke exact steps ke liye dekho:
**[`docs/PROVISION-RUNBOOK.md`](docs/PROVISION-RUNBOOK.md)**

## Live link

⏳ Deploy hote hi yahan lagega. (Repo: https://github.com/Ahmadraza970/ortho)

## Honest limits

- Chat **guided/rule-based** hai — free-form sawalon ke jawab nahi deta.
- Push notification ke liye app ko ek baar home screen par install karke "Notifications ON karo" tap karna padta hai.
- Magic-link login free email limit par chalta hai — ek user ke liye kaafi hai.

---

<div align="center">

**Made by Ahmad** · [ahmadrazaa.me](https://ahmadrazaa.me)

</div>
