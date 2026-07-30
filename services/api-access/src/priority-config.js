function required(environment, name) {
  const value = environment[name];
  if (typeof value !== "string" || !value) throw new Error(`${name} is required.`);
  return value;
}

export function parsePriorityApiEnvironment(environment = process.env) {
  const priorityQueueEnabled = environment.API_PRIORITY_QUEUE_ENABLED === "true";
  return {
    priorityQueueEnabled,
    priorityJobsTable: priorityQueueEnabled ? required(environment, "API_PRIORITY_JOBS_TABLE") : undefined,
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
