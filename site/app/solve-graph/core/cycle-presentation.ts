export type SolveGraphCyclePresentation = { components: Array<{ id: string; nodes: string[] }>; truncated: boolean; notices: string[]; execution: { networkAccess: false; writeAccess: false } };
export function createSolveGraphCyclePresentation(input: { components: Array<{ id: string; nodes: string[] }> }, maxComponents = 30): SolveGraphCyclePresentation {
  if (!Number.isSafeInteger(maxComponents) || maxComponents < 1 || maxComponents > 100) throw new Error("Solve Graph cycle presentation maxComponents must be an integer from 1 through 100.");
  const components = input.components.map((component) => ({ id: component.id, nodes: [...component.nodes] })).sort((a, b) => a.id.localeCompare(b.id));
  return { components: components.slice(0, maxComponents), truncated: components.length > maxComponents, notices: ["Cycles are static structural evidence only; they are not automatically defects, runtime loops, or failures.", ...(components.length > maxComponents ? ["Additional cycle components were omitted by the presentation bound."] : [])], execution: { networkAccess: false, writeAccess: false } };
}
