# Google Cloud setup (free edition)

Family Hub's free edition has no server. It needs a Google Cloud project that gives the browser app an OAuth client (for sign-in and Drive access) and an API key (for the Google Picker). This takes about 10 minutes and costs nothing.

## 1. Create the project

1. Go to <https://console.cloud.google.com/> and create a project, e.g. `family-hub`.
2. On the project dashboard, note the **Project number** (digits only). This is `VITE_GOOGLE_APP_ID`.

## 2. Enable APIs

Under **APIs & Services → Library**, enable:

- **Google Drive API**
- **Google Picker API**

## 3. OAuth consent screen

Under **APIs & Services → OAuth consent screen** (shown as "Google Auth Platform" in newer consoles):

1. User type: **External**.
2. App name `Family Hub`, plus your support email and developer contact email.
3. Scopes: add `https://www.googleapis.com/auth/drive.file`. Google classes it as non-sensitive, so a public launch will not need a security assessment.
4. Publishing status: leave it in **Testing**, and under **Test users** add every Google account you will test with (yours and at least one family member's). Accounts not on the list cannot sign in while the app is in Testing.

## 4. OAuth client ID

**APIs & Services → Credentials → Create credentials → OAuth client ID**

- Application type: **Web application**
- Authorized JavaScript origins:
  - `http://localhost:5173` (dev server)
  - `http://localhost:4173` (`npm run preview`)
  - your production origin later, e.g. `https://familyhub.example.com`
- Redirect URIs: none needed. The app uses the popup token flow.

Copy the **Client ID** into `VITE_GOOGLE_CLIENT_ID`. A browser app does not use the client secret.

## 5. API key for the Picker

**Credentials → Create credentials → API key**, then edit it:

- Application restrictions: **Websites**, and add `http://localhost:5173/*`, `http://localhost:4173/*` and your production origin.
- API restrictions: **Restrict key → Google Picker API**.

Copy it into `VITE_GOOGLE_API_KEY`.

## 6. Configure the app

```sh
cp apps/web/.env.example apps/web/.env.local
# fill in VITE_GOOGLE_CLIENT_ID, VITE_GOOGLE_API_KEY, VITE_GOOGLE_APP_ID
npm run dev
```

## Testing on an Android phone

Google only accepts `https://` origins or `http://localhost`. Pick one way to reach the dev server from a phone:

- **USB port forwarding (simplest):** connect the phone over USB with USB debugging enabled. Open `chrome://inspect/#devices` on the PC, click **Port forwarding**, and map `5173` to `localhost:5173`. On the phone, open `http://localhost:5173`. No origin changes are needed.
- **HTTPS tunnel:** expose port 5173 with a tunnel such as `cloudflared` or `ngrok`, then add the tunnel's `https://` URL to the OAuth client's origins and to the API key's website restrictions.
- **Static deploy:** run `npm run build` and upload `apps/web/dist/` to any HTTPS static host (the plan targets S3 + CloudFront), then add that origin.

To install the app as a PWA, use the Chrome menu → **Install app** (or **Add to Home screen**).
