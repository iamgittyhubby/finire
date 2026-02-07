import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  // Get all enabled reminders with timezone
  const { data: reminders, error: remindersError } = await supabase
    .from("reminders")
    .select("user_id, time_local, timezone")
    .eq("enabled", true)

  if (remindersError) {
    console.error("Error fetching reminders:", remindersError)
    return new Response("Error fetching reminders", { status: 500 })
  }

  if (!reminders || reminders.length === 0) {
    return new Response("No enabled reminders", { status: 200 })
  }

  // Get current time and check which users should receive reminders
  const usersToNotify: string[] = []

  for (const reminder of reminders) {
    // Get current time in user's timezone
    const now = new Date()
    const userTime = new Intl.DateTimeFormat("en-US", {
      timeZone: reminder.timezone || "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now)

    // userTime will be like "08:30" or "14:00"
    // Compare with reminder.time_local (also in "HH:MM" format)
    if (userTime === reminder.time_local) {
      usersToNotify.push(reminder.user_id)
    }
  }

  if (usersToNotify.length === 0) {
    return new Response("No reminders due now", { status: 200 })
  }

  // Fetch user emails
  const { data: usersData, error: usersError } =
    await supabase.auth.admin.listUsers()

  if (usersError) {
    console.error("Error fetching users:", usersError)
    return new Response("Error fetching users", { status: 500 })
  }

  const emails = usersData.users
    .filter((u) => usersToNotify.includes(u.id))
    .map((u) => u.email)
    .filter(Boolean) as string[]

  if (emails.length === 0) {
    return new Response("No emails to send", { status: 200 })
  }

  // Send emails via Resend
  const resendApiKey = Deno.env.get("RESEND_API_KEY")
  if (!resendApiKey) {
    console.error("RESEND_API_KEY not configured")
    return new Response("Email service not configured", { status: 500 })
  }

  const results = []
  for (const email of emails) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Finire <noreply@finire.app>",
          to: email,
          subject: "Time to write",
          html: `
            <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
              <h1 style="font-size: 24px; font-weight: normal; font-style: italic; margin-bottom: 24px;">Finire</h1>
              <p style="font-size: 16px; line-height: 1.6; color: #333;">
                This is your daily reminder to write.
              </p>
              <p style="font-size: 16px; line-height: 1.6; color: #333;">
                300 words. That's all it takes to keep moving forward.
              </p>
              <a href="https://finire.app" style="display: inline-block; margin-top: 24px; padding: 12px 24px; background: #1a1a1a; color: #fff; text-decoration: none; font-size: 14px;">
                Start writing
              </a>
              <p style="margin-top: 40px; font-size: 12px; color: #999;">
                You're receiving this because you set a daily reminder on Finire.
              </p>
            </div>
          `,
        }),
      })
      
      if (res.ok) {
        results.push({ email, status: "sent" })
      } else {
        const errorText = await res.text()
        console.error(`Failed to send to ${email}:`, errorText)
        results.push({ email, status: "failed", error: errorText })
      }
    } catch (err) {
      console.error(`Error sending to ${email}:`, err)
      results.push({ email, status: "error", error: String(err) })
    }
  }

  return new Response(JSON.stringify({ sent: results.length, results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
})
