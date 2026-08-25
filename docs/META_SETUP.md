# Meta production setup

Meta Platform is the only global integration. DeepSeek and Telegram credentials belong to individual Page workspaces.

## Meta App dashboard values

- App domain: `ai.growthifyx.space`
- OAuth callback: `https://ai.growthifyx.space/api/meta/oauth/callback`
- Webhook callback: `https://ai.growthifyx.space/api/meta/webhook`
- Privacy Policy: `https://ai.growthifyx.space/privacy`
- User Data Deletion: `https://ai.growthifyx.space/data-deletion`

Use the same Verify Token in Meta and Global Settings > Meta Platform. Keep the App Secret only in the encrypted server-side setting or the controlled bootstrap fallback; never expose it to a Page or browser response.

## Permissions expected by this implementation

OAuth requests `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, and `pages_messaging` for Page discovery, identity, subscription management, and Messenger operations. Complete Meta App Review and Business verification required for live Pages.

## Configuration flow

Log in as Super Admin > Settings > Meta Platform, save App ID, App Secret, and Verify Token, and test credentials. Add a Page through Facebook connect. OAuth state is single-use and expires after ten minutes. Production webhook POST requests require a valid `X-Hub-Signature-256` generated with the Meta App Secret; invalid or missing signatures are rejected.

Live Meta verification remains deferred until the VPS is public and the Meta App is configured.
