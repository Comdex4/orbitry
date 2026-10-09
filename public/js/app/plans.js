// Display copy for paid plans. Charges are set by the Stripe prices configured on the Worker;
// keep these labels in step with them.
export const PLANS = {
  api_pro: { name: 'API Pro', price: '$19 / month', blurb: '100,000 requests a day, bulk catalog downloads, element history, and re-entry alerts by email or webhook.' },
  planner: { name: 'Astro Planner', price: '$6 / month', blurb: 'Nightly target recommendations for your sky and gear, satellite-streak warnings for your exposures, and a nightly plan by email.' }
};
