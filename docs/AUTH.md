# Login

Passkey only, one user, no database. This page covers the environment variables, the one-time enrollment, how sessions and the middleware work, what the design does and does not defend against, and the sources consulted while building it.

Files: `middleware.js` (repo root), `api/auth/*.js`, `api/_lib/session.js`, `api/_lib/ratelimit.js`, `web/login.html`, `web/login.js`, `tools/test-auth.js`.

## Environment variables

Set these in the Vercel project (Settings, Environment Variables). None of them is read by the browser.

| Variable | Required | Example | Purpose |
|---|---|---|---|
| `SESSION_SECRET` | yes | 32+ random characters, e.g. `openssl rand -base64 48` | HMAC key for the `og_session` and `og_challenge` cookies. Rotating it signs everyone out. |
| `RP_ID` | yes | `oncogenik.vercel.app` or the custom domain | WebAuthn relying party ID. Must equal the site's hostname (or a registrable parent of it). A passkey is bound to this value; changing the domain means enrolling again. |
| `ORIGIN` | no | `https://oncogenik.vercel.app` | Expected origin for WebAuthn responses. Defaults to `https://` + `RP_ID`. Set it explicitly if they differ. |
| `PASSKEY_CREDENTIAL` | after enrollment | `{"id":"...","publicKey":"...","counter":0,"transports":["internal","hybrid"]}` | The enrolled passkey. Produced by the setup flow below. While unset, `/api/auth/options` answers 404 and nobody can sign in. |
| `SETUP_TOKEN` | only during enrollment | `openssl rand -hex 24` | While set, the enrollment routes exist and accept this value in the `x-setup-token` header. Delete it after enrolling. |

Preview deployments get their own hostname, so a passkey enrolled for production does not work there unless `RP_ID` is set per environment. Simplest is to scope all of these variables to Production only.

## Enrollment walkthrough

1. Set `SESSION_SECRET`, `RP_ID`, and a fresh `SETUP_TOKEN` in Vercel. Leave `PASSKEY_CREDENTIAL` unset. Deploy.
2. On the device whose passkey you want to use, open `https://<RP_ID>/login?setup=1`.
3. Paste the setup token, press "Create passkey", and complete the platform prompt (Touch ID, Face ID, Windows Hello, a security key, or a phone via QR code).
4. The page shows a JSON string. Copy it into a new Vercel environment variable `PASSKEY_CREDENTIAL`.
5. Delete `SETUP_TOKEN`. Redeploy so both changes take effect.
6. Open `/login` and press "Sign in with passkey". You land on `/`.

Behind the page: `POST /api/auth/setup-options` returns `generateRegistrationOptions()` output (rpName `OncoGenik`, userName `owner`, a fixed 16-byte user handle, resident key and user verification both `preferred`, attestation `none`) and sets the challenge cookie; the browser runs `startRegistration({ optionsJSON })`; `POST /api/auth/setup-verify` runs `verifyRegistrationResponse()` and returns `registrationInfo.credential` as base64url strings plus `deviceType` and `backedUp`. The server stores nothing. Both setup routes answer 404 whenever `SETUP_TOKEN` is unset or the header does not match, so after step 5 they are indistinguishable from routes that do not exist.

To enroll a different device later, repeat the steps with a new token. There is one `PASSKEY_CREDENTIAL` slot, so the new value replaces the old one. If you want a second device without replacing the first, the simplest route is a synced passkey (iCloud Keychain, Google Password Manager, 1Password) that is already available on both.

## How a sign-in works

1. `POST /api/auth/options`. The server reads `PASSKEY_CREDENTIAL`, calls `generateAuthenticationOptions({ rpID, allowCredentials: [the one credential], userVerification: "preferred" })`, puts the challenge in the signed `og_challenge` cookie, and returns the options.
2. The page calls `startAuthentication({ optionsJSON })`. The authenticator signs the challenge, the origin, and the RP ID hash.
3. `POST /api/auth/verify` with the assertion. The server clears the challenge cookie first (one challenge, one attempt), then calls `verifyAuthenticationResponse({ expectedChallenge, expectedOrigin, expectedRPID, credential })`. On success it sets `og_session` and returns `{"ok":true}`.
4. The page redirects to `/`.

`GET /api/auth/me` returns `{"ok":true,"exp":...}` for a valid session, otherwise 401. `POST /api/auth/logout` clears the cookie.

### Session cookie

Cookie `og_session`, value `<base64url(payload JSON)>.<base64url(HMAC-SHA256(payload bytes, SESSION_SECRET))>`, payload `{"sub":"owner","iat":<unix seconds>,"exp":<unix seconds>}`, twelve hours, `HttpOnly; Secure; SameSite=Strict; Path=/`.

