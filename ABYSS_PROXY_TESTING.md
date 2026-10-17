# AbyssPlayer proxy (experimental)

This is an isolated Cloudflare Worker for testing AbyssPlayer MP4 decryption. It does **not** change the existing Kino resolver yet, so Archive.org, Bysekoze and other working sources remain untouched.

## Deploy

1. Open Cloudflare Dashboard → Workers & Pages → Create → Worker.
2. Paste the contents of `abyss-proxy-worker.js` and deploy.
3. In Worker Settings → Variables, add `ALLOWED_ORIGINS`. Start with the media host observed in the Abyss `mp4.sources` payload, for example `*.sssrr.org`. Multiple entries are comma-separated. Use only the exact media domains that Abyss actually returns.
4. Open `https://YOUR-WORKER.workers.dev/health`; expected response: `ok`.
5. Open `https://YOUR-WORKER.workers.dev/selftest`; `md5_hola` must equal `4d186321c1a7f0f354b297e8914ab240`.
6. Test resolution with `/resolve?url=` plus a URL-encoded AbyssPlayer embed URL. A successful response returns JSON with a `url` pointing to this Worker's `/stream` endpoint.

## Important

- This Worker is a prototype; do not connect it to the plugin until the media-key derivation and the sample MP4 header have been verified against an actual encrypted response.
- The code assumes both media payload and file use AES-256-CTR with ASCII MD5-hex keys and the first 16 ASCII key bytes as the initial counter. The provided known plaintext header is a validation target; the source bytes are needed to confirm this assumption.
- The proxy preserves Range requests and decrypts only the portion overlapping the first 64 KiB. Later bytes are passed through.
- Keep `ALLOWED_ORIGINS` restrictive. The Worker rejects media hosts that are not explicitly allowlisted.
- Do not paste or publish temporary, signed media URLs in issues or public logs.
