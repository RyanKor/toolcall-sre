/** `GET /v1/models` for a simulated backend — what a connection probe checks. */
import { NextRequest } from "next/server";

const KNOWN = new Set(["solid", "flaky", "rough"]);

export async function GET(_req: NextRequest, ctx: { params: Promise<{ profile: string }> }) {
  const { profile } = await ctx.params;
  if (!KNOWN.has(profile)) {
    return Response.json(
      { error: { message: `unknown profile \`${profile}\`: try solid, flaky or rough` } },
      { status: 404 },
    );
  }
  return Response.json({
    object: "list",
    data: [{ id: `sim-${profile}`, object: "model", owned_by: "toolcall-sre-console" }],
  });
}