The MAC is over the decoded payload bytes, not the base64url text. Verification decodes both halves, recomputes the MAC, compares in constant time (`crypto.timingSafeEqual` in Node, `crypto.subtle.verify` in the middleware), then checks `exp` and that `iat` is not in the future. There is no server-side session list, so sign-out is the browser forgetting the cookie; a copied cookie stays valid until `exp` or until `SESSION_SECRET` changes.

`api/_lib/session.js` exports `createSession()`, `verifySession(cookieHeaderOrValue)`, `setSessionCookie(res, value)`, `clearSessionCookie(res)`, and `requireSession(req, res)`, which sends `401 {"error":"unauthorized"}` and returns null when the cookie is absent or bad. Other serverless handlers call `requireSession` as a second line behind the middleware.

### Challenge cookie

Cookie `og_challenge`, same signing scheme, payload `{"challenge","kind","iat","exp"}` with a two-minute `exp`, `HttpOnly; Secure; SameSite=Strict; Path=/api/auth`. `kind` is `auth` or `reg`, so a registration challenge cannot be replayed to the login verifier. Both verify routes clear the cookie before checking anything, which is what makes a challenge single use without a store.

### Counters

WebAuthn authenticators may report a signature counter that should only ever go up; a replayed or cloned credential would show a stale value. SimpleWebAuthn v13 enforces: if the stored counter is 0, any reported counter is accepted; if the stored counter is above 0, the reported counter must be greater or verification throws. Our stored counter is whatever `PASSKEY_CREDENTIAL` says.

Synced passkeys from Apple, Google, and the password managers report 0 every time, so the enrolled `counter: 0` is correct forever and nothing needs updating.

A hardware security key increments the counter on every use. We cannot write the new value back into an environment variable from a request, so the stored value stays at whatever enrollment produced (usually 0 or 1). With a stored 0 the key still works, because 0 means "accept anything", but the clone-detection benefit of the counter is lost. If that matters to you, give the counter a home: Vercel KV, Upstash Redis, or a tiny Blob, read it in `verify.js` and write `authenticationInfo.newCounter` after a success. `verify.js` already logs a warning when it sees a counter advance it cannot persist, so the gap is visible in the function logs. Do not enroll a hardware key with a counter above 0 in `PASSKEY_CREDENTIAL` and leave it there: the second sign-in would still be at or above that value and work, but you would be relying on the key never being reset.

### User verification

Options ask for `userVerification: "preferred"`, so the verifiers pass `requireUserVerification: false`. Most platform authenticators verify anyway (biometric or PIN). Set both to `required` in `options.js`, `verify.js`, `setup-options.js`, and `setup-verify.js` if you only ever use authenticators that can do it.

## Middleware

`middleware.js` at the repo root is Vercel Routing Middleware (the feature previously called Edge Middleware). It runs before every matched request, uses only Web APIs, and reads `SESSION_SECRET` from `process.env`.

Rules:

| Path | Without a session |
|---|---|
| `/login`, `/login.js`, `/api/auth/*`, `/backgenapp`, `/backgenapp/*`, `/vendor/*`, `/favicon.ico` | pass through |
| `/api/*` (anything else) | `401 {"error":"unauthorized"}` |
| any other page | `302` to `/login` |

With a valid `og_session` cookie everything passes. "Pass through" is a `Response` carrying `x-middleware-next: 1`, which is exactly what `@vercel/functions`' `next()` builds (checked in `@vercel/functions` 3.9.11, `middleware.js`); building it by hand avoids adding that dependency.

`config.matcher` is `["/((?!vendor/|favicon\\.ico).*)"]`: static vendor files and the favicon skip the middleware entirely, every other path runs it. The public-path check is then done in code with exact and prefix matches, so `/login-x` or `/backgenappx` are not accidentally public and `/Login` is treated as a protected page.

Declaration, per the Vercel docs (see Sources): the file is `middleware.js` or `middleware.ts` at the same level as `package.json`, the handler is the default export, and `export const config = { matcher: [...] }` scopes it. Vercel bundles this file itself, so its ESM syntax does not need `"type": "module"` in `package.json`; that note in the docs is about functions under `api/`, which here stay CommonJS. The default runtime is now `nodejs`; the file does not pin a runtime because it uses nothing beyond `Request`, `Response`, `URL`, `atob`, `TextEncoder`, and `crypto.subtle`, which both runtimes provide.

If a deploy ever reports that the middleware file could not be parsed, rename it to `middleware.mjs`; nothing else references it by name. The test loads it as `.mjs` for the same reason.

## Rate limiting

