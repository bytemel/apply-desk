// Small helpers shared by the API routes (Web standard Request and Response).
export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export async function readJson(request, limit = 8 * 1024) {
  const raw = await request.text();
  if (raw.length > limit) throw Object.assign(new Error("Send a smaller request."), { status: 413 });
  try {
    const body = JSON.parse(raw || "{}");
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch { /* falls through */ }
  throw Object.assign(new Error("Send a JSON object."), { status: 400 });
}

// Wraps a route so expected errors become a clear message and anything else a plain 500.
export const route = (fn) => async (request) => {
  try {
    return await fn(request);
  } catch (e) {
    if (e.status && e.status < 500) return json({ ok: false, message: e.message }, e.status);
    if (e.status === 503) return json({ ok: false, message: "The database is not connected yet." }, 503);
    console.error(e);
    return json({ ok: false, message: "Something went wrong. Try again in a minute." }, 500);
  }
};

export const fail = (status, message) => Object.assign(new Error(message), { status });
