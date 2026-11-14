import { capabilityEvidenceDate, capabilityGroups } from "../product-capabilities";

export function ProductCapabilities() {
  return (
    <div data-product-capabilities="true">
      <p className="text-sm leading-6 text-muted">Capability evidence reviewed {capabilityEvidenceDate}. These are implementation and deployment labels, not live service-health measurements.</p>
      <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {capabilityGroups.map((group) => (
          <article key={group.id} className="rounded-3xl border border-line bg-panel p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-ink">{group.title}</h3>
            <p className="mt-3 text-sm leading-6 text-muted">{group.description}</p>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-body">
              {group.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </article>
        ))}
      </div>
    </div>
  );
}
