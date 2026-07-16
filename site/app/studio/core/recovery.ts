export type RecoveryStage = "none" | "corrupt" | "replacement-save-blocked";

export function getRecoveryPresentation(stage: RecoveryStage, hasRecoveryCopy: boolean) {
  if (stage === "replacement-save-blocked") {
    return {
      showDownload: false,
      resetLabel: "Retry workspace setup",
      warning: "The corrupt data was removed, but a valid replacement workspace could not be saved.",
      confirmation: "Retry saving a valid replacement workspace in this browser?",
    };
  }
  if (stage === "corrupt" && hasRecoveryCopy) {
    return {
      showDownload: true,
      resetLabel: "Export & reset corrupt data",
      warning: "A recovery copy is available to download before reset.",
      confirmation: "Download the recovery copy, then permanently remove the unreadable local payload and create a valid replacement workspace?",
    };
  }
  return {
    showDownload: false,
    resetLabel: "Reset corrupt data",
    warning: "The corrupt data could not be copied because browser storage is full or unavailable.",
    confirmation: "No recovery copy was preserved. Resetting will permanently remove the unreadable local payload and create a valid replacement workspace. Continue?",
  };
}
