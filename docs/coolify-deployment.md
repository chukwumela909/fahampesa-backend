# Coolify Dockerfile Deployment

This backend is ready to deploy on Coolify using the root `Dockerfile`.

## Coolify Settings

- Build pack: `Dockerfile`
- Dockerfile location: `/Dockerfile`
- Port: `4000`
- Health check path: `/api/v1/health`
- Start command: leave empty, the image uses `npm start`

## Required Environment Variables

Copy `.env.coolify.example` into Coolify's environment variable editor and replace the placeholder values.

```env
NODE_ENV=production
PORT=4000
MONGODB_URI=mongodb+srv://USER:PASSWORD@HOST/fahampesa
MONGODB_ALLOW_STANDALONE_WRITES=false
APP_BASE_URL=https://api.example.com
FIREBASE_PROJECT_ID=fahampesa-8c514
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@fahampesa-8c514.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_KEY_CONTENT\n-----END PRIVATE KEY-----\n"
FIREBASE_STORAGE_BUCKET=fahampesa-8c514.appspot.com
```

## Notes

- Use MongoDB Atlas or another MongoDB replica set for production. The app uses MongoDB transactions, and standalone MongoDB writes are intentionally not allowed in production.
- Keep Firebase service account credentials server-only. Do not commit real `.env` files or service account JSON files.
- `APP_BASE_URL` should be the public URL of this API service in Coolify.
- If you prefer file-based Firebase credentials, mount the service account JSON as a secret and set `FIREBASE_SERVICE_ACCOUNT_PATH` to the mounted path instead of setting `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`.
