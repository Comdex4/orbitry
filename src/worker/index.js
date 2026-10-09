// Orbitry Worker: serves /api/* (everything else is static assets) and runs scheduled jobs.
import { HttpError, json, errorResponse, CORS } from './http.js';
import { startLogin, verifyPage, verifyLogin, logout, sessionUser, requireUser, publicUser } from './auth.js';
import { handleApi } from './api.js';
import * as acct from './account.js';
import { checkout, portal, webhook } from './billing.js';
import { runScheduled } from './cron.js';
import { ask, askStatus } from './ask.js';

async function route(req, env) {
  const url = new URL(req.url), p = url.pathname.replace(/\/+$/, '') || '/', m = req.method;
  const seg = p.split('/').filter(Boolean); // ['api', ...]

  if (p === '/api' || p.startsWith('/api/v1')) return handleApi(req, env, p);

  switch (`${m} ${p}`) {
    case 'POST /api/auth/start': return startLogin(req, env);
    case 'GET /api/auth/verify': return verifyPage(req);
    case 'POST /api/auth/verify': return verifyLogin(req, env);
    case 'POST /api/auth/logout': return logout(req, env);
    case 'GET /api/me': { const u = await sessionUser(req, env); return json({ user: u ? publicUser(u) : null }); }
    case 'POST /api/billing/webhook': return webhook(req, env);
    case 'GET /api/ask': return askStatus(env);
    case 'POST /api/ask': return ask(req, env);
  }

  const user = await requireUser(req, env);
  const res = (data) => json(data);
  switch (`${m} ${p}`) {
    case 'GET /api/locations': return res({ locations: await acct.listLocations(env, user.id) });
    case 'POST /api/locations': return res(await acct.addLocation(req, env, user));
    case 'GET /api/favorites': return res({ favorites: await acct.listFavorites(env, user.id) });
    case 'GET /api/alerts': return res({ alerts: await acct.listAlerts(env, user.id) });
    case 'POST /api/alerts': return res(await acct.createAlert(req, env, user));
    case 'GET /api/keys': return res({ keys: await acct.listKeys(env, user.id) });
    case 'POST /api/keys': return res(await acct.createKey(req, env, user));
    case 'GET /api/usage': return res(await acct.usage(env, user));
    case 'GET /api/planner': return res({ profile: await acct.getPlanner(env, user), active: !!user.planner_active });
    case 'PUT /api/planner': return res(await acct.savePlanner(req, env, user));
    case 'POST /api/billing/checkout': return checkout(req, env, user);
    case 'POST /api/billing/portal': return portal(env, user);
    case 'DELETE /api/account':
      if (user.api_plan === 'pro' || user.planner_active) throw new HttpError(409, 'Please cancel your subscription in the billing portal before deleting your account.');
      return acct.deleteAccount(env, user);
  }
  if (seg[1] === 'locations' && seg[2] && m === 'DELETE') {
    const r = await env.DB.prepare('DELETE FROM locations WHERE id = ? AND user_id = ?').bind(seg[2], user.id).run();
    if (!r.meta.changes) throw new HttpError(404, 'No such location');
    return res({ deleted: seg[2] });
  }
  if (seg[1] === 'favorites' && seg[2] && (m === 'PUT' || m === 'DELETE')) return res(await acct.setFavorite(env, user, seg[2], m === 'PUT'));
  if (seg[1] === 'alerts' && seg[2] && m === 'DELETE') return res(await acct.deleteAlert(env, user.id, seg[2]));
  if (seg[1] === 'keys' && seg[2] && m === 'DELETE') return res(await acct.revokeKey(env, user.id, seg[2]));
  throw new HttpError(404, 'Not found');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api')) return env.ASSETS.fetch(req);
    try { return await route(req, env); }
    catch (e) {
      const r = errorResponse(e);
      if (url.pathname.startsWith('/api/v1')) for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v);
      return r;
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(env).then((r) => console.log('scheduled', JSON.stringify(r))));
  }
};
