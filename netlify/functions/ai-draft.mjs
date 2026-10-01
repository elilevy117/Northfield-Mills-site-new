// netlify/functions/ai-draft.mjs
// Writes email drafts with OpenAI for the Northfield Mills team portal:
//   - lead follow-ups (Overview → Preview & send)
//   - new emails from Gmail Inbox → Compose → "Write with ChatGPT" (mode: "compose")
// The OpenAI key is read from the Netlify environment variable OPENAI_API_KEY. It is never sent to the browser.
// Optional: OPENAI_MODEL (defaults to gpt-4o-mini, which is fast enough for Netlify's 10-second limit).

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
- Sign-off: if has_signature is true, end with "Best," (or a similar sign-off) on its own line and write nothing after it, because the sender's email signature is added automatically. Otherwise sign off with the sender's name on one line and "Northfield Mills" on the next.
- Subject: short, plain, no "Re:".

Reply with JSON only: {"subject": "...", "body": "..."}`;

const SYSTEM_COMPOSE = `You write emails for a team member at Northfield Mills, a heritage-inspired, gluten-free baking-mix brand that is relaunching. The sender tells you what the email should say; write it.

Rules:
- Plain text only. No markdown, no placeholders like [Name], no emojis.
- Follow the sender's instructions closely. Match the requested tone.
- Keep it as short as the message allows; usually under 180 words unless the instructions ask for more.
- Greet the recipient by first name if one is given; otherwise use "Hi there," (or "Hello," for a formal tone).
- Use only facts from the instructions and context. Never invent prices, dates, meetings, products, numbers or earlier conversations.
- Sign-off: if has_signature is true, end with "Best," (or a similar sign-off) on its own line and write nothing after it, because the sender's email signature is added automatically. Otherwise sign off with the sender's name on one line and "Northfield Mills" on the next.
- Subject: short and plain. If a subject is already given, return it unchanged.

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

  const compose = d.mode === 'compose';
  if (compose && !clip(d.instructions, 10)) return json(400, { error: 'Say what the email should be about.' });
  const name = clip(d.contactName, 80);
  const ctx = compose ? {
    instructions: clip(d.instructions, 2000),
    tone: clip(d.tone, 60) || 'friendly and professional',
    recipient_email: clip(d.to, 160),
    recipient_name: name,
    recipient_first_name: name.split(' ')[0] || '',
    recipient_title: clip(d.title, 80),
    recipient_company: clip(d.company, 120),
    subject: clip(d.subject, 200),
    sender_name: clip(d.myName, 80) || 'The Northfield Mills team',
    has_signature: d.hasSignature === true,
  } : {
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
    has_signature: d.hasSignature === true,
  };

  // Netlify stops functions after 10 seconds. Give OpenAI 8.5 so we can still answer with a clear message.
  const model = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  const reasoning = /^(o\d|gpt-5)/i.test(model); // "thinking" models: slower, need different settings
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8500);
  let r, j;
  try {
    r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        // emails are short: capping the length keeps replies fast
        max_completion_tokens: reasoning ? 2000 : 600,
        ...(reasoning ? { reasoning_effort: 'low' } : {}),
        messages: [
          { role: 'system', content: compose ? SYSTEM_COMPOSE : SYSTEM },
          { role: 'user', content: JSON.stringify(ctx) },
        ],
      }),
    });
    j = await r.json().catch(() => ({}));
  } catch (e) {
    if (e && e.name === 'AbortError')
      return json(504, {
        error: reasoning
          ? `ChatGPT (${model}) took too long. "Thinking" models are slow for Netlify's 10-second limit: set OPENAI_MODEL to gpt-4o-mini in Netlify.`
          : 'ChatGPT took too long to answer. Try again.',
        code: 'slow',
      });
    return json(502, { error: 'Couldn’t reach OpenAI.' });
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) {
    const err = (j && j.error) || {};
    const why =
      r.status === 401 ? 'OpenAI rejected the API key. Check OPENAI_API_KEY in Netlify, then redeploy.'
      : err.code === 'insufficient_quota' ? 'Your OpenAI account is out of credit. Add billing at platform.openai.com.'
      : r.status === 429 ? 'OpenAI is limiting requests right now. Wait a moment and try again.'
      : err.code === 'model_not_found' || r.status === 404 ? `The model "${model}" isn’t available on your OpenAI account.` + (model === 'gpt-4o-mini' ? ' Set OPENAI_MODEL in Netlify to a model your account can use.' : ' Set OPENAI_MODEL to gpt-4o-mini in Netlify.')
      : err.message || 'OpenAI didn’t answer.';
    return json(502, { error: why, code: r.status === 401 || err.code === 'insufficient_quota' || err.code === 'model_not_found' ? 'setup' : undefined });
  }

  let out = {};
  try {
    out = JSON.parse((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '{}');
  } catch {
    out = {};
  }
  const body = String(out.body || '').trim();
  if (!body) {
    const cutOff = j.choices && j.choices[0] && j.choices[0].finish_reason === 'length';
    return json(502, { error: cutOff ? 'ChatGPT ran out of room before finishing. Try again.' : 'OpenAI returned an empty draft.', code: 'slow' });
  }
  const subject = compose && ctx.subject ? ctx.subject : clip(out.subject, 150).replace(/^re:\s*/i, '');
  return json(200, { subject, body: body.slice(0, 6000), ...(compose ? { mode: 'compose' } : {}) });
};
