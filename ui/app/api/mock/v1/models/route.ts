/** `GET /v1/models` for the scenario mock. The "models" are failure modes. */
export async function GET() {
  return Response.json({
    object: "list",
    data: [
      "clean", "prose", "fenced", "bad-enum", "wrong-type", "missing", "garbage",
      "object-args", "empty-args", "final", "truncated", "empty-final",
      "stream-clean", "stream-prose", "stream-missing",
    ].map((id) => ({ id, object: "model", owned_by: "toolcall-sre-console" })),
  });
}
