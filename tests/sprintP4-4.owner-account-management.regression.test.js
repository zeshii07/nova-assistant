// Phase 4 Sprint 4 — Owner account management regression tests.
//
// Covers the three features added in this sprint:
//   (a) Self-serve forgot-password / reset-password (token issue + consume,
//       expiry, single-use, anti-enumeration).
//   (b) Self-serve change password / change email (re-auth required).
//   (c) Team / co-owner management (list, add, remove — last-owner protection).
//   (d) Admin owner management (add, update email, remove, reset password).
//
// Each test targets one behavior and would have FAILED before the sprint.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { BusinessOwnerAuthService } = require("../packages/auth-engine/src/businessOwnerAuthService");

let tenantsRoot;
let svc;

test.before(async () => {
  tenantsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nova-p4s4-owners-"));
  svc = new BusinessOwnerAuthService({ tenantsDir: tenantsRoot, logger: null });
});

function makeTenant(tenantId) {
  fs.mkdirSync(path.join(tenantsRoot, tenantId), { recursive: true });
  fs.writeFileSync(path.join(tenantsRoot, tenantId, "profile.json"), JSON.stringify({ id: tenantId, name: tenantId }));
}

// ═══════════════════════════════════════════════════════════════════════════
// (a) Self-serve forgot-password / reset-password
// ═══════════════════════════════════════════════════════════════════════════
test("forgot password: issues a token for a known owner", () => {
  const tenantId = "fp-known";
  makeTenant(tenantId);
  svc.createOwner({ tenantId, email: "owner@fp.com", password: "secret123", name: "Owner" });
  const r = svc.issuePasswordResetToken({ tenantId, email: "owner@fp.com" });
  assert.equal(r.ok, true);
  assert.ok(r.token, "a token must be returned for a known owner");
  assert.ok(r.token.length >= 32, "token must be a strong random string");
});

test("forgot password: unknown email returns ok + null token (anti-enumeration)", () => {
  const tenantId = "fp-unknown";
  makeTenant(tenantId);
  // No owner created — simulate a forgot-password request for a non-existent email.
  const r = svc.issuePasswordResetToken({ tenantId, email: "nobody@fp.com" });
  assert.equal(r.ok, true, "must return ok=true to avoid account enumeration");
  assert.equal(r.token, null, "no token must be issued for an unknown email");
});

test("reset password: consumes a valid token + sets the new password", () => {
  const tenantId = "rp-valid";
  makeTenant(tenantId);
  svc.createOwner({ tenantId, email: "owner@rp.com", password: "oldpass123", name: "Owner" });
  const { token } = svc.issuePasswordResetToken({ tenantId, email: "owner@rp.com" });
  const r = svc.consumePasswordResetToken({ tenantId, token, newPassword: "newpass456" });
  assert.equal(r.ok, true);
  // The new password must work at login.
  const login = svc.loginWithPassword({ tenantId, email: "owner@rp.com", password: "newpass456" });
  assert.equal(login.ok, true);
  // The old password must NOT work.
  const oldLogin = svc.loginWithPassword({ tenantId, email: "owner@rp.com", password: "oldpass123" });
  assert.equal(oldLogin.ok, false);
});

test("reset password: a token is single-use (second consume fails)", () => {
  const tenantId = "rp-single";
  makeTenant(tenantId);
  svc.createOwner({ tenantId, email: "owner@rs.com", password: "pass123", name: "Owner" });
  const { token } = svc.issuePasswordResetToken({ tenantId, email: "owner@rs.com" });
  svc.consumePasswordResetToken({ tenantId, token, newPassword: "newpass456" });
  // Reuse the same token — must fail.
  assert.throws(() => svc.consumePasswordResetToken({ tenantId, token, newPassword: "another789" }), /Invalid or already-used/i);
});

test("reset password: a token issued for tenant A cannot reset tenant B's password", () => {
  const tenantA = "rp-cross-a", tenantB = "rp-cross-b";
  makeTenant(tenantA); makeTenant(tenantB);
  svc.createOwner({ tenantId: tenantA, email: "a@cross.com", password: "passA123", name: "A" });
  svc.createOwner({ tenantId: tenantB, email: "b@cross.com", password: "passB123", name: "B" });
  const { token } = svc.issuePasswordResetToken({ tenantId: tenantA, email: "a@cross.com" });
  // Try to consume tenant A's token against tenant B — must fail.
  assert.throws(() => svc.consumePasswordResetToken({ tenantId: tenantB, token, newPassword: "hijacked1" }), /Invalid or already-used/i);
  // Tenant B's password is unchanged.
  assert.equal(svc.loginWithPassword({ tenantId: tenantB, email: "b@cross.com", password: "passB123" }).ok, true);
});

