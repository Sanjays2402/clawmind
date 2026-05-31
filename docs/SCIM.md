# SCIM 2.0 provisioning

ClawMind exposes a SCIM 2.0 endpoint so identity providers (Okta, Azure AD,
Google Workspace, Auth0, OneLogin, JumpCloud) can create, suspend, and
delete workspace members automatically. This page is the integration
reference for IT admins wiring it up.

## What is provisioned

SCIM `User` resources map one-to-one to entries in the workspace member
registry. Roles flow through the in-app RBAC model (`owner`, `admin`,
`member`, `viewer`). The default role for a freshly provisioned user is
`member`. Suspending a user from the IdP (`active=false`) demotes them to
`viewer`. Deleting from the IdP removes the member row, except for the
final remaining owner which is always protected.

Groups are not yet provisioned over SCIM. Add the `clawmind` enterprise
extension `urn:ietf:params:scim:schemas:extension:clawmind:2.0:User` with
a `role` attribute to request a non-default role on create.

## Connection details

| Item | Value |
| ---- | ----- |
| Base URL | `https://<your-host>/scim/v2` |
| Authentication | OAuth bearer token (workspace-scoped, see below) |
| Content type | `application/scim+json` |
| Filter syntax | `userName eq "x"`, `emails.value eq "x"` |
| Pagination | `startIndex`, `count` (max 200) |

Endpoints:

- `GET  /ServiceProviderConfig`
- `GET  /ResourceTypes`
- `GET  /Schemas`
- `GET  /Users[?filter=&startIndex=&count=]`
- `GET  /Users/:id`
- `POST /Users`
- `PATCH /Users/:id`
- `DELETE /Users/:id`

## Issuing the bearer token

The token is workspace-wide and owner-managed. Sign in as an owner with
MFA enrolled, then visit `/settings/scim` and click **Issue token**. The
plaintext value is shown exactly once; copy it into your IdP's SCIM
configuration immediately. Rotating produces a new value and revokes the
previous one in the same operation.

The token store on disk only keeps a sha256 digest. There is no way to
recover a lost token: rotate and update the IdP.

## Auditing

Every SCIM mutation is recorded in the audit log with actor
`scim:<token-id>`, the request IP, and the action (`scim.user.create`,
`scim.user.patch`, `scim.user.delete`). Denied requests are logged with
`.denied` suffixes so you can spot a misconfigured IdP retrying against
the wrong token.

## Verifying

```bash
export SCIM_TOKEN=scim_...   # from /settings/scim
curl -sS 'https://<your-host>/scim/v2/Users' \
  -H "Authorization: Bearer $SCIM_TOKEN" \
  -H 'Accept: application/scim+json'
```

A 200 response with a SCIM `ListResponse` body confirms the integration
is live.
