export class FacebookSignInCancelledError extends Error {
  constructor() {
    super("Facebook sign-in was cancelled.");
    this.name = "FacebookSignInCancelledError";
  }
}

export class FacebookSignInUnavailableError extends Error {
  constructor(message = "Facebook Sign-In is not available.") {
    super(message);
    this.name = "FacebookSignInUnavailableError";
  }
}
