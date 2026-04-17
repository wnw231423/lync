export function getApiBaseUrl(): string {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (!apiUrl) {
    throw new Error("EXPO_PUBLIC_API_URL is not configured.");
  }

  return apiUrl.replace(/\/+$/, "");
}

export function getWebSocketBaseUrl(): string {
  const apiBaseUrl = getApiBaseUrl();
  if (apiBaseUrl.startsWith("https://")) {
    return `wss://${apiBaseUrl.slice("https://".length)}`;
  }
  if (apiBaseUrl.startsWith("http://")) {
    return `ws://${apiBaseUrl.slice("http://".length)}`;
  }
  throw new Error("EXPO_PUBLIC_API_URL must start with http:// or https://");
}

export async function buildHttpErrorMessage(
  action: string,
  response: Response,
): Promise<string> {
  const responseText = await response.text();
  const suffix = responseText ? `: ${responseText}` : "";
  return `${action} failed with ${response.status}${suffix}`;
}
