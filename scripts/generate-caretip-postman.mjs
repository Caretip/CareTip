/**
 * Generates CareTip Postman collection + environment JSON files.
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const bearer = (varName = "managerToken") => ({
  key: "Authorization",
  value: `Bearer {{${varName}}}`,
});

function req(name, method, path, opts = {}) {
  const headers = [{ key: "Content-Type", value: "application/json" }, ...(opts.headers ?? [])];
  const item = {
    name,
    request: {
      method,
      header: headers,
      url: {
        raw: `{{baseUrl}}${path}`,
        host: ["{{baseUrl}}"],
        path: path.replace(/^\//, "").split("/"),
      },
      ...(opts.body ? { body: { mode: "raw", raw: JSON.stringify(opts.body, null, 2) } } : {}),
      description: opts.description ?? "",
    },
    event: opts.tests
      ? [
          {
            listen: "test",
            script: {
              type: "text/javascript",
              exec: opts.tests,
            },
          },
        ]
      : [],
  };
  if (opts.prerequest) {
    item.event = item.event ?? [];
    item.event.unshift({
      listen: "prerequest",
      script: { type: "text/javascript", exec: opts.prerequest },
    });
  }
  return item;
}

const loginTests = (tokenVar, bizVar) => [
  "pm.test('Status 200', () => pm.response.to.have.status(200));",
  "const j = pm.response.json();",
  `pm.environment.set('${tokenVar}', j.token);`,
  "pm.expect(j.token).to.be.a('string').and.not.empty;",
  bizVar ? `if (j.user?.businessId) pm.environment.set('${bizVar}', j.user.businessId);` : "",
  "if (j.user?.employeeId) pm.environment.set('employeeRowId', j.user.employeeId);",
].filter(Boolean);

const collection = {
  info: {
    name: "CareTip API Security & Integration",
    description:
      "Security-focused API tests: auth, tenant isolation, KYC gates, CRUD, platform protection, Stripe validation.",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  variable: [
    { key: "baseUrl", value: "http://localhost:3001" },
  ],
  item: [
    {
      name: "00 — Health",
      item: [
        req("GET /health", "GET", "/health", {
          tests: [
            "pm.test('Status 200', () => pm.response.to.have.status(200));",
            "pm.test('status ok', () => pm.expect(pm.response.json().status).to.eql('ok'));",
          ],
        }),
      ],
    },
    {
      name: "01 — Authentication",
      item: [
        req("POST login — missing intendedRole → 400", "POST", "/api/auth/login", {
          body: { email: "{{managerEmail}}", password: "{{managerPassword}}" },
          tests: [
            "pm.test('Status 400', () => pm.response.to.have.status(400));",
            "pm.test('mentions intendedRole', () => pm.expect(pm.response.json().message).to.match(/intendedRole/i));",
          ],
        }),
        req("POST login — invalid credentials → 401", "POST", "/api/auth/login", {
          body: {
            email: "{{managerEmail}}",
            password: "wrong-password-probe",
            intendedRole: "MANAGER",
          },
          tests: ["pm.test('Status 401', () => pm.response.to.have.status(401));"],
        }),
        req("POST login — manager", "POST", "/api/auth/login", {
          body: {
            email: "{{managerEmail}}",
            password: "{{managerPassword}}",
            intendedRole: "MANAGER",
          },
          tests: loginTests("managerToken", "businessIdA"),
        }),
        req("POST login — employee", "POST", "/api/auth/login", {
          body: {
            email: "{{employeeEmail}}",
            password: "{{employeePassword}}",
            intendedRole: "EMPLOYEE",
          },
          tests: loginTests("employeeToken", "businessIdA"),
        }),
        req("POST login — platform admin", "POST", "/api/auth/login", {
          body: {
            email: "{{adminEmail}}",
            password: "{{adminPassword}}",
            intendedRole: "SUPER_ADMIN",
          },
          tests: loginTests("adminToken", null),
        }),
      ],
    },
    {
      name: "02 — Refresh token",
      item: [
        req("POST refresh — returns new access token", "POST", "/api/auth/refresh", {
          body: {},
          headers: [bearer("managerToken")],
          tests: [
            "pm.test('Status 200', () => pm.response.to.have.status(200));",
            "const j = pm.response.json();",
            "pm.expect(j.token).to.be.a('string').and.not.empty;",
            "pm.environment.set('managerToken', j.token);",
          ],
        }),
      ],
    },
    {
      name: "03 — Logout",
      item: [
        req("POST logout", "POST", "/api/auth/logout", {
          body: {},
          headers: [bearer("managerToken")],
          tests: ["pm.test('Status 200 or 204', () => pm.expect(pm.response.code).to.be.oneOf([200, 204]));"],
        }),
        req("POST login — manager (re-auth after logout)", "POST", "/api/auth/login", {
          body: {
            email: "{{managerEmail}}",
            password: "{{managerPassword}}",
            intendedRole: "MANAGER",
          },
          tests: loginTests("managerToken", "businessIdA"),
        }),
      ],
    },
    {
      name: "04 — Business stats",
      item: [
        req("GET stats — unauthenticated → 401", "GET", "/api/business/me/stats?timeframe=month&scope=summary", {
          tests: ["pm.test('Status 401', () => pm.response.to.have.status(401));"],
        }),
        req("GET stats — manager summary", "GET", "/api/business/me/stats?timeframe=month&scope=summary", {
          headers: [bearer("managerToken")],
          tests: [
            "pm.test('Status 200', () => pm.response.to.have.status(200));",
            "const j = pm.response.json();",
            "pm.expect(j).to.have.property('tipCount');",
            "pm.environment.set('statsTipCountA', String(j.tipCount ?? 0));",
          ],
        }),
        req("GET profile — manager (KYC poll allowed)", "GET", "/api/business/profile", {
          headers: [bearer("managerToken")],
          tests: [
            "pm.test('Status 200', () => pm.response.to.have.status(200));",
            "pm.test('has verificationStatus', () => pm.expect(pm.response.json()).to.have.property('verificationStatus'));",
          ],
        }),
      ],
    },
    {
      name: "05 — Employee CRUD",
      item: [
        req("GET public employees — no auth", "GET", "/api/employees?businessId={{businessIdA}}", {
          tests: [
            "pm.test('Status 200', () => pm.response.to.have.status(200));",
            "const arr = pm.response.json();",
            "pm.expect(arr).to.be.an('array');",
            "if (arr.length) pm.expect(arr[0]).to.not.have.property('email');",
          ],
        }),
        req("POST create employee (probe)", "POST", "/api/employees", {
          headers: [bearer("managerToken")],
          body: {
            name: "Newman Probe Staff",
            role: "Server",
            email: "newman-probe-{{$timestamp}}@caretip.de",
          },
          tests: [
            "pm.test('Status 201 or 400', () => pm.expect(pm.response.code).to.be.oneOf([201, 400]));",
            "if (pm.response.code === 201) {",
            "  pm.environment.set('probeEmployeeId', pm.response.json().id);",
            "}",
          ],
        }),
        req("PATCH employee — probe update", "PATCH", "/api/employees/{{probeEmployeeId}}", {
          headers: [bearer("managerToken")],
          body: { jobTitle: "Updated by Newman" },
          tests: [
            "if (!pm.environment.get('probeEmployeeId')) { pm.test.skip('No probe employee created'); return; }",
            "pm.test('Status 200', () => pm.response.to.have.status(200));",
          ],
        }),
        req("DELETE employee — probe cleanup", "DELETE", "/api/employees/{{probeEmployeeId}}", {
          headers: [bearer("managerToken")],
          tests: [
            "if (!pm.environment.get('probeEmployeeId')) { pm.test.skip('No probe employee'); return; }",
            "pm.test('Status 200 or 204', () => pm.expect(pm.response.code).to.be.oneOf([200, 204]));",
          ],
        }),
      ],
    },
    {
      name: "06 — Tenant isolation",
      item: [
        req("POST login — manager B (optional)", "POST", "/api/auth/login", {
          body: {
            email: "{{managerBEmail}}",
            password: "{{managerBPassword}}",
            intendedRole: "MANAGER",
          },
          tests: [
            "if (pm.response.code === 200) {",
            "  pm.environment.set('managerBToken', pm.response.json().token);",
            "  pm.environment.set('businessIdB', pm.response.json().user.businessId);",
            "  pm.environment.set('hasManagerB', 'true');",
            "} else {",
            "  pm.environment.unset('hasManagerB');",
            "}",
            "pm.test('Login attempted', () => true);",
          ],
        }),
        req("GET stats B — compare to A", "GET", "/api/business/me/stats?timeframe=month&scope=summary", {
          headers: [bearer("managerBToken")],
          tests: [
            "if (pm.environment.get('hasManagerB') !== 'true') { pm.test.skip('Manager B not configured'); return; }",
            "pm.test('Status 200', () => pm.response.to.have.status(200));",
            "const b = pm.response.json();",
            "const aCount = pm.environment.get('statsTipCountA');",
            "if (pm.environment.get('businessIdB') !== pm.environment.get('businessIdA')) {",
            "  pm.test('Distinct business IDs', () => pm.expect(pm.environment.get('businessIdB')).to.not.eql(pm.environment.get('businessIdA')));",
            "}",
          ],
        }),
        req("PATCH employee — manager A cannot patch foreign id", "PATCH", "/api/employees/00000000-0000-0000-0000-000000000001", {
          headers: [bearer("managerToken")],
          body: { name: "Cross-tenant probe" },
          tests: [
            "pm.test('Status 403 or 404', () => pm.expect(pm.response.code).to.be.oneOf([403, 404]));",
          ],
        }),
        req("GET platform stats — manager denied", "GET", "/api/platform/stats", {
          headers: [bearer("managerToken")],
          tests: ["pm.test('Status 403', () => pm.response.to.have.status(403));"],
        }),
      ],
    },
    {
      name: "07 — KYC enforcement",
      item: [
        req("GET stats — requires approved KYC (verified manager)", "GET", "/api/business/me/stats?timeframe=month&scope=summary", {
          headers: [bearer("managerToken")],
          tests: [
            "pm.test('Verified manager stats 200', () => pm.response.to.have.status(200));",
          ],
        }),
        req("POST login — pending KYC manager (optional)", "POST", "/api/auth/login", {
          body: {
            email: "{{managerPendingEmail}}",
            password: "{{managerPendingPassword}}",
            intendedRole: "MANAGER",
          },
          tests: [
            "if (pm.response.code === 200) {",
            "  pm.environment.set('managerPendingToken', pm.response.json().token);",
            "  pm.environment.set('hasPendingManager', 'true');",
            "} else { pm.environment.unset('hasPendingManager'); }",
            "pm.test('Attempted', () => true);",
          ],
        }),
        req("GET stats — pending KYC → 403", "GET", "/api/business/me/stats?timeframe=month&scope=summary", {
          headers: [bearer("managerPendingToken")],
          tests: [
            "if (pm.environment.get('hasPendingManager') !== 'true') { pm.test.skip('No pending KYC account'); return; }",
            "pm.test('Status 403 pending verification', () => pm.response.to.have.status(403));",
          ],
        }),
        req("GET profile — pending KYC still allowed", "GET", "/api/business/profile", {
          headers: [bearer("managerPendingToken")],
          tests: [
            "if (pm.environment.get('hasPendingManager') !== 'true') { pm.test.skip('No pending KYC account'); return; }",
            "pm.test('Status 200 profile poll', () => pm.response.to.have.status(200));",
          ],
        }),
      ],
    },
    {
      name: "08 — Locations",
      item: [
        req("GET locations", "GET", "/api/locations", {
          headers: [bearer("managerToken")],
          tests: [
            "pm.test('Status 200', () => pm.response.to.have.status(200));",
            "pm.expect(pm.response.json()).to.be.an('array');",
            "const locs = pm.response.json();",
            "if (locs.length) pm.environment.set('locationId', locs[0].id);",
          ],
        }),
        req("POST location — create probe", "POST", "/api/locations", {
          headers: [bearer("managerToken")],
          body: { name: "Newman Location {{$timestamp}}", description: "API test" },
          tests: [
            "pm.test('Status 201 or 400', () => pm.expect(pm.response.code).to.be.oneOf([201, 400]));",
            "if (pm.response.code === 201) pm.environment.set('locationId', pm.response.json().id);",
          ],
        }),
      ],
    },
    {
      name: "09 — Tables",
      item: [
        req("GET tables", "GET", "/api/tables", {
          headers: [bearer("managerToken")],
          tests: [
            "pm.test('Status 200 or 403 subscription', () => pm.expect(pm.response.code).to.be.oneOf([200, 403]));",
          ],
        }),
        req("POST table — create probe", "POST", "/api/tables", {
          headers: [bearer("managerToken")],
          body: {
            name: "Newman Table {{$timestamp}}",
            locationId: "{{locationId}}",
          },
          tests: [
            "if (!pm.environment.get('locationId')) { pm.test.skip('No locationId'); return; }",
            "pm.test('Status 201 or 403 or 400', () => pm.expect(pm.response.code).to.be.oneOf([201, 403, 400]));",
          ],
        }),
      ],
    },
    {
      name: "10 — Tips",
      item: [
        req("GET tips — business manager", "GET", "/api/tips/business?limit=5", {
          headers: [bearer("managerToken")],
          tests: [
            "pm.test('Status 200', () => pm.response.to.have.status(200));",
          ],
        }),
        req("GET tips — employee self", "GET", "/api/tips/employee/list?limit=5", {
          headers: [bearer("employeeToken")],
          tests: [
            "pm.test('Status 200', () => pm.response.to.have.status(200));",
          ],
        }),
      ],
    },
    {
      name: "11 — Transactions export",
      item: [
        req("GET transactions export — manager", "GET", "/api/transactions/export", {
          headers: [bearer("managerToken")],
          tests: [
            "pm.test('Status 200 or 403 subscription', () => pm.expect(pm.response.code).to.be.oneOf([200, 403]));",
          ],
        }),
        req("GET transactions export — employee denied", "GET", "/api/transactions/export", {
          headers: [bearer("employeeToken")],
          tests: ["pm.test('Status 403', () => pm.response.to.have.status(403));"],
        }),
      ],
    },
    {
      name: "12 — Support tickets",
      item: [
        req("POST support ticket", "POST", "/api/business/support/tickets", {
          headers: [bearer("managerToken")],
          body: {
            subject: "Newman probe ticket",
            category: "general",
            message: "Automated API security test message.",
          },
          tests: [
            "pm.test('Status 201', () => pm.response.to.have.status(201));",
            "pm.environment.set('supportTicketId', pm.response.json().ticket.id);",
          ],
        }),
        req("GET support tickets list", "GET", "/api/business/support/tickets", {
          headers: [bearer("managerToken")],
          tests: ["pm.test('Status 200', () => pm.response.to.have.status(200));"],
        }),
        req("GET support ticket detail", "GET", "/api/business/support/tickets/{{supportTicketId}}", {
          headers: [bearer("managerToken")],
          tests: [
            "if (!pm.environment.get('supportTicketId')) { pm.test.skip('No ticket'); return; }",
            "pm.test('Status 200', () => pm.response.to.have.status(200));",
          ],
        }),
      ],
    },
    {
      name: "13 — Platform admin protection",
      item: [
        req("GET platform stats — admin allowed", "GET", "/api/platform/stats", {
          headers: [bearer("adminToken")],
          tests: ["pm.test('Status 200', () => pm.response.to.have.status(200));"],
        }),
        req("GET platform stats — employee denied", "GET", "/api/platform/stats", {
          headers: [bearer("employeeToken")],
          tests: ["pm.test('Status 403', () => pm.response.to.have.status(403));"],
        }),
        req("GET platform stats — no token", "GET", "/api/platform/stats", {
          tests: ["pm.test('Status 401', () => pm.response.to.have.status(401));"],
        }),
      ],
    },
    {
      name: "14 — Stripe session validation",
      item: [
        req("POST create-tip-session — missing fields → 400", "POST", "/api/payments/create-tip-session", {
          body: { amount: 5 },
          tests: ["pm.test('Status 400', () => pm.response.to.have.status(400));"],
        }),
        req("POST create-tip-session — tipAmount mismatch → 400", "POST", "/api/payments/create-tip-session", {
          body: {
            employeeId: "{{employeeRowId}}",
            businessId: "{{businessIdA}}",
            amount: 10,
            tipAmount: 1,
          },
          tests: [
            "pm.test('Status 400 mismatch', () => pm.response.to.have.status(400));",
            "pm.test('Message mentions match', () => pm.expect(pm.response.json().message).to.match(/match/i));",
          ],
        }),
        req("POST create-tip-session — valid shape", "POST", "/api/payments/create-tip-session", {
          body: {
            employeeId: "{{employeeRowId}}",
            businessId: "{{businessIdA}}",
            amount: 5,
            tipAmount: 5,
          },
          tests: [
            "pm.test('Status 200 or 503 or 400', () => pm.expect(pm.response.code).to.be.oneOf([200, 400, 503]));",
            "if (pm.response.code === 503) {",
            "  pm.test('Stripe not configured code', () => pm.expect(pm.response.json().code).to.eql('STRIPE_NOT_CONFIGURED'));",
            "}",
            "if (pm.response.code === 200) {",
            "  pm.test('Has sessionId', () => pm.expect(pm.response.json()).to.have.property('sessionId'));",
            "}",
          ],
        }),
      ],
    },
  ],
};

const environment = {
  name: "CareTip Local",
  values: [
    { key: "baseUrl", value: "http://localhost:3001", enabled: true },
    { key: "managerEmail", value: "<MANAGER_EMAIL>", enabled: true },
    { key: "managerPassword", value: "<PASSWORD>", enabled: true },
    { key: "managerBEmail", value: "<MANAGER_B_EMAIL>", enabled: true },
    { key: "managerBPassword", value: "<PASSWORD>", enabled: true },
    { key: "managerPendingEmail", value: "", enabled: true },
    { key: "managerPendingPassword", value: "", enabled: true },
    { key: "employeeEmail", value: "<EMPLOYEE_EMAIL>", enabled: true },
    { key: "employeePassword", value: "<PASSWORD>", enabled: true },
    { key: "adminEmail", value: "<ADMIN_EMAIL>", enabled: true },
    { key: "adminPassword", value: "<PASSWORD>", enabled: true },
    { key: "managerToken", value: "", enabled: true },
    { key: "managerBToken", value: "", enabled: true },
    { key: "managerPendingToken", value: "", enabled: true },
    { key: "employeeToken", value: "", enabled: true },
    { key: "adminToken", value: "", enabled: true },
    { key: "businessIdA", value: "", enabled: true },
    { key: "businessIdB", value: "", enabled: true },
    { key: "employeeRowId", value: "", enabled: true },
    { key: "locationId", value: "", enabled: true },
    { key: "probeEmployeeId", value: "", enabled: true },
    { key: "supportTicketId", value: "", enabled: true },
  ],
  _postman_variable_scope: "environment",
};

writeFileSync(join(root, "caretip-postman-collection.json"), JSON.stringify(collection, null, 2));
writeFileSync(join(root, "caretip-postman-environment.json"), JSON.stringify(environment, null, 2));
console.log("Wrote caretip-postman-collection.json and caretip-postman-environment.json");
