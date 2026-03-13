export class AutomationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "AutomationError";
    this.details = details;
  }
}

export class VerificationError extends AutomationError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = "VerificationError";
  }
}
