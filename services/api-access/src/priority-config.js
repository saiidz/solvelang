function required(environment, name, minimum = 1) {
  const value = environment[name];
  if (typeof value !== "string" || value.length < minimum) throw new Error(`${name} is required.`);
  return value;
}

export function parsePriorityAdminEnvironment(environment = process.env) {
  return {
    priorityQueueEnabled: environment.API_PRIORITY_QUEUE_ENABLED === "true",
    priorityJobsTable: required(environment, "API_PRIORITY_JOBS_TABLE"),
    adminSecret: required(environment, "API_PRIORITY_ADMIN_SECRET", 32),
  };
}

export function parsePriorityDispatcherEnvironment(environment = process.env) {
  return {
    priorityJobsTable: required(environment, "API_PRIORITY_JOBS_TABLE"),
    queueUrls: {
      standard: required(environment, "API_PRIORITY_STANDARD_QUEUE_URL"),
      express: required(environment, "API_PRIORITY_EXPRESS_QUEUE_URL"),
      priority: required(environment, "API_PRIORITY_PRIORITY_QUEUE_URL"),
      critical: required(environment, "API_PRIORITY_CRITICAL_QUEUE_URL"),
    },
  };
}

export function parsePriorityWorkerEnvironment(environment = process.env) {
  const laneName = required(environment, "API_PRIORITY_LANE");
  return {
    priorityJobsTable: required(environment, "API_PRIORITY_JOBS_TABLE"),
    laneName,
    workerId: environment.AWS_LAMBDA_FUNCTION_NAME || `priority-${laneName}-worker`,
  };
}
