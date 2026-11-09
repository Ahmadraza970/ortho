# Ortho — Provisioning & Deploy Runbook

Code 100% taiyaar hai (`public/` = app, `supabase/` = backend). Live karne ke liye
sirf **do chhote account steps Ahmad ke** chahiye (token banana), uske baad sab
agent/script se ho jata hai. Browser-dashboard wala rasta bhi neeche hai.

---

## STEP 0 — Ahmad ke 2 token (ek-ek minute)

1. **Supabase Personal Access Token**: supabase.com → login → upar-right avatar →
   **Account → Access Tokens → Generate new token** (naam: `zara-ortho`) → token ko
   Zara ke diye **secure connector page** par paste karna hai (chat me kabhi nahi).
2. **Vercel Token**: vercel.com → login → **Settings → Tokens → Create Token**
   (naam: `zara-ortho`, scope: apna account) → dusre secure page par paste.

In tokens se `custom.supabase` aur `custom.vercel` connectors bante hain
(github-api wale PAT pattern par — credential surrogate se inject hota hai,
agent ko raw value kabhi dikhta nahi).

## STEP 1 — Connector helpers banao

`custom_connector_setup` skill se dono connectors ke helper banao
(ghapi.py ki copy pattern: `dynamic_credentials.add_surrogate_to_request`,
PROVIDER = `custom.supabase` / `custom.vercel`, hosts `api.supabase.com` /
`api.vercel.com`).

## STEP 2 — Supabase project (Management API, api.supabase.com)

1. `GET /v1/organizations` → org id lo.
2. `POST /v1/projects` — `{organization_id, name: "ortho", region: "ap-south-1",
   db_pass: <strong random>}`. db_pass ko sirf `~/workspace/work/ortho-app/.secrets/db_pass.txt`
   (chmod 600) me rakho — chat/report me kabhi nahi.
3. `GET /v1/projects/{ref}` poll karo jab tak `ACTIVE_HEALTHY`.
4. Schema chalao: `POST /v1/projects/{ref}/database/query` body
   `{query: <supabase/schema.sql ka pura text>}`.
   Verify: `GET /v1/projects/{ref}/api-keys` + ek test query
   `select tablename, rowsecurity from pg_tables where schemaname='public'`.
5. `GET /v1/projects/{ref}/api-keys` → **anon key** lo (ye public-safe hai).
   `public/config.js` me `SUPABASE_URL = https://{ref}.supabase.co` aur
   anon key bhar kar repo me commit + push karo.
6. Auth config: `PATCH /v1/projects/{ref}/auth/config` body:
   `{"site_url": "https://ortho-health.vercel.app",
     "uri_allow_list": "https://ortho-health.vercel.app/**,http://localhost:8901/**"}`
   (Email/magic-link provider default ON rehta hai.)
   *Google sign-in (optional upgrade)*: Google Cloud Console me OAuth Web client
   banao — redirect URI `https://{ref}.supabase.co/auth/v1/callback` — phir isi
   PATCH me `external_google_enabled: true, external_google_client_id,
   external_google_secret` jodo aur app ke login par Google button lagao.
7. Function secrets: `POST /v1/projects/{ref}/secrets` body (array):
   `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` (dono
   `~/workspace/work/ortho-app/.secrets/vapid.json` se — private key kabhi
   chat/report/repo me NAHI), `VAPID_SUBJECT = mailto:hello@ahmadrazaa.me`,
   `PUSH_CRON_SECRET = <strong random>` (yehi value Zara ke daily cron me bhi
   lagegi — `.secrets/push_cron_secret.txt` me rakho).
8. **send-push function deploy** (ek hi dashboard step hai):
   Supabase Dashboard → project ortho → Edge Functions → Create function →
   naam `send-push` → `supabase/functions/send-push/index.ts` ka pura code
   paste → Deploy. (verify_jwt ON rehne do — caller anon key bhejega +
   function khud `x-push-secret` check karta hai.)
9. Daily trigger: Zara-side cron roz ~05:40 IST par
   `POST https://{ref}.supabase.co/functions/v1/send-push`
   headers: `apikey: <anon key>`, `Authorization: Bearer <anon key>`,
   `x-push-secret: <PUSH_CRON_SECRET>`. (WhatsApp check-in primary channel
   rahega; ye push uske upar addition hai.)

## STEP 3 — Vercel deploy (API, api.vercel.com)

1. `POST /v11/projects?teamId=team_fCEiU7N2mNgde8lPnx82ED9a`
   body `{name: "ortho-health"}` → default domain `ortho-health.vercel.app`.
   (Ya GitHub repo connect karke auto-deploy: `gitRepository` ke saath.)
2. Files deploy: har file ke liye `POST /v2/files?teamId=...`
   (header `x-vercel-digest: <sha1 hex>`, body = raw file bytes), phir
   `POST /v13/deployments?teamId=...` body
   `{name: "ortho-health", target: "production", files: [{file: "index.html", sha: "<sha1>"}, ...]}`.
   Repo root = app root hai (saari public files root par rakhi gayi hain).
3. `GET /v13/deployments/{id}` poll → `readyState: READY`.
4. Verify: `curl -sI https://ortho-health.vercel.app/` 200 + HTML me
   `<title>Ortho` grep. README ka Live link update karo.

## STEP 4 — End-to-end test (zaroori)

1. Live site kholo (headless Chromium screenshot): login screen saaf dikhe.
2. Ahmad apne email se magic-link login kare (pehli baar) → app khule:
   - Seed: 2026-11-09 ka asal record (naak band 4) apne aap claim ho jayega.
   - Doctors: 3 default ENT entries apne aap aa jayengi.
3. Test check-in save karo (aaj ki date, nose 6, head 3) → Record tab me dikhe +
   chart update → phir test row **delete** kar do.
4. Profile: dawa naam/time test save → reload par wapas dikhe → saaf kar do.
5. Push: Profile → "Notifications ON karo" → permission allow →
   `push_subscriptions` me row aaye (SQL query se verify) → send-push ko
   sahi secret se POST → `sent >= 1` response; galat secret → 401.
6. Mobile viewport (390px) par saare tabs screenshot-check.

## STEP 5 — TWA / APK (optional, live hone ke baad)

- Tools maujood hain: `~/workspace/tools/jdk`, `~/workspace/tools/android-sdk`,
  gradle zip. `npm i -g @bubblewrap/cli` → `bubblewrap init --manifest
  https://ortho-health.vercel.app/manifest.webmanifest` → `bubblewrap build`.
- Build se mili signing key ke SHA-256 fingerprint ko
  `public/.well-known/assetlinks.json` me bhar kar redeploy karna hoga,
  warna Chrome TWA ko full-screen trust nahi karega.
- APK file Ahmad ko deliver karni hai; Play Store ki zaroorat nahi.

---

## Browser-dashboard wala rasta (agar token na mile to)

Maurya wale README-SETUP.md jaisa hi pattern: supabase.com par project banao →
SQL Editor me schema.sql chalao → Authentication → URL Configuration me
Site URL + redirect bharo → Edge Functions me send-push paste-deploy karo →
Secrets bharo → Project Settings → API se URL + anon key lekar config.js me
bharo → Vercel dashboard me GitHub repo `Ahmadraza970/ortho` import karke
deploy karo. Baaki test STEP 4 jaise hi.
