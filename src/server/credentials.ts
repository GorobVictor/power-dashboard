import { createHash, timingSafeEqual } from "node:crypto";

export type Credentials = { username: string; password: string };

export function getCredentials(): Credentials | null {
  const { API_USERNAME: username, API_PASSWORD: password } = process.env;
  return username && !username.includes(":") && password ? { username, password } : null;
}

function sameSecret(actual: string, expected: string) {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

export function matchesCredentials(username: string, password: string, expected: Credentials) {
  const validUsername = sameSecret(username, expected.username);
  const validPassword = sameSecret(password, expected.password);
  return validUsername && validPassword;
}
