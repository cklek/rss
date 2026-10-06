export async function api(path, init) {
  const response = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload)
    throw new Error(payload?.error || `Request failed (${response.status}).`);
  return payload;
}
