# FahamPesa Backend Environment Setup

## Firebase Variables

The Firebase config from the Web/JS SDK looks like this:

```ts
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  databaseURL: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "...",
  measurementId: "..."
}
```

That config is for the frontend client app. It is not the same as the backend Firebase Admin SDK credentials.

## Backend Firebase Admin Variables

The backend currently expects these variables:

```env
FIREBASE_PROJECT_ID=fahampesa-8c514
FIREBASE_CLIENT_EMAIL=your-service-account@fahampesa-8c514.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_STORAGE_BUCKET=fahampesa-8c514.appspot.com
```

Use the `projectId` from the client config:

```env
FIREBASE_PROJECT_ID=fahampesa-8c514
```

Do not use the Web SDK `apiKey` as a backend admin credential.

## How To Get Admin SDK Credentials

1. Open Firebase Console.
2. Select the `fahampesa-8c514` project.
3. Go to Project settings.
4. Open the Service accounts tab.
5. Click Generate new private key.
6. Download the JSON file.
7. Copy these values into `.env`:

```json
{
  "project_id": "FIREBASE_PROJECT_ID",
  "client_email": "FIREBASE_CLIENT_EMAIL",
  "private_key": "FIREBASE_PRIVATE_KEY"
}
```

## Important Security Rules

- Never commit `.env`.
- Never paste the service account private key into chat.
- The Web SDK config can appear in frontend code, but the service account JSON must remain server-only.
- Keep `FIREBASE_PRIVATE_KEY` wrapped in quotes in `.env`.
- Preserve newline escapes as `\n` inside the private key.
- In hosted deployment dashboards, set `FIREBASE_PRIVATE_KEY` to one of these safe formats:
  - the service account `private_key` value with `\n` newline escapes
  - the JSON-stringified `private_key` value
  - a base64-encoded PEM private key
- Do not paste the entire service account JSON into `FIREBASE_PRIVATE_KEY`; use only its `private_key` field.

## Payment Variables

Production requires live M-Pesa Daraja and Stripe server secrets. Keep these only in local `.env` files or deployment secrets.

```env
MPESA_ENVIRONMENT=production
MPESA_SHORTCODE=YOUR_MPESA_SHORTCODE
MPESA_PASSKEY=YOUR_MPESA_PASSKEY
MPESA_CONSUMER_KEY=YOUR_MPESA_CONSUMER_KEY
MPESA_CONSUMER_SECRET=YOUR_MPESA_CONSUMER_SECRET
MPESA_CALLBACK_URL=https://www.fahampesa.com/api/mpesa/callback

STRIPE_SECRET_KEY=sk_live_REPLACE_ME
STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME
```

`APP_BASE_URL` should point to the backend. `NEXT_PUBLIC_BASE_URL` can point to the web app and is used for default Stripe success/cancel URLs when the client does not send explicit redirect URLs.

## Example `.env`

```env
NODE_ENV=development
PORT=4000
MONGODB_URI=mongodb://127.0.0.1:27017/fahampesa

FIREBASE_PROJECT_ID=fahampesa-8c514
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@fahampesa-8c514.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_KEY_CONTENT\n-----END PRIVATE KEY-----\n"

APP_BASE_URL=http://localhost:4000
NEXT_PUBLIC_BASE_URL=http://localhost:3000
FIREBASE_STORAGE_BUCKET=fahampesa-8c514.appspot.com

MPESA_ENVIRONMENT=sandbox
MPESA_SHORTCODE=YOUR_SANDBOX_SHORTCODE
MPESA_PASSKEY=YOUR_SANDBOX_PASSKEY
MPESA_CONSUMER_KEY=YOUR_SANDBOX_CONSUMER_KEY
MPESA_CONSUMER_SECRET=YOUR_SANDBOX_CONSUMER_SECRET
MPESA_CALLBACK_URL=https://example.ngrok-free.app/api/mpesa/callback

STRIPE_SECRET_KEY=sk_test_REPLACE_ME
STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME
```
