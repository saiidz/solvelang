import Link from "next/link";

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10 rounded-3xl border border-line bg-panel p-8 sm:p-10" aria-labelledby={id}>
      <h2 id={id} className="text-3xl font-bold">{title}</h2>
      <div className="mt-4 max-w-4xl space-y-4 leading-7 text-body">{children}</div>
    </section>
  );
}

export function MethodologyApp() {
  return (
    <div className="mx-auto max-w-6xl px-6 pb-20 lg:px-8">
      <Section id="labels-heading" title="The three labels — the whole vocabulary">
        <p>
          Every finding the grading produces carries exactly one label. There are no scores and no confidence
          percentages.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li><strong className="text-ink">Verified</strong> — the evidence for the finding was read and confirms it.</li>
          <li><strong className="text-ink">Failed</strong> — the evidence was read and the thing it checks failed: a check run that concluded in failure, a policy rule that did not pass, a route that could not run. A failed route is labeled failed, never silently dropped.</li>
          <li><strong className="text-ink">Unverified</strong> — the evidence needed to settle the finding was not available, so the finding is recorded as unverified. Missing evidence is never guessed into a verdict.</li>
        </ul>
        <p>
          The <strong className="text-ink">unverified share</strong> is the fraction of all graded findings labeled
          unverified. We publish it as a headline number because it is the honest boundary of the tool: it says how
          much of what the grading touched it could not settle. A run also reports whether any finding was labeled
          verified on evidence that did not support it (<em>falseVerifiedLabel</em>); across the whole public proof
          set that count is zero.
        </p>
      </Section>

      <Section id="live-run-heading" title="What a live run does">
        <p>
          When a pull request opens or updates on a repository where the app is installed, the service: opens a
          check run; reads the repository&apos;s own verification config at the PR&apos;s base commit (a PR cannot
          weaken its own gate); waits, with a bound, for the head&apos;s other checks to settle; fetches the head
          tree and runs the PR Gate over the changed files (blast radius from the Solve Graph, plus the repo&apos;s
          policy file when it has one); collects the PR&apos;s evidence — changed files, check runs, reviews,
          comparison — from GitHub; grades every finding; completes the check run with the graded receipt and
          inline annotations; posts the same receipt as a sticky PR comment; and writes the run to the governance
          audit log.
        </p>
        <p>
          Blocking evidence — an executed PR Gate policy failure, failing head CI, or a config-named required check
          missing or not successful — concludes the check as a failure in <em>enforce</em> mode. In the default{" "}
          <em>report-only</em> mode the same evidence is stated in the receipt and the check concludes success.
          Unverified findings never block on their own.
        </p>
      </Section>

      <Section id="proof-set-heading" title="How the proof set was built">
        <p>
          The live half of the proof set is the public repository{" "}
          <a className="font-semibold text-ink underline" href="https://github.com/saiidz/solvelang-verification-proof">saiidz/solvelang-verification-proof</a>.
          Each proof pull request states its ground truth — defective or clean — in its body, written before the
          check ran: the defective PRs carry a deliberately planted defect, the clean PRs are ordinary correct
          changes. A catch is only counted when the run&apos;s own record shows blocking evidence; a false block is
          a clean PR that produced blocking evidence. Neither happened by assertion — both are read off the check
          runs, which are public on each PR&apos;s Checks tab.
        </p>
        <p>
          Two exclusions, stated plainly. The earliest proof runs (PRs #1–#5, November 26, 2026) are excluded: a
          service bug found that day overwrote their final check states after the grading completed, so those
          states no longer reflect the grading. (The bug is fixed; the runs that prove the fix are the ones in the
          set.) And on PRs #8–#11 the receipt comment could not be posted — GitHub gates an app&apos;s PR comments
          on a permission the app did not hold yet. The check runs themselves completed with full evidence and are
          counted; the comment began posting from PR #12, after the owner granted the permission.
        </p>
        <p>
          The receipt audits were graded from public data through the receipt path and then audited by hand,
          finding by finding — that human pass is where the tool-false-positive counts come from, and it is also
          where each receipt was checked for a finding labeled verified without supporting evidence. None was
          found, in any of the five.
        </p>
      </Section>

      <Section id="backtest-heading" title="How the backtest grades history">
        <p>
          The <Link className="font-semibold text-ink underline" href="/verification/backtest/">backtest</Link>{" "}
          replays the same grading — the same evidence collector, the same receipt builder, the same PR Gate run on
          the head tree — over a public repository&apos;s most recent merged pull requests, with the repo&apos;s own
          verification config read at each PR&apos;s base commit. It judges the head as it stood when the PR
          merged: check runs that only completed after the merge are not counted. A replay creates no check run,
          posts no comment, and writes no audit record — it grades history, it does not act on it.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li><strong className="text-ink">Catch</strong> — blocking evidence existed on the PR&apos;s head under the product&apos;s blocking rules: the latest completed run of any of the repo&apos;s own checks failed or timed out; a check named as required in the repo&apos;s own verification config was absent, unfinished, or not successful; or the executed PR Gate policy evaluation failed.</li>
          <li><strong className="text-ink">False-block candidate</strong> — no catch by latest state, but a failing run on the head was superseded by a successful re-run of the same check on the same head SHA that completed before the PR merged — verification running between the failure and the re-run would have blocked on superseded evidence.</li>
          <li><strong className="text-ink">Evidence incomplete</strong> — the PR Gate route failed or did not run, so blast-radius and policy evidence is missing. Never counted as a catch: missing evidence is not evidence.</li>
        </ul>
      </Section>

      <Section id="limits-heading" title="The limits of this evidence">
        <ul className="list-disc space-y-2 pl-5">
          <li>The live set is eight pull requests on one small proof repository. It proves the loop end to end; it is not a statistical sample of anyone&apos;s real queue.</li>
          <li>The receipt audits cover five pull requests, graded with a human in the loop. Larger samples will move the numbers; that is why the backtest exists — run it on your own history and read your own unverified share.</li>
          <li>The backtest grades the evidence GitHub still exposes for a merged PR. It does not re-run the repository&apos;s CI, and evidence GitHub has aged out is recorded as unverified, not reconstructed.</li>
          <li>Nothing here is a claim about any other tool. No competitor was measured, and no merge-rate or time-saved figure is published, because none was measured.</li>
        </ul>
        <div className="mt-8 flex flex-wrap gap-4">
          <Link href="/verification/proof/" className="inline-flex rounded-xl border border-line-strong px-5 py-3 font-semibold hover:bg-canvas">See the proof numbers</Link>
          <Link href="/verification/backtest/" className="inline-flex rounded-xl border border-line-strong px-5 py-3 font-semibold hover:bg-canvas">Run a backtest</Link>
        </div>
      </Section>
    </div>
  );
}
