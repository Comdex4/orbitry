// Stripe Checkout and the customer portal for paid plans, plus the webhook that keeps
// each user's plan in step with their subscriptions.
import { HttpError, json, readJson } from './http.js';

const PRODUCTS = { api_pro: 'STRIPE_PRICE_API_PRO', planner: 'STRIPE_PRICE_PLANNER' };

async function stripe(env, path, params) {
  if (!env.STRIPE_SECRET_KEY) throw new HttpError(503, 'Payments are not configured yet.');
  const body = new URLSearchParams();
  const add = (k, v) => { if (v && typeof v === 'object') for (const [kk, vv] of Object.entries(v)) add(`${k}[${kk}]`, vv); else if (v != null) body.append(k, String(v)); };
  for (const [k, v] of Object.entries(params || {})) add(k, v);
  const res = await fetch(`https://api.stripe.com/v1/${path}`, { method: 'POST', headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' }, body });
  const j = await res.json();
  if (!res.ok) { console.error('Stripe error', j); throw new HttpError(502, 'The payment provider returned an error.'); }
  return j;
}

export async function checkout(req, env, user) {
  const { plan } = await readJson(req);
  const priceVar = PRODUCTS[plan];
  if (!priceVar) throw new HttpError(400, 'Unknown plan');
  if (!env[priceVar]) throw new HttpError(503, 'This plan is not available yet.');
  if ((plan === 'api_pro' && user.api_plan === 'pro') || (plan === 'planner' && user.planner_active)) throw new HttpError(409, 'You already have this plan.');
  const s = await stripe(env, 'checkout/sessions', {
    mode: 'subscription',
    'line_items[0][price]': env[priceVar], 'line_items[0][quantity]': 1,
    ...(user.stripe_customer ? { customer: user.stripe_customer } : { customer_email: user.email }),
    client_reference_id: user.id,
    'subscription_data[metadata][user_id]': user.id, 'subscription_data[metadata][plan]': plan,
    'metadata[plan]': plan,
    success_url: `${env.SITE_URL}/account/?upgraded=${plan}`, cancel_url: `${env.SITE_URL}/account/`,
    allow_promotion_codes: 'true'
  });
  return json({ url: s.url });
}

export async function portal(env, user) {
  if (!user.stripe_customer) throw new HttpError(400, 'No billing account yet.');
  const s = await stripe(env, 'billing_portal/sessions', { customer: user.stripe_customer, return_url: `${env.SITE_URL}/account/` });
  return json({ url: s.url });
}

// Stripe-Signature: t=<unix>,v1=<hex hmac of "t.payload">
export async function verifyStripeSignature(payload, header, secret, toleranceSec = 300, now = Date.now()) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k, v]));
  const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return sigs.some((s) => s.length === hex.length && timingSafeEqual(s, hex));
}

function timingSafeEqual(a, b) { let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

async function applyPlan(env, userId, plan, active, customer) {
  if (!userId || !PRODUCTS[plan]) return;
  if (customer) await env.DB.prepare('UPDATE users SET stripe_customer = ? WHERE id = ?').bind(customer, userId).run();
  if (plan === 'api_pro') await env.DB.prepare('UPDATE users SET api_plan = ? WHERE id = ?').bind(active ? 'pro' : 'free', userId).run();
  if (plan === 'planner') await env.DB.prepare('UPDATE users SET planner_active = ? WHERE id = ?').bind(active ? 1 : 0, userId).run();
}

export async function webhook(req, env) {
  const payload = await req.text();
  if (!(await verifyStripeSignature(payload, req.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET))) return json({ error: 'Bad signature' }, { status: 400 });
  const event = JSON.parse(payload), o = event.data?.object || {};
  switch (event.type) {
    case 'checkout.session.completed':
      await applyPlan(env, o.client_reference_id, o.metadata?.plan, true, o.customer);
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const active = event.type !== 'customer.subscription.deleted' && ['active', 'trialing', 'past_due'].includes(o.status);
      await applyPlan(env, o.metadata?.user_id, o.metadata?.plan, active, o.customer);
      break;
    }
  }
  return json({ received: true });
}