`api/_lib/ratelimit.js` keeps a `Map` from client IP (first value of `x-forwarded-for`) to recent failure timestamps. Five failures within ten minutes lock that IP for one hour; locked callers get `429 {"error":"rate_limited","retry_after":<seconds>}` with a `Retry-After` header from `options`, `verify`, `setup-options`, and `setup-verify`. A failure is a bad assertion, a wrong credential id, a missing or expired challenge, a wrong setup token, or a bad registration. A successful verify clears the IP.

This is best effort. The map lives in the memory of one serverless instance: a cold start forgets it, and two concurrent instances do not share it. What actually protects the login is the passkey signature, which cannot be guessed, and the challenge cookie, which expires in two minutes. What actually closes enrollment is deleting `SETUP_TOKEN`, after which the setup routes are 404 regardless of what anyone sends. If you ever want a durable limiter, the same shape works over Vercel KV with a TTL.

## Threat notes

- Stolen session cookie. `HttpOnly` keeps scripts away from it, `Secure` keeps it off plain HTTP, `SameSite=Strict` means other sites cannot ride it. Twelve hours bounds the damage; rotate `SESSION_SECRET` to kill every session at once.
- Forged cookie. Needs `SESSION_SECRET`. The MAC is checked in constant time before the payload is even parsed.
- Guessing the passkey. Not feasible; the server sees a signature over a fresh random challenge and verifies it against the enrolled public key.
- Replay. The challenge is random, lives two minutes, and the cookie is cleared on the first verify attempt. The counter check adds clone detection for authenticators that count.
- Phishing. WebAuthn binds the assertion to `RP_ID` and `ORIGIN`; a lookalike domain cannot produce a valid response.
- Enrollment hijack. Needs `SETUP_TOKEN`, which exists only during the minutes you enroll, and the resulting credential is shown to you rather than stored, so even then nothing changes until you paste it into Vercel.
- Leaked `PASSKEY_CREDENTIAL`. It holds a public key and an id. It lets someone know which credential to ask for; it does not let them sign.
- Serverless routes called directly. Every protected handler should call `requireSession` as well as sitting behind the middleware. Belt and braces.
- `/backgenapp` is public by design and must keep holding no secrets and writing nothing, per `docs/ENGINE_DESIGN.md`.
- Local development over `http://localhost` works in Chrome and Firefox because they treat localhost as a secure context for `Secure` cookies and for WebAuthn. Set `RP_ID=localhost` and `ORIGIN=http://localhost:3000` in `.env.local` for `vercel dev`.

## Tests

`node tools/test-auth.js` runs without a browser or network: session round trip, tampering, expiry, the middleware's `crypto.subtle` verifier agreeing with `session.js` byte for byte, the middleware's routing rules against `Request` objects, the rate limiter with injected clocks, and each handler through mock `req`/`res` objects (setup routes 404 without `SETUP_TOKEN`, options 404 without `PASSKEY_CREDENTIAL`, verify rejecting bad assertions and counting toward the lock, me and logout). A real signature cannot be produced without an authenticator, so the success path of `verify` and `setup-verify` is exercised only by signing in on the deployed site.

## Sources

- Vercel, "Routing Middleware API": file name and location at the project root, default export, `config.matcher` with regex and negative lookahead, the `Request`/`context` signature, the note that non-framework JavaScript Functions need `"type": "module"` or `.mjs`. https://vercel.com/docs/routing-middleware/api
- Vercel, "Getting Started with Routing Middleware": reference table (file location `middleware.ts` in project root, `export default function middleware(request)`, `export const config = { matcher: [...] }`, default runtime `nodejs`). https://vercel.com/docs/routing-middleware/getting-started
- `@vercel/functions` 3.9.11, `middleware.js`: `next()` sets `x-middleware-next: 1`, `rewrite()` sets `x-middleware-rewrite`. https://www.npmjs.com/package/@vercel/functions
- SimpleWebAuthn server package docs (v13 API: `generateRegistrationOptions`, `verifyRegistrationResponse` returning `registrationInfo.credential`, `generateAuthenticationOptions`, `verifyAuthenticationResponse` taking `credential: { id, publicKey, counter, transports }`). https://simplewebauthn.dev/docs/packages/server
- Installed `@simplewebauthn/server` 13.3.3 type definitions and `verifyAuthenticationResponse.js` (counter rule: throws when `(counter > 0 || credential.counter > 0) && counter <= credential.counter`). `node_modules/@simplewebauthn/server/script/`
- SimpleWebAuthn browser package docs (v13: `startAuthentication({ optionsJSON })`, `startRegistration({ optionsJSON })`, UMD global `SimpleWebAuthnBrowser`). https://simplewebauthn.dev/docs/packages/browser
- W3C Web Authentication Level 3, signature counter semantics (section 6.1.1) and RP ID / origin validation in the assertion ceremony. https://www.w3.org/TR/webauthn-3/
- MDN, `SubtleCrypto.verify()` for HMAC verification in the middleware. https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/verify