test("reset password: a garbage token is rejected", () => {
  const tenantId = "rp-garbage";
  makeTenant(tenantId);
  svc.createOwner({ tenantId, email: "o@rg.com", password: "pass123", name: "O" });
  assert.throws(() => svc.consumePasswordResetToken({ tenantId, token: "not-a-real-token", newPassword: "newpass456" }), /Invalid or already-used/i);
});

test("reset password: admin reset invalidates any pending self-serve token", () => {
  const tenantId = "rp-admin-invalidate";
  makeTenant(tenantId);
  svc.createOwner({ tenantId, email: "o@rai.com", password: "pass123", name: "O" });
  const { token } = svc.issuePasswordResetToken({ tenantId, email: "o@rai.com" });
  // Admin resets the password directly — the self-serve token must now be dead.
  svc.resetPassword({ tenantId, email: "o@rai.com", newPassword: "adminset1" });
  assert.throws(() => svc.consumePasswordResetToken({ tenantId, token, newPassword: "viaToken1" }), /Invalid or already-used/i);
});

// ═══════════════════════════════════════════════════════════════════════════
// (b) Self-serve change password / change email (re-auth required)
// ═══════════════════════════════════════════════════════════════════════════
test("change password: requires the correct current password", () => {
  const tenantId = "cp-reauth";
  makeTenant(tenantId);
  const owner = svc.createOwner({ tenantId, email: "o@cp.com", password: "rightpass1", name: "O" });
  // Wrong current password → rejected.
  assert.throws(() => svc.updatePassword({ tenantId, ownerId: owner.id, currentPassword: "wrongpass1", newPassword: "newpass456" }), /Current password is incorrect/i);
  // Correct current password → succeeds.
  svc.updatePassword({ tenantId, ownerId: owner.id, currentPassword: "rightpass1", newPassword: "newpass456" });
  assert.equal(svc.loginWithPassword({ tenantId, email: "o@cp.com", password: "newpass456" }).ok, true);
});

test("change password: rejects same-as-current password", () => {
  const tenantId = "cp-same";
  makeTenant(tenantId);
  const owner = svc.createOwner({ tenantId, email: "o@cs.com", password: "samepass1", name: "O" });
  assert.throws(() => svc.updatePassword({ tenantId, ownerId: owner.id, currentPassword: "samepass1", newPassword: "samepass1" }), /different from the current/i);
});

test("change email: requires the correct current password", () => {
  const tenantId = "ce-reauth";
  makeTenant(tenantId);
  const owner = svc.createOwner({ tenantId, email: "old@ce.com", password: "rightpass1", name: "O" });
  assert.throws(() => svc.updateEmail({ tenantId, ownerId: owner.id, currentPassword: "wrong", newEmail: "new@ce.com" }), /Current password is incorrect/i);
  svc.updateEmail({ tenantId, ownerId: owner.id, currentPassword: "rightpass1", newEmail: "new@ce.com" });
  // Login with the NEW email (old must fail).
  assert.equal(svc.loginWithPassword({ tenantId, email: "new@ce.com", password: "rightpass1" }).ok, true);
  assert.equal(svc.loginWithPassword({ tenantId, email: "old@ce.com", password: "rightpass1" }).ok, false);
});

test("change email: rejects an invalid email address", () => {
  const tenantId = "ce-invalid";
  makeTenant(tenantId);
  const owner = svc.createOwner({ tenantId, email: "o@ci.com", password: "pass1234", name: "O" });
  assert.throws(() => svc.updateEmail({ tenantId, ownerId: owner.id, currentPassword: "pass1234", newEmail: "not-an-email" }), /not a valid email/i);
});

test("change email: rejects a duplicate email (already used by a co-owner)", () => {
  const tenantId = "ce-dup";
  makeTenant(tenantId);
  const o1 = svc.createOwner({ tenantId, email: "one@cd.com", password: "pass1234", name: "One" });
  svc.createOwner({ tenantId, email: "two@cd.com", password: "pass1234", name: "Two" });
  assert.throws(() => svc.updateEmail({ tenantId, ownerId: o1.id, currentPassword: "pass1234", newEmail: "two@cd.com" }), /already uses that email/i);
});

test("change email: normalizes to lowercase", () => {
  const tenantId = "ce-norm";
  makeTenant(tenantId);
  const owner = svc.createOwner({ tenantId, email: "o@cn.com", password: "pass1234", name: "O" });
  svc.updateEmail({ tenantId, ownerId: owner.id, currentPassword: "pass1234", newEmail: "  Mixed@CN.COM  " });
  assert.equal(svc.loginWithPassword({ tenantId, email: "mixed@cn.com", password: "pass1234" }).ok, true);
});

