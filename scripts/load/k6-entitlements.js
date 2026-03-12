import http from "k6/http";
import { check, sleep } from "k6";

// Usage:
//   BASE_URL=http://localhost:3000 k6 run scripts/load/k6-entitlements.js
// Provide a valid signature/timestamp/payload if your server enforces Discord verification.

export const options = {
  vus: Number(__ENV.VUS || 50),
  duration: __ENV.DURATION || "30s",
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<500"],
  },
};

const baseUrl = __ENV.BASE_URL || "http://localhost:3000";
const path = __ENV.PATH || "/discord/entitlements";

const payload = __ENV.BODY || JSON.stringify({
  type: "ENTITLEMENT_CREATE",
  sku_id: "test_sku",
  user_id: "test_user",
  guild_id: "test_guild",
  entitlement_id: `ent_${Math.random().toString(16).slice(2)}`
});

const headers = {
  "content-type": "application/json",
  "x-signature-ed25519": __ENV.SIGNATURE || "",
  "x-signature-timestamp": __ENV.TIMESTAMP || Date.now().toString(),
};

export default function () {
  const res = http.post(`${baseUrl}${path}`, payload, { headers });
  check(res, {
    "status not 5xx": (r) => r.status < 500,
  });
  sleep(Number(__ENV.SLEEP || 0.1));
}
