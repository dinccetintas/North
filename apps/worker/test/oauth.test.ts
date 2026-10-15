import { describe, expect, it } from "vitest";
import { exchangeGithubCode, exchangeVercelCode, oauthClients, type FetchLike } from "../src/services/oauth";

const client = { clientId: "id", clientSecret: "s3cret" };

/** A fetch that answers each URL from a table and records the requests. */
function fakeFetch(answers: Record<string, { status?: number; body: unknown }>): { fetchImpl: FetchLike; calls: { url: string; init: RequestInit | undefined }[] } {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const answer = answers[url];
    if (!answer) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, calls };
}

describe("ONB-3 OAuth code exchange (worker side: client secrets never leave here)", () => {
  it("oauthClients reads id and secret pairs from the env; a missing half means not configured", () => {
    expect(oauthClients({})).toEqual({ github: null, vercel: null });
    expect(oauthClients({ GITHUB_CLIENT_ID: "a", GITHUB_CLIENT_SECRET: "b", VERCEL_CLIENT_ID: "c" })).toEqual({ github: { clientId: "a", clientSecret: "b" }, vercel: null });
  });

  it("GitHub: posts the code with the secret, then reads the login for the account label", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "https://github.com/login/oauth/access_token": { body: { access_token: "gho_x", scope: "repo,read:user" } },
      "https://api.github.com/user": { body: { login: "octocat" } },
    });
    const token = await exchangeGithubCode(client, "c0de", "http://localhost:3100/api/connections/github/callback", fetchImpl);
    expect(token).toEqual({ token: "gho_x", scopes: ["repo", "read:user"], accountLabel: "octocat" });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ client_id: "id", client_secret: "s3cret", code: "c0de", redirect_uri: "http://localhost:3100/api/connections/github/callback" });
    expect(calls[1]?.init?.headers).toMatchObject({ authorization: "Bearer gho_x" });
  });

  it("GitHub: a bad code fails with the provider's error and without the secret in the message", async () => {
    const { fetchImpl } = fakeFetch({ "https://github.com/login/oauth/access_token": { body: { error: "bad_verification_code", error_description: "The code passed is incorrect or expired." } } });
    await expect(exchangeGithubCode(client, "nope", "http://x/cb", fetchImpl)).rejects.toThrow(/bad_verification_code/);
    await expect(exchangeGithubCode(client, "nope", "http://x/cb", fetchImpl)).rejects.not.toThrow(/s3cret/);
  });

  it("Vercel: form-encoded exchange, team id kept as the scope, username as the label", async () => {
    const { fetchImpl, calls } = fakeFetch({
      "https://api.vercel.com/v2/oauth/access_token": { body: { access_token: "vc_x", team_id: "team_1" } },
      "https://api.vercel.com/v2/user": { body: { user: { username: "dinc" } } },
    });
    const token = await exchangeVercelCode(client, "c0de", "http://x/cb", fetchImpl);
    expect(token).toEqual({ token: "vc_x", scopes: ["deployments"], accountLabel: "dinc", scope: "team_1" });
    expect(String(calls[0]?.init?.body)).toBe("client_id=id&client_secret=s3cret&code=c0de&redirect_uri=http%3A%2F%2Fx%2Fcb");
    const personal = fakeFetch({ "https://api.vercel.com/v2/oauth/access_token": { body: { access_token: "vc_y", team_id: null } }, "https://api.vercel.com/v2/user": { body: {} } });
    expect(await exchangeVercelCode(client, "c", "http://x/cb", personal.fetchImpl)).toEqual({ token: "vc_y", scopes: ["deployments"], accountLabel: "" });
    await expect(exchangeVercelCode(client, "c", "http://x/cb", fakeFetch({}).fetchImpl)).rejects.toThrow(/Vercel token exchange failed/);
  });
});
