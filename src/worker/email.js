// Transactional email through Resend's HTTP API. Without RESEND_API_KEY (local dev),
// messages are logged instead of sent.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function sendEmail(env, { to, subject, text, html }) {
  if (!env.RESEND_API_KEY) {
    console.log(`[email to ${to}] ${subject}\n${text}`);
    return { logged: true };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text, html })
  });
  if (!res.ok) throw new Error(`Email send failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function layout(title, body, footer) {
  return `<!doctype html><html><body style="margin:0;background:#05070d;color:#e9edf6;font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:28px 20px"><div style="font:600 18px sans-serif;margin-bottom:18px">Orbitry</div>
<h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>${body}
<p style="color:#6b778e;font-size:12px;margin-top:28px;border-top:1px solid #1c2333;padding-top:12px">${footer}</p></div></body></html>`;
}

export function loginEmail(link, minutes) {
  return {
    subject: 'Your Orbitry sign-in link',
    text: `Sign in to Orbitry: ${link}\n\nThis link works once and expires in ${minutes} minutes. If you didn't ask for it, you can ignore this email.`,
    html: layout('Sign in to Orbitry', `<p><a href="${esc(link)}" style="display:inline-block;background:#5cc8ff;color:#04121c;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:600">Sign in</a></p>
      <p style="color:#93a0b8">This link works once and expires in ${minutes} minutes.</p>`, "If you didn't ask for this, you can ignore it.")
  };
}

const manage = (site) => `You're receiving this because you set up an alert on Orbitry. <a href="${site}/account/" style="color:#93a0b8">Manage or turn off alerts</a>.`;

export function passEmail(site, { name, place, tz, pass, norad }) {
  const t = (d) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz || 'UTC' }) + (tz ? '' : ' UTC');
  const day = new Date(pass.start.time).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz || 'UTC' });
  const lines = [
    `Appears: ${t(pass.start.time)} in the ${pass.start.dir}, ${Math.round(pass.start.el)}° up`,
    `Highest: ${t(pass.max.time)} in the ${pass.max.dir}, ${Math.round(pass.max.el)}° up`,
    `Disappears: ${t(pass.end.time)} in the ${pass.end.dir}, ${Math.round(pass.end.el)}° up`
  ];
  if (pass.magnitude != null) lines.push(`Estimated brightness: magnitude ${pass.magnitude.toFixed(1)}`);
  return {
    subject: `${name} passes over ${place || 'you'} at ${t(pass.start.time)}`,
    text: `${name} will be visible from ${place || 'your location'} on ${day}.\n\n${lines.join('\n')}\n\nDetails: ${site}/passes/?norad=${norad}\nManage alerts: ${site}/account/`,
    html: layout(`${name} is passing over ${place || 'you'}`, `<p>${esc(day)}</p><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      <p><a href="${site}/passes/?norad=${norad}" style="color:#5cc8ff">See the sky path</a></p>
      <p style="color:#93a0b8;font-size:13px">Times are predictions from public orbital data and are usually right to within a minute. Clouds not included.</p>`, manage(site))
  };
}

export function reentryEmail(site, { name, norad, decay_date }) {
  return {
    subject: `${name} (NORAD ${norad}) has re-entered`,
    text: `${name} (NORAD ${norad}) has been recorded as re-entered${decay_date ? ` on ${decay_date}` : ''}, according to CelesTrak's catalog.\n\nRecent re-entries: ${site}/launches/#down\nManage alerts: ${site}/account/`,
    html: layout(`${name} has re-entered`, `<p>${esc(name)} (NORAD ${norad}) has been recorded as re-entered${decay_date ? ` on ${esc(decay_date)}` : ''}, according to CelesTrak's catalog.</p>
      <p><a href="${site}/launches/#down" style="color:#5cc8ff">Recent re-entries</a></p>`, manage(site))
  };
}

export function plannerEmail(site, plan) {
  const dark = plan.dark ? `${plan.dark.start} to ${plan.dark.end}` : 'No astronomical darkness tonight';
  const top = plan.targets.slice(0, 6);
  const text = [`Tonight at ${plan.place}`, `Darkness: ${dark}`, `Moon: ${plan.moon}`, `Clouds: ${plan.clouds}`, '', 'Best targets:',
    ...top.map((t) => `- ${t.name}: best around ${t.best}, up to ${t.alt}° high${t.note ? ` (${t.note})` : ''}`), '',
    `Open the planner for streak warnings: ${site}/planner/`].join('\n');
  return {
    subject: `Tonight's sky: ${plan.verdict}`,
    text,
    html: layout(`Tonight at ${plan.place}: ${plan.verdict}`, `<p>Darkness: ${esc(dark)}<br>Moon: ${esc(plan.moon)}<br>Clouds: ${esc(plan.clouds)}</p>
      <h2 style="font-size:16px">Best targets</h2><ol>${top.map((t) => `<li><b>${esc(t.name)}</b>: best around ${esc(t.best)}, up to ${t.alt}° high${t.note ? ` <span style="color:#93a0b8">(${esc(t.note)})</span>` : ''}</li>`).join('')}</ol>
      <p><a href="${site}/planner/" style="color:#5cc8ff">Open the planner</a> for satellite-streak warnings for your exact exposures.</p>`,
    `Nightly planner email from Orbitry. <a href="${site}/planner/" style="color:#93a0b8">Change or stop it</a>.`)
  };
}