// ═══════════════════════════════════════════════════════════════════════════
// (c) Team / co-owner management
// ═══════════════════════════════════════════════════════════════════════════
test("team: listOwners strips the password hash", () => {
  const tenantId = "tm-list";
  makeTenant(tenantId);
  svc.createOwner({ tenantId, email: "o@tl.com", password: "pass1234", name: "O" });
  const owners = svc.listOwners({ tenantId });
  assert.equal(owners.length, 1);
  assert.equal(owners[0].passwordHash, undefined, "listOwners must never expose the hash");
});

test("team: addOwner creates a login-able co-owner", () => {
  const tenantId = "tm-add";
  makeTenant(tenantId);
  svc.createOwner({ tenantId, email: "first@ta.com", password: "pass1234", name: "First" });
  svc.addOwner({ tenantId, email: "second@ta.com", password: "pass5678", name: "Second" });
  assert.equal(svc.listOwners({ tenantId }).length, 2);
  assert.equal(svc.loginWithPassword({ tenantId, email: "second@ta.com", password: "pass5678" }).ok, true);
});

test("team: addOwner rejects a duplicate email", () => {
  const tenantId = "tm-dup";
  makeTenant(tenantId);
  svc.createOwner({ tenantId, email: "dup@td.com", password: "pass1234", name: "D" });
  assert.throws(() => svc.addOwner({ tenantId, email: "dup@td.com", password: "pass5678", name: "D2" }), /already exists/i);
});

test("team: removeOwner deletes a co-owner", () => {
  const tenantId = "tm-remove";
  makeTenant(tenantId);
  svc.createOwner({ tenantId, email: "keep@tr.com", password: "pass1234", name: "Keep" });
  const second = svc.addOwner({ tenantId, email: "gone@tr.com", password: "pass5678", name: "Gone" });
  svc.removeOwner({ tenantId, ownerId: second.id });
  assert.equal(svc.listOwners({ tenantId }).length, 1);
  // The removed owner can no longer log in.
  assert.equal(svc.loginWithPassword({ tenantId, email: "gone@tr.com", password: "pass5678" }).ok, false);
});

test("team: removeOwner REFUSES to remove the last owner (lockout protection)", () => {
  const tenantId = "tm-last";
  makeTenant(tenantId);
  const only = svc.createOwner({ tenantId, email: "only@tl.com", password: "pass1234", name: "Only" });
  assert.throws(() => svc.removeOwner({ tenantId, ownerId: only.id }), /Cannot remove the last owner/i);
  // The owner is still there + can still log in.
  assert.equal(svc.listOwners({ tenantId }).length, 1);
  assert.equal(svc.loginWithPassword({ tenantId, email: "only@tl.com", password: "pass1234" }).ok, true);
});

// ═══════════════════════════════════════════════════════════════════════════
// (d) Admin owner management
// ═══════════════════════════════════════════════════════════════════════════
test("admin: adminUpdateEmail changes an owner's email without a password check", () => {
  const tenantId = "ad-email";
  makeTenant(tenantId);
  const owner = svc.createOwner({ tenantId, email: "old@ae.com", password: "pass1234", name: "O" });
  // Admin doesn't know the password — updates email directly.
  const r = svc.adminUpdateEmail({ tenantId, ownerId: owner.id, newEmail: "new@ae.com" });
  assert.equal(r.email, "new@ae.com");
  // Login works with the new email + the ORIGINAL password (admin didn't touch it).
  assert.equal(svc.loginWithPassword({ tenantId, email: "new@ae.com", password: "pass1234" }).ok, true);
});

test("admin: adminUpdateEmail rejects a duplicate email", () => {
  const tenantId = "ad-dup";
  makeTenant(tenantId);
  const o1 = svc.createOwner({ tenantId, email: "one@ad.com", password: "pass1234", name: "One" });
  svc.createOwner({ tenantId, email: "two@ad.com", password: "pass1234", name: "Two" });
  assert.throws(() => svc.adminUpdateEmail({ tenantId, ownerId: o1.id, newEmail: "two@ad.com" }), /already uses that email/i);
});

test("admin: admin removeOwner works (and still protects the last owner)", () => {
  const tenantId = "ad-remove";
  makeTenant(tenantId);
  const first = svc.createOwner({ tenantId, email: "first@ar.com", password: "pass1234", name: "First" });
  const second = svc.addOwner({ tenantId, email: "second@ar.com", password: "pass5678", name: "Second" });
  // Admin removes the second owner — succeeds.
  svc.removeOwner({ tenantId, ownerId: second.id });
  assert.equal(svc.listOwners({ tenantId }).length, 1);
  // Admin tries to remove the last owner — refused.
  assert.throws(() => svc.removeOwner({ tenantId, ownerId: first.id }), /Cannot remove the last owner/i);
});

