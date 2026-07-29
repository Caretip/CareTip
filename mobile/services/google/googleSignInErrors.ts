export class GoogleSignInCancelledError extends Error {
  constructor() {
    super("Google sign-in was cancelled.");
    this.name = "GoogleSignInCancelledError";
  }
}

export class GoogleSignInUnavailableError extends Error {
  constructor(message = "Google Sign-In is not available.") {
    super(message);
    this.name = "GoogleSignInUnavailableError";
  }
}
