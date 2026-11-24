import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Platform compatibility",
  description:
    "Which SolveLang products work with which code hosts today: the context products work with repositories hosted on GitHub, GitLab, Bitbucket, Azure DevOps, Codeberg, Forgejo, Gitea, SourceHut, OneDev, and Radicle; runner minutes and Process Solution governance run on GitHub today.",
  alternates: { canonical: "https://www.solve-lang.com/compatibility/" },
};

const contextHosts = [
  "GitHub",
  "GitLab",
  "Bitbucket",
  "Azure DevOps",
  "Codeberg",
  "Forgejo",
  "Gitea",
  "SourceHut",
  "OneDev",
  "Radicle",
];

const rows: Array<{ product: string; today: string; note: string }> = [
  {
    product: "Solve Context Index",
    today: "Every host listed below",
    note: "Builds from a local checkout of the repository. The host that stores the code is never contacted.",
  },
  {
    product: "SolveLang MCP server (local)",
    today: "Every host listed below",
    note: "Serves the index from your own machine over stdio, rooted at the checkout you point it at.",
  },
  {
    product: "Hosted MCP endpoint and Team Index",
    today: "Every host listed below",
    note: "Your team uploads its index; the hosted endpoint serves that index and never reads the repository itself.",
  },
  {
    product: "Runner minutes",
    today: "GitHub",
    note: "Provisioning, job discovery, and billing are built on GitHub Actions today.",
  },
  {
    product: "Process Solution (merge governance)",
    today: "GitHub",
    note: "The queue, battery, and landing engine integrate with GitHub pull requests and checks today.",
  },
];

export default function CompatibilityPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-canvas via-panel to-canvas text-ink">
      <section className="mx-auto max-w-6xl px-6 pb-12 pt-12 text-center lg:px-8 lg:pt-20">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-accent">SolveLang compatibility</p>
        <h1 className="mx-auto mt-5 max-w-5xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
          Your code host is your choice.
        </h1>
        <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-muted sm:text-xl">
          SolveLang&apos;s context products run on your own checkout of a repository, so the host that
          stores the code does not limit them. This page states exactly which products work with
          which hosts today — and, just as plainly, which ones do not yet.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm text-muted">
          {contextHosts.map((host) => (
            <span key={host} className="rounded-full border border-line bg-panel px-4 py-2">{host}</span>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-8 lg:px-8" aria-labelledby="today-heading">
        <h2 id="today-heading" className="text-2xl font-semibold">What works today</h2>
        <div className="mt-5 overflow-hidden rounded-3xl border border-line bg-panel">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wider text-muted">
                <th scope="col" className="px-6 py-4 font-semibold">Product</th>
                <th scope="col" className="px-6 py-4 font-semibold">Works with</th>
                <th scope="col" className="px-6 py-4 font-semibold">Why</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.product}>
                  <th scope="row" className="px-6 py-4 font-semibold">{row.product}</th>
                  <td className="px-6 py-4">{row.today}</td>
                  <td className="px-6 py-4 leading-6 text-muted">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-8 lg:px-8" aria-labelledby="how-heading">
        <div className="rounded-3xl border border-line bg-panel p-6 sm:p-8">
          <h2 id="how-heading" className="text-2xl font-semibold">Why the context products are host-independent</h2>
          <p className="mt-4 leading-7 text-muted">
            The Context Index is built by walking a local checkout — files, classifications, and the
            Solve Graph are derived from the tree on your disk, and the index records where that
            checkout came from, whether that is github.com, gitlab.com, a self-hosted Forgejo or
            Gitea, or no remote at all. The local MCP server serves that index over stdio, and the
            hosted endpoint serves an index your team uploads. No host API, token, or app
            installation is involved on any of these paths, which is why a repository hosted on
            GitHub, GitLab, Bitbucket, Azure DevOps, Codeberg, Forgejo, Gitea, SourceHut, OneDev,
            or Radicle works the same way.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-16 lg:px-8" aria-labelledby="github-heading">
        <div className="rounded-3xl border border-line bg-panel p-6 sm:p-8">
          <h2 id="github-heading" className="text-2xl font-semibold">GitHub today: runner minutes and governance</h2>
          <p className="mt-4 leading-7 text-muted">
            Runner minutes and the Process Solution merge-governance engine currently run on
            GitHub: runner provisioning and billing are built on GitHub Actions, and the
            governance queue, battery, and landing flow integrate with GitHub pull requests and
            checks. Extending both to more platforms is in progress. This page will name a
            platform for those products only when support for it is live and proven — no dates
            and no promises in the meantime.
          </p>
        </div>
      </section>
    </main>
  );
}
