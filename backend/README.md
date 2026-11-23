# EdgeAudioQC Backend

Auth + file upload + versioned publishing API for the team website, plus the
signaling server for the 2-person WebRTC test call. Built with Express, a small
JSON-file database (`src/better-sqlite3-shim.js`, file at `DB_PATH`), and
S3-compatible object storage (AWS S3 or Cloudflare R2). If no S3 credentials
are configured, uploads are stored on the server's disk under `public/uploads`.

## What it does

- `POST /api/auth/login` - logs in the single admin/instructor account, returns a JWT
- `POST /api/upload` - (auth required) accepts a file, pushes it to object storage
- `POST /api/publish` - (auth required) turns an uploaded file + metadata into a permanent, versioned page. Publishing a new slug (e.g. `planning-v2`) never touches or removes an older one (e.g. `planning-v1`) - old versions stay live forever, which is a hard requirement from the assignment.
- `GET /api/deliverables` - public list of everything ever published (for the site's nav/version history)
- `GET /api/deliverables/:slug` - public fetch of one specific version's metadata
- `POST /api/meeting/join`, `GET /api/meeting/:id/poll`, `POST /api/meeting/signal`, `POST /api/meeting/leave`, `GET /api/meeting/:id/check` - in-memory WebRTC signaling for the live call page

## Local setup

```bash
npm install
cp .env.example .env
```

Edit `.env`:
- Generate an admin password hash: `node -e "console.log(require('bcryptjs').hashSync('yourpassword', 10))"` and paste it into `ADMIN_PASSWORD_HASH`
- Set `JWT_SECRET` to a long random string
- Fill in your S3 or R2 credentials and bucket name
- Set `ALLOWED_ORIGINS` to a comma-separated list of frontend origins, e.g. `https://edgeaudioqc.pages.dev,http://localhost:5173`. A leading wildcard matches subdomains: `https://*.edgeaudioqc.pages.dev`. If it is left empty, every origin is allowed (a warning is printed at startup) - fine for local development, not for production.
- Optional: `LOCAL_UPLOAD_URL` - the public base URL of this server, used to build file links when S3 is not configured (default `http://localhost:3000`)

Run it:
```bash
npm run dev
```

Check it's alive:
```bash
curl http://localhost:3000/api/health
```

## Manual end-to-end test (do this before wiring up the frontend)

```bash
# 1. Log in
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"yourpassword"}'
# copy the "token" value from the response

# 2. Upload a file
curl -X POST http://localhost:3000/api/upload \
  -H "Authorization: Bearer <token>" \
  -F "file=@/path/to/some-file.pdf"
# copy the "fileKey" and "fileUrl" from the response

# 3. Publish it as a permanent version
curl -X POST http://localhost:3000/api/publish \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "planning-v1",
    "title": "Planning Presentation v1",
    "deliverableType": "planning",
    "version": "v1",
    "presentationDate": "2026-08-25",
    "authors": "Your Team Name",
    "changeSummary": "Initial submission",
    "fileKey": "<fileKey from step 2>",
    "fileUrl": "<fileUrl from step 2>"
  }'

# 4. Confirm it's publicly readable
curl http://localhost:3000/api/deliverables/planning-v1
```

## Object storage setup (Cloudflare R2 example)

1. Create an R2 bucket in the Cloudflare dashboard.
2. Create an R2 API token (Account Home -> R2 -> Manage API Tokens) with read/write access to that bucket.
3. In `.env`:
   - `S3_ENDPOINT=https://<your-account-id>.r2.cloudflarestorage.com`
   - `S3_REGION=auto`
   - `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` from the token you created
4. Enable public access on the bucket (R2 -> your bucket -> Settings -> Public Access) and use the `pub-xxxx.r2.dev` URL it gives you as `S3_PUBLIC_BASE_URL`.

For real AWS S3 instead: leave `S3_ENDPOINT` blank, set `S3_REGION` to your bucket's actual region (e.g. `ap-south-1`), and set `S3_PUBLIC_BASE_URL` to `https://<bucket>.s3.<region>.amazonaws.com`. Make sure the bucket policy allows public `GetObject`, or front it with CloudFront if you want the files not to be public.

## Deploying to your VM

This assumes the Oracle Cloud / AWS EC2 setup from earlier in this project (Nginx + systemd + certbot already configured).

```bash
# On the VM
git clone <your-repo-url> edgeaudioqc-backend
cd edgeaudioqc-backend
npm install --omit=dev
cp .env.example .env
nano .env   # fill in real production values
```

Create the systemd service (`/etc/systemd/system/edgeaudioqc.service`):
```ini
[Unit]
Description=EdgeAudioQC Backend
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/edgeaudioqc-backend
ExecStart=/usr/bin/node src/index.js
Restart=always
EnvironmentFile=/home/ubuntu/edgeaudioqc-backend/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable edgeaudioqc
sudo systemctl start edgeaudioqc
sudo systemctl status edgeaudioqc
```

Your Nginx config should already be proxying `your-domain` to `localhost:3000` (or wherever `PORT` is set) - see the earlier Nginx setup steps.

## Security notes for your team to actually understand (not just deploy)

- Passwords are never stored in plaintext - only a bcrypt hash, in an env var, never committed to git.
- Login is rate-limited: 5 failed attempts from one IP lock that IP out for 15 minutes. The password check is asynchronous, so it doesn't block other requests.
- JWTs expire (`JWT_EXPIRES_IN`, default 8h) - a stolen token doesn't work forever.
- Slug uniqueness is enforced by the API (`/api/publish` returns 409 for an existing slug, and there is no update or delete route), which is what guarantees old versions are never overwritten. Slugs must be URL-safe and can't reuse a site page's path (e.g. `team`, `admin`).
- The database is a JSON file. Writes go to a temporary file which is then renamed over the original, so a crash can't leave it half-written. The server refuses to start if `DB_PATH` points at a file in another format (e.g. an old SQLite database) instead of deleting it.
- With S3/R2 configured, uploads go straight from memory to object storage. Without it, they are written to `public/uploads` and served with `X-Content-Type-Options: nosniff`; anything other than PDFs and images is forced to download, so an uploaded HTML/SVG file can't run as a page on the API's domain.
- CORS is limited to `ALLOWED_ORIGINS`. Auth uses a Bearer header (not cookies), so credentials mode is off.
- The meeting signaling routes are unauthenticated by design (anyone with a room code can join), but inputs are validated and memory is capped: max 500 rooms, 8 users per room, 200 queued signals per user, 16 KB per signal. Users who stop polling for 45 s are removed.

Every team member should be able to explain each of these choices, not just the person who wrote this file - that's an explicit requirement in the assignment.
