// Ortho — send-push Edge Function
// Roz subah ka check-in reminder push, Zara/Muse jaise warm Hinglish words me.
// Trigger: POST with header  x-push-secret: <PUSH_CRON_SECRET>  (Supabase secret)
// Secrets needed: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_CRON_SECRET
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY Supabase khud inject karta hai.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const TITLE = "Ortho 🌤️";
const BODY = "Subah ho gayi Ahmad 🌤️ Naak kaisi hai aaj? 2 minute me check-in kar lo — Ortho";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const secret = Deno.env.get("PUSH_CRON_SECRET");
  if (!secret || req.headers.get("x-push-secret") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT") || "mailto:hello@ahmadrazaa.me",
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!,
  );

  const { data: subs, error } = await supabase.from("push_subscriptions").select("*");
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const payload = JSON.stringify({ title: TITLE, body: BODY, url: "/?tab=chat" });
  let sent = 0, cleaned = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        await supabase.from("push_subscriptions").delete().eq("id", s.id);
        cleaned++;
      }
    }
  }
  return Response.json({ ok: true, sent, cleaned, total: subs?.length ?? 0 });
});