test("admin: resetPassword lets the owner log in with the new password immediately", () => {
  const tenantId = "ad-reset";
  makeTenant(tenantId);
  svc.createOwner({ tenantId, email: "o@ar2.com", password: "oldpass123", name: "O" });
  svc.resetPassword({ tenantId, email: "o@ar2.com", newPassword: "adminset1" });
  assert.equal(svc.loginWithPassword({ tenantId, email: "o@ar2.com", password: "adminset1" }).ok, true);
  assert.equal(svc.loginWithPassword({ tenantId, email: "o@ar2.com", password: "oldpass123" }).ok, false);
});

// ═══════════════════════════════════════════════════════════════════════════
// (e) Security hardening — token hashing, role validation, JWT re-issue
// ═══════════════════════════════════════════════════════════════════════════
test("security: reset token is NOT stored in plaintext (owners.json holds only a hash)", () => {
  const tenantId = "sec-hash";
  makeTenant(tenantId);
  svc.createOwner({ tenantId, email: "o@sh.com", password: "pass1234", name: "O" });
  const { token } = svc.issuePasswordResetToken({ tenantId, email: "o@sh.com" });
  // Read owners.json directly — the raw token must NOT appear anywhere.
  const raw = fs.readFileSync(path.join(tenantsRoot, tenantId, "owners.json"), "utf8");
  assert.ok(!raw.includes(token), "the raw reset token must never be persisted in owners.json");
  assert.ok(raw.includes("resetTokenHash"), "a resetTokenHash field must be present instead");
});

test("security: a leaked owners.json does not grant reset capability (hash only)", () => {
  const tenantId = "sec-leak";
  makeTenant(tenantId);
  svc.createOwner({ tenantId, email: "o@sl.com", password: "pass1234", name: "O" });
  const { token } = svc.issuePasswordResetToken({ tenantId, email: "o@sl.com" });
  // Simulate an attacker who reads owners.json but does NOT have the raw token.
  // They only have the hash. The hash must NOT be usable as a reset token.
  const owners = JSON.parse(fs.readFileSync(path.join(tenantsRoot, tenantId, "owners.json"), "utf8"));
  const stolenHash = owners[0].resetTokenHash;
  assert.throws(() => svc.consumePasswordResetToken({ tenantId, token: stolenHash, newPassword: "hijacked1" }), /Invalid or already-used/i);
  // The real token still works (proving the hash is one-way).
  assert.equal(svc.consumePasswordResetToken({ tenantId, token, newPassword: "newpass456" }).ok, true);
});

test("security: createOwner rejects an arbitrary role (no superadmin escalation)", () => {
  const tenantId = "sec-role";
  makeTenant(tenantId);
  assert.throws(() => svc.createOwner({ tenantId, email: "o@sr.com", password: "pass1234", name: "O", role: "superadmin" }), /Invalid role/i);
  assert.throws(() => svc.createOwner({ tenantId, email: "o@sr2.com", password: "pass1234", name: "O", role: "" }), /Invalid role/i);
  // Allowed roles work.
  assert.ok(svc.createOwner({ tenantId, email: "o@sr3.com", password: "pass1234", name: "O", role: "admin" }).id);
});

test("security: addOwner rejects an arbitrary role", () => {
  const tenantId = "sec-role2";
  makeTenant(tenantId);
  svc.createOwner({ tenantId, email: "first@sr.com", password: "pass1234", name: "F" });
  assert.throws(() => svc.addOwner({ tenantId, email: "second@sr.com", password: "pass1234", name: "S", role: "superadmin" }), /Invalid role/i);
});

test("security: updatePassword re-issues a fresh JWT", () => {
  const tenantId = "sec-jwt-pw";
  makeTenant(tenantId);
  const owner = svc.createOwner({ tenantId, email: "o@jp.com", password: "oldpass12", name: "O" });
  const r = svc.updatePassword({ tenantId, ownerId: owner.id, currentPassword: "oldpass12", newPassword: "newpass34" });
  assert.ok(r.token, "updatePassword must return a fresh JWT");
  // The fresh token must be verifiable + carry the owner id.
  const payload = svc.verifyToken(`Bearer ${r.token}`);
  assert.equal(payload.sub, owner.id);
});

test("security: updateEmail re-issues a JWT carrying the NEW email", () => {
  const tenantId = "sec-jwt-email";
  makeTenant(tenantId);
  const owner = svc.createOwner({ tenantId, email: "old@je.com", password: "pass1234", name: "O" });
  const r = svc.updateEmail({ tenantId, ownerId: owner.id, currentPassword: "pass1234", newEmail: "new@je.com" });
  assert.ok(r.token, "updateEmail must return a fresh JWT");
  const payload = svc.verifyToken(`Bearer ${r.token}`);
  assert.equal(payload.email, "new@je.com", "the re-issued JWT must carry the new email");
});
