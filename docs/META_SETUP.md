# Meta production setup

The single Meta App is the only global external integration. DeepSeek and Telegram belong to individual Page workspaces.

## Meta App dashboard values

App Domains: `ai.growthifyx.space`

OAuth redirect/callback URI: `https://ai.growthifyx.space/api/meta/oauth/callback`

Webhook callback URL: `https://ai.growthifyx.space/api/meta/webhook`

Privacy Policy URL: `https://ai.growthifyx.space/privacy`

User Data Deletion URL: `https://ai.growthifyx.space/data-deletion`

Use the same Verify Token in Meta and Settings → Meta Platform. Keep the App Secret only in the encrypted server-side setting.

## Permissions expected by this implementation

OAuth requests `pages_show_list` for Page discovery, `pages_read_engagement` for Page identity and engagement access, `pages_manage_metadata` for Page webhook subscription management, and `pages_messaging` for Messenger operations. Complete any Meta App Review or Business verification required for live Pages.

## Configuration flow

Log in as Super Admin → Settings → Meta Platform → save App ID, App Secret, and Verify Token → Test App Credentials → Add Page → Facebook connect. OAuth state is single-use and expires after ten minutes. Webhook POST requests require a valid `X-Hub-Signature-256` generated with the Meta App Secret; invalid or missing signatures are rejected in production.
