-- v2 adds the "clippings:write" scope, which the MCP server advertises and its clients now request.
-- Clients registered under v1 store the scopes v1 allowed, and Better Auth rejects a request for a
-- scope outside that list, so their next sign-in would fail with invalid_scope. Allow the new scope
-- on them. This grants nothing by itself: the consent page still asks for the write access.
-- The browser extension's clients (redirecting to https://<id>.chromiumapp.org/) never ask for it
-- and are left alone, as are clients with no scopes of their own (they take the server's list).
UPDATE "oauthClient"
SET "scopes" = array_append("scopes", 'clippings:write')
WHERE "scopes" IS NOT NULL
  AND cardinality("scopes") > 0
  AND NOT ('clippings:write' = ANY ("scopes"))
  AND NOT EXISTS (
    SELECT 1 FROM unnest("redirectUris") AS uri WHERE uri LIKE 'https://%.chromiumapp.org/'
  );
