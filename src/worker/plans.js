// What each plan includes. Prices live in Stripe; set the price IDs as secrets
// (STRIPE_PRICE_API_PRO, STRIPE_PRICE_PLANNER) and keep the display prices in public/js/app/plans.js in step.
export const API_TIERS = {
  anonymous: { label: 'No key', perDay: 500, bulk: false, history: false, alerts: false },
  free: { label: 'Free key', perDay: 2000, bulk: false, history: false, alerts: false },
  pro: { label: 'API Pro', perDay: 100000, bulk: true, history: true, alerts: true }
};

export const LIMITS = { locations: 10, favorites: 200, passAlerts: 10, reentryAlerts: 100, keys: 5 };

export const ATTRIBUTION = 'Data from Orbitry (https://orbitry.net), built on CelesTrak, GCAT (J. McDowell, CC BY 4.0), NASA/JPL Horizons and The Space Devs.';
