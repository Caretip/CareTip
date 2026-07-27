let registeredPushToken: string | null = null;

export function setRegisteredPushToken(token: string | null): void {
  registeredPushToken = token;
}

export function getRegisteredPushToken(): string | null {
  return registeredPushToken;
}
