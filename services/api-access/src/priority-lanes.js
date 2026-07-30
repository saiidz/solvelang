export const PRIORITY_LANES = Object.freeze({
  standard: Object.freeze({ name: "standard", label: "Standard", capacityWeight: 1, creditMultiplier: 1 }),
  express: Object.freeze({ name: "express", label: "Express", capacityWeight: 2, creditMultiplier: 2 }),
  priority: Object.freeze({ name: "priority", label: "Priority", capacityWeight: 5, creditMultiplier: 5 }),
  critical: Object.freeze({ name: "critical", label: "Critical", capacityWeight: 10, creditMultiplier: 10 }),
});

export function getPriorityLane(name = "standard") {
  const lane = PRIORITY_LANES[name];
  if (!lane) throw new Error("Processing priority is invalid.");
  return lane;
}
