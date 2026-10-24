import { describe, expect, it } from "vitest";

import { authorizationRequestSource } from "./authorization-request.ts";

const body = { resource: "from-body" };
const query = { resource: "from-query" };

describe("authorizationRequestSource", () => {
  it.each([
    ["a GET", { method: "GET" }, "query"],
    ["a direct POST, which carries the authorization as a form", { method: "POST" }, "body"],
    [
      "a POST resumed by the consent page, whose body is the consent form",
      { method: "POST", authorizeSettings: {} },
      "query",
    ],
    [
      "a POST the provider marks as the authorization",
      { method: "POST", authorizeSettings: { isAuthorize: true } },
      "body",
    ],
  ])("reads %s from the %s", (_label, request, place) => {
    const { sent, inBody } = authorizationRequestSource({ ...request, body, query });

    expect(sent).toBe(place === "body" ? body : query);
    expect(inBody).toBe(place === "body");
  });
});
