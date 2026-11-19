// Agent talk-back facts: the public SolveLang shelf, exactly as stated
// on the services page (site/app/(english)/services/page.tsx in this
// repository — standardPacks, highPowerPacks, and the API plan cards).
//
// This module is deliberately dependency-free: it imports nothing, and
// only the agent talk-back surface imports it. The read-only agent
// doorway therefore cannot reach account, tenant, ledger, Stripe, or
// GitHub code — the separation is verifiable by import inspection.
// Every number here is pinned by test/agent-talkback.test.js; if the
// shelf ever changes, the services page and this module change together
// and the pin fails until both agree.

export const RUNNER_MINUTES_FACTS = Object.freeze({
  product: "SolveLang Runner Minutes",
  summary:
    "Prepaid GitHub Actions runner minutes. Buy a pack once — minutes never auto-renew — connect GitHub a single time, and queued jobs in your repositories run on SolveLang-provisioned Linux machines automatically. Every job runs on a fresh machine created for that job alone and destroyed when the job ends.",
  currency: "USD",
  pricesIncludeTax: true,
  priceNote: "Runner-minutes prices include tax: the price shown for a pack is the full amount charged for it.",
  standard: Object.freeze({
    pool: "standard",
    runsOnLabel: "solvelang-runners-standard",
    machines: "2-vCPU-class machines",
    pricePerMinute: 0.004,
    packs: Object.freeze([
      Object.freeze({ minutes: 5_000, price: 20 }),
      Object.freeze({ minutes: 25_000, price: 100 }),
      Object.freeze({ minutes: 100_000, price: 400 }),
    ]),
  }),
  highPower: Object.freeze({
    pool: "high-power",
    runsOnLabel: "solvelang-runners-high-power",
    machines: "16-vCPU-class machines with a guaranteed start and a colocated cache",
    note: "The per-minute price falls as packs grow.",
    packs: Object.freeze([
      Object.freeze({ minutes: 1_000, price: 80 }),
      Object.freeze({ minutes: 2_000, price: 140 }),
      Object.freeze({ minutes: 3_000, price: 192 }),
      Object.freeze({ minutes: 4_000, price: 236 }),
      Object.freeze({ minutes: 5_000, price: 275 }),
      Object.freeze({ minutes: 6_000, price: 306 }),
      Object.freeze({ minutes: 7_000, price: 336 }),
      Object.freeze({ minutes: 8_000, price: 360 }),
      Object.freeze({ minutes: 9_000, price: 382.5 }),
      Object.freeze({ minutes: 10_000, price: 400 }),
    ]),
  }),
  metering: Object.freeze({
    billingGranularity: "per second, measured from each job's own start and finish timestamps on GitHub",
    minimumSecondsPerJob: 10,
    spotMultiplier: 1,
    onDemandMultiplier: 2,
    onDemandNote:
      "Most jobs run on spare cloud capacity (Spot) and draw the balance at 1x. If Spot cannot start a job within about 90 seconds, guaranteed on-demand capacity starts it instead; those on-demand minutes draw at 2x and are always shown as their own separate line in usage.",
    packsAutoRenew: false,
    expiryMonthsAfterPurchase: 12,
    platform: "Linux runners for private repositories",
  }),
  speedNote:
    "Faster processing is never free — it always has one of two prices: work that starts on guaranteed on-demand capacity consumes minutes at 2x, and work that runs on the premium High-Power machines draws from the separate High-Power balance, bought at the High-Power prices.",
});

export const API_PLAN_FACTS = Object.freeze({
  product: "SolveLang API access plans",
  summary: "Monthly weighted-credit API plans for the SolveLang API and repository-audit integrations.",
  creditDefinition:
    "One base credit covers up to 5,000 input tokens and 1,000 output tokens; larger jobs consume multiple credits, and every plan has a hard monthly limit.",
  currency: "USD",
  plans: Object.freeze([
    Object.freeze({ name: "developer", displayName: "Developer", pricePerMonth: 49, monthlyCredits: 1_000, maxActiveKeys: 2 }),
    Object.freeze({ name: "pro", displayName: "Pro", pricePerMonth: 199, monthlyCredits: 10_000, maxActiveKeys: 3 }),
    Object.freeze({ name: "business", displayName: "Business", pricePerMonth: 699, monthlyCredits: 50_000, maxActiveKeys: 5 }),
  ]),
});

export const HOW_BUYING_WORKS = [
  "Buying SolveLang runner minutes or an API plan works like this:",
  "1. Create an account and sign in at https://www.solve-lang.com.",
  "2. Buy on SolveLang's own embedded payment pages on solve-lang.com. Buying happens only on SolveLang's own checkout page — you are never sent to an external checkout.",
  "3. Runner-minute packs are prepaid and never auto-renew. Purchased minutes credit to your account balance, and prepaid minutes expire 12 months after purchase.",
  "4. Connect GitHub once: sign in, install the SolveLang GitHub App, pick your repositories, and accept the permissions. From then on, queued jobs in the connected repositories are detected, run, metered per second (10-second minimum per job), and settled against your balance automatically, with nothing left to start by hand.",
  "5. Jobs pick their pool by the runs-on label in your workflow file — [self-hosted, solvelang-runners-standard] for Standard or [self-hosted, solvelang-runners-high-power] for High-Power — and labeling a pull request 'solvelang' routes that pull request's jobs to SolveLang runners.",
  "This agent surface is read-only: it cannot create an account, start a checkout, or charge anything. Purchases happen only on solve-lang.com, by the account holder.",
].join("\n");
