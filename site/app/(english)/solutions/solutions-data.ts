// Customer-facing solutions library: one entry per documented problem.
// Every entry follows the same four-part shape — Symptom, Cause, Fix,
// Example — and states only what a customer can see or do themselves.

export interface SolutionEntry {
  slug: string;
  title: string;
  summary: string;
  symptom: readonly string[];
  cause: readonly string[];
  fixIntro?: string;
  fix: readonly string[];
  exampleText?: string;
  exampleCode?: readonly string[];
  exampleOutro?: string;
}

export const solutions: readonly SolutionEntry[] = [
  {
    slug: "route-work-to-solvelang",
    title: "My own runners take every job — how do SolveLang runners get work?",
    summary: "Route chosen pull requests to SolveLang with a label, so your own fleet and SolveLang share the work the way you decide.",
    symptom: [
      "You bought runner minutes, but your jobs keep running on your own runners and your SolveLang balance never moves.",
    ],
    cause: [
      "SolveLang can only start a machine for a job that is still waiting in GitHub's queue. When one of your own runners is free, GitHub usually hands the job to it first — that is normal, and you are never billed for a job your own runners ran.",
      "If you want specific work to run on SolveLang, you have to say so. The way to say it is a label.",
    ],
    fixIntro: "Route chosen pull requests to SolveLang with label routing:",
    fix: [
      "Decide which pull requests should run on SolveLang — for example, your biggest test suites.",
      "Add the label `solvelang` to those pull requests.",
      "Add a small rule to your workflow so that jobs on a labeled pull request ask for SolveLang's runner labels, like the example below. Pull requests without the label keep the labels they already use.",
      "Add the label before the run starts. If a run is already going, push a new commit so a fresh run picks the label up.",
    ],
    exampleText: "This workflow keeps the usual self-hosted label for ordinary pull requests, and asks for SolveLang's Standard runners when the pull request carries the `solvelang` label:",
    exampleCode: [
      "jobs:",
      "  test:",
      "    runs-on: ${{ contains(github.event.pull_request.labels.*.name, 'solvelang') && fromJSON('[\"self-hosted\", \"solvelang-runners-standard\"]') || fromJSON('[\"self-hosted\"]') }}",
    ],
    exampleOutro: "Labeled pull requests now run on SolveLang and draw from your minutes; everything else runs exactly as before.",
  },
  {
    slug: "how-minutes-work",
    title: "How minutes and metering work",
    summary: "Per-second billing from the job's own start and finish times, a 10-second minimum per job, and the Spot and On-demand multipliers explained.",
    symptom: [
      "You want to know exactly what you are charged for when a job runs on a SolveLang runner — and what you are never charged for.",
    ],
    cause: [
      "Metering is based on the job itself. SolveLang reads the job's own start and finish times from GitHub and bills for that time, per second. You are only ever billed for jobs a SolveLang runner actually ran: if one of your own runners, or a GitHub-hosted runner, ran the job instead, it costs you nothing here.",
      "Two things shape the final number: a 10-second minimum per job, and a capacity multiplier. Jobs on Spot capacity bill at 1×. Jobs on On-demand capacity — the guaranteed-start option — bill at 2×, and that multiplier is always shown as its own separate line, never hidden inside the time.",
      "Faster processing is never free — it always has one of two prices. On-demand capacity starts a job right away, and consumes your minutes at 2×. The High-Power pool runs a job on larger, faster premium machines, and its minutes are a separate balance bought at the higher High-Power prices. Ordinary work — Standard machines on Spot capacity — bills at the plain 1× rate.",
      "At a zero balance, no machines launch at all: a job simply waits for another runner. You can never be charged beyond the minutes you have bought.",
    ],
    fixIntro: "How to read the numbers you see:",
    fix: [
      "When you see billed seconds for a job, it means the seconds you were charged for that job — its running time, with the 10-second minimum and the capacity multiplier applied.",
      "Compare billed seconds with the job's running time on GitHub: on Spot capacity the two match, apart from the 10-second minimum on very short jobs; on On-demand capacity the billed seconds are double the running time.",
      "Check which balance the job drew from: a job only ever draws from the pool it ran on — Standard jobs draw Standard minutes, High-Power jobs draw High-Power minutes.",
      "Keep an eye on expiry: minutes expire 12 months after purchase, and your balance view shows the earliest expiry date.",
    ],
    exampleText: "A job runs for 3 minutes 20 seconds — 200 seconds. On Spot capacity it bills 200 seconds, about 3.3 minutes. The same job on On-demand capacity bills 400 seconds (200 × 2). A very short job that runs for 6 seconds bills the 10-second minimum.",
  },
  {
    slug: "checkout-pack-switch-error",
    title: "The payment area showed an error when I switched packs",
    summary: "Switching packs during one checkout used to break the payment area. It is fixed — and an unfinished payment is never a charge.",
    symptom: [
      "You were buying runner minutes, changed your mind, and picked a different pack — and instead of a payment form for the new pack, the payment area showed an error.",
    ],
    cause: [
      "This was a bug in our checkout, not a problem with your card. Changing packs during the same checkout visit made the second choice collide with the first one on our side, and the payment area stopped with an error instead of refreshing.",
      "We fixed it on November 15, 2026: switching packs during one checkout visit now refreshes the payment area for the new pack.",
    ],
    fixIntro: "If a payment area ever shows an error, here is what to do:",
    fix: [
      "Reload the checkout page.",
      "Choose your pack again — switching packs during the visit is fine.",
      "Confirm the payment only when the amount shown is the pack you actually want.",
    ],
    exampleText: "You open the 5,000-minute pack, then switch to the 25,000-minute pack before paying. The payment area refreshes for the new pack. Nothing is charged until you press Pay — and if you close the page instead, nothing is charged at all. An unfinished payment is never a charge.",
  },
  {
    slug: "repository-added-after-install",
    title: "I added a repository after installing, but it did not connect",
    summary: "GitHub does not tell the app when you change an existing installation's repositories. Re-run the connect flow to add the new repository.",
    symptom: [
      "You installed the SolveLang app and connected a repository. Later you added another repository in GitHub's settings — but it never appears in your SolveLang account, and its jobs never run on SolveLang.",
    ],
    cause: [
      "GitHub does not notify an app when you change the repository selection of an installation that already exists. SolveLang learns which repositories you have connected when the app is first installed, or when you run the connect flow from your account — so a repository added only inside GitHub's settings can be missed.",
    ],
    fixIntro: "Connect the repository from your account:",
    fix: [
      "Open your account's GitHub page.",
      "Run the connect flow again, and choose the repository you added.",
      "Check that the repository now appears in your connected repositories list on that page. Its queued jobs can then be picked up by SolveLang runners.",
    ],
    exampleText: "You connect the repository `my-app` when you sign up. A week later you add `my-api` in GitHub's settings, but it does not show in your account. Running the connect flow again from your account's GitHub page adds `my-api` — `my-app` stays connected exactly as it was.",
  },
  {
    slug: "pause-resume-runner-minutes",
    title: "Pause and resume your runner minutes",
    summary: "Pausing stops new SolveLang machines from starting — without losing your balance. Resume from the same control whenever you are ready.",
    symptom: [
      "You want your repositories to stop using runner minutes for a while — during a holiday freeze, for example — without losing the minutes you have bought.",
    ],
    cause: [
      "Runner minutes stay active until you pause them. As long as minutes are active, queued jobs that match your labels keep starting SolveLang machines and drawing from your balance.",
      "Pausing freezes new work, not your balance: you can still buy more minutes while paused, and the expiry clock keeps running — minutes still expire 12 months after purchase, so pausing does not extend them.",
    ],
    fixIntro: "Pause from your account home or the checkout page:",
    fix: [
      "Open your account home and find the Runner minutes card. The same Pause control is also on the runner-minutes checkout page.",
      "Choose Pause. From that moment, no new SolveLang machines start for your repositories.",
      "Resume from the same control whenever you are ready — there is no waiting period.",
    ],
    exampleText: "You pause on Friday evening. Over the weekend, no SolveLang machines start. A job that was already running finishes on Saturday — because it finished while you were paused, it is never charged. On Monday you resume from the same card, and jobs start again.",
  },
  {
    slug: "labels-and-pools",
    title: "Labels and pools: Standard vs High-Power",
    summary: "Your workflow's runs-on labels choose the pool: Standard for everyday machines, High-Power for larger, faster ones. Each pool has its own balance.",
    symptom: [
      "You are setting up your workflows and want to choose between Standard and High-Power runners — or your jobs are not reaching SolveLang at all and simply wait in the queue.",
    ],
    cause: [
      "GitHub routes every job by the labels in its runs-on line. SolveLang runners answer to specific label sets. A job that asks for labels SolveLang does not answer to will wait for a different runner — that is not an error; the job is simply not addressed to SolveLang.",
    ],
    fixIntro: "Use one of these label sets in your workflow's runs-on:",
    fix: [
      "For Standard runners — everyday machines for ordinary jobs: `[\"self-hosted\", \"solvelang-runners-standard\"]`.",
      "For High-Power runners — larger, faster machines for heavy jobs: `[\"self-hosted\", \"solvelang-runners-high-power\"]`.",
      "Plain `[\"self-hosted\"]` also reaches SolveLang, and runs on the Standard pool.",
      "Other labels your workflow already carries — for example, labels that pick out your own runners — can ride alongside a SolveLang label in the same runs-on line, and the job still runs on the pool the SolveLang label names; a runs-on line with no SolveLang label at all is not picked up by SolveLang.",
      "Remember that the pools are separate balances: the pool a job runs on is the balance it draws from. A Standard job never spends High-Power minutes, and a High-Power job never spends Standard minutes.",
      "Speed is never free, and there are two ways to buy it: High-Power minutes put a job on larger, faster premium machines at the High-Power prices, and On-demand capacity starts a job right away while consuming minutes at 2×. Standard jobs on Spot capacity bill at the plain 1× rate.",
    ],
    exampleText: "The same workflow can mix pools, job by job:",
    exampleCode: [
      "test:",
      "  runs-on: [\"self-hosted\", \"solvelang-runners-standard\"]",
      "",
      "heavy-test:",
      "  runs-on: [\"self-hosted\", \"solvelang-runners-high-power\"]",
    ],
  },
  {
    slug: "sign-in-link-problems",
    title: "Sign-in link problems",
    summary: "The two usual traps: a sign-in email that never arrives, and a sign-in that loops back to the form — and how to fix both.",
    symptom: [
      "You requested a sign-in link and the email never arrived — no error, just nothing.",
      "Or: you open the link (or sign in) and land back on the sign-in form, as if nothing happened.",
    ],
    cause: [
      "For a missing email: the sign-in form is protected against bots. If the form is submitted almost instantly, or filled in automatically, the request is quietly dropped on purpose — no email is sent and no error is shown, so automated senders learn nothing from it. A careful, human-paced submission goes through.",
      "For the loop: your browser can hold an old saved session for the site. The sign-in succeeds, but the browser then presents the stale session again, and you are sent back to the form.",
    ],
    fixIntro: "Work through these in order:",
    fix: [
      "Fill the sign-in form in by hand, the way you normally type, and submit it once.",
      "Wait at least a minute between requests — asking again too quickly does not help.",
      "Check your spam or junk folder for the message.",
      "If sign-in loops back to the form, clear your cookies for solve-lang.com — or open a private (incognito) window — and sign in again there.",
      "Remember that each sign-in link expires after 15 minutes and works only once. If a link fails, request a fresh one and use it straight away.",
    ],
    exampleText: "You request a link three times in ten seconds, and nothing arrives. You wait a minute, fill the form in once by hand, and the link arrives — you open it within 15 minutes, and you are in.",
  },
  {
    slug: "see-your-balance",
    title: "Where to see your balance",
    summary: "Your account home and the Live Center Minutes tab both show the Standard and High-Power minutes you have left, with the earliest expiry.",
    symptom: [
      "You are not sure how many runner minutes you have left — or whether the minutes you are looking at are the pool your jobs actually use.",
    ],
    cause: [
      "Standard and High-Power minutes are two separate balances, not one pot. A job only ever draws from the pool it ran on, so a single number is never the whole picture: you can have plenty of Standard minutes and no High-Power minutes, or the other way round.",
    ],
    fixIntro: "You can see both balances in two places:",
    fix: [
      "Account home: the Runner minutes card shows the minutes left in each pool, with the earliest expiry date.",
      "Live Center, Minutes tab: the same per-pool balances and earliest expiry.",
      "Before a big run, check the pool your jobs will use — Standard jobs draw the Standard balance, and High-Power jobs draw the High-Power balance.",
    ],
    exampleText: "Your card shows Standard: 4,200 minutes and High-Power: 300 minutes. A Standard job that bills 10 minutes leaves Standard at 4,190 minutes — High-Power stays at 300.",
  },
];

export function solutionBySlug(slug: string): SolutionEntry {
  const entry = solutions.find((candidate) => candidate.slug === slug);
  if (!entry) throw new Error(`Unknown solution slug: ${slug}`);
  return entry;
}
