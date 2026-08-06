export class AppleSignInCancelledError extends Error {
  constructor() {
    super("Apple sign-in was cancelled.");
    this.name = "AppleSignInCancelledError";
  }
}

export class AppleSignInUnavailableError extends Error {
  constructor(message = "Apple Sign-In is not available.") {
    super(message);
    this.name = "AppleSignInUnavailableError";
  }
}
