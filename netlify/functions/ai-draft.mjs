// netlify/functions/ai-draft.mjs
// Writes a suggested lead follow-up email with OpenAI for the Northfield Mills team portal.
// The OpenAI key is read from the Netlify environment variable OPENAI_API_KEY. It is never sent to the browser.
// Optional: OPENAI_MODEL (defaults to gpt-4o-mini).

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

const SYSTEM = `You write short follow-up emails to manufacturers and business contacts for Northfield Mills, a heritage-inspired, gluten-free baking-mix brand that is relaunching.

Rules:
- Plain text only. No markdown, no placeholders like [Name], no emojis.
- 50 to 110 words for the body.
- Greet the contact by first name if one is given; otherwise use "Hi there,".
- Warm, direct and professional. One clear, easy ask (for example a short call or a reply).
- Use only facts in the context. Never invent prices, dates, meetings, products, numbers or earlier conversations.
- If there is an earlier email excerpt, follow on from it naturally without quoting it.
- "Follow-up #1" is a friendly nudge. "Follow-up #2" adds a little more reason to reply. "Final follow-up" politely closes the loop and leaves the door open.
- Sign off with the sender's name on one line and "Northfield Mills" on the next.
- Subject: short, plain, no "Re:".

Reply with JSON only: {"subject": "...", "body": "..."}`;

export const handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });

  // Only signed-in portal users (Netlify Identity) can use this
  const user = context.clientContext && context.clientContext.user;
  if (!user) return json(401, { error: 'Sign in to the portal first.' });

  const key = process.env.OPENAI_API_KEY;
  if (!key) return json(503, { error: 'OPENAI_API_KEY isn’t set in Netlify yet.', code: 'setup' });

  let d;
  try {
    d = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Bad request.' });
  }

  const name = clip(d.contactName, 80);
  const ctx = {
    follow_up: clip(d.stage, 40) || 'Follow-up #1',
    contact_name: name,
    contact_first_name: name.split(' ')[0] || '',
    job_title: clip(d.title, 80),
    company: clip(d.company, 120),
    sender_name: clip(d.myName, 80) || 'The Northfield Mills team',
    previous_subject: clip(d.lastSubject, 200),
    latest_email_excerpt: clip(d.lastSnippet, 1200),
    notes: clip(d.notes, 800),
    history: (Array.isArray(d.history) ? d.history : []).slice(-6).map((h) => clip(h, 140)),
  };

  let r, j;
  try {
    r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: JSON.stringify(ctx) },
        ],
      }),
    });
    j = await r.json().catch(() => ({}));
  } catch {
    return json(502, { error: 'Couldn’t reach OpenAI.' });
  }
  if (!r.ok) return json(502, { error: (j.error && j.error.message) || 'OpenAI didn’t answer.' });

  let out = {};
  try {
    out = JSON.parse((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '{}');
  } catch {
    out = {};
  }
  const body = String(out.body || '').trim();
  if (!body) return json(502, { error: 'OpenAI returned an empty draft.' });
  return json(200, { subject: clip(out.subject, 150).replace(/^re:\s*/i, ''), body: body.slice(0, 4000) });
};
