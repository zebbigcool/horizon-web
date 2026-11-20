// Makes the key badges are signed with: node web/rooms-service/make-badge-key.mjs
// Prints the private key (a JWK) to store as the Worker secret BADGE_KEY, e.g. paste it
// when `npx wrangler secret put BADGE_KEY` asks. The public half is served by the Worker
// itself (/api/badge-key); nothing else needs copying.
const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
console.log(JSON.stringify({ kty: jwk.kty, crv: jwk.crv, d: jwk.d, x: jwk.x }));
console.error("\nKeep that line secret. Set it with: npx wrangler secret put BADGE_KEY");
