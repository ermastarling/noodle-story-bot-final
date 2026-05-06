# Testing and Release Implementation Plan

## Objective

Create a safe staging version of the bot in a separate testing server, then promote verified changes to production with predictable quality gates.

## Success Criteria

- Staging and production run with separate Discord app credentials.
- Staging and production use separate databases.
- All feature changes are validated in staging before production merge.
- Production releases require passing CI and approval.
- Rollback can be done in under 10 minutes.

## Scope

In scope:
- Branch strategy and merge policy
- Environment isolation
- Command registration safety
- CI and deployment gates
- Smoke testing and rollback procedure

Out of scope:
- New gameplay features
- Economy tuning unrelated to release safety

## Workstreams

### 1) Git and PR Workflow

Tasks:
- Create long-lived develop branch.
- Require feature branches to target develop.
- Require release PRs from develop to main.
- Enable branch protection on develop and main.

Definition of done:
- develop exists and is used for all integration.
- Direct pushes to main are blocked.
- Required checks are enforced on both branches.

### 2) Environment Isolation

Tasks:
- Provision second Discord application for staging.
- Add staging secrets in GitHub Environments.
- Add production secrets in GitHub Environments.
- Make DB path configurable using environment variable.

Definition of done:
- Staging bot can run independently in test guild.
- Production bot cannot read or write staging data.
- No shared secrets between environments.

### 3) Command Registration Safety

Tasks:
- Keep staging registrations guild-scoped.
- Keep production registration mode explicit.
- Add deploy checklist step for registration verification.

Definition of done:
- Staging command updates appear quickly in test guild.
- Production registration is intentional and auditable.

### 4) CI and Deployment Automation

Tasks:
- Keep existing test workflow as required status check.
- Add workflow for staging deploy on develop merge.
- Add workflow for production deploy on main merge or manual approval.
- Require manual approval for production environment.

Definition of done:
- Every merge to develop triggers staging deployment path.
- Production deploy cannot start without approval.
- Failed tests block both staging and production promotion.

### 5) Verification and Rollback

Tasks:
- Define smoke test checklist for staging.
- Define production post-deploy checks.
- Define rollback runbook with exact steps.

Definition of done:
- Smoke test results are attached to release PR.
- Rollback steps are tested once and documented.

## Implementation Sequence

### Phase 0: Setup (Day 1)

1. Create develop branch.
2. Configure branch protections.
3. Create staging Discord app and invite to test server.
4. Add GitHub Environments:
   - staging
   - production

Deliverable:
- Promotion path exists from feature to develop to main.

### Phase 1: Isolation (Day 1-2)

1. Update DB opening logic to allow environment-specific DB file path.
2. Add env templates for staging and production variable names.
3. Confirm command registration uses staging guild in staging workflow.

Deliverable:
- Full separation of credentials and persistent data.

### Phase 2: Automation (Day 2)

1. Add staging deploy workflow wired to develop.
2. Add production deploy workflow wired to main with environment approval.
3. Enforce CI checks as required.

Deliverable:
- Hands-off staging deployments and controlled production deployments.

### Phase 3: Validation (Day 3)

1. Run first full feature cycle through develop.
2. Execute staging smoke tests.
3. Create release PR from develop to main.
4. Execute production deploy and post-deploy checks.

Deliverable:
- First end-to-end release completed via new process.

## Action Backlog (Ready to Create as Issues)

1. Create develop branch and protections
2. Add staging and production GitHub Environments
3. Add configurable DB path in src/db/index.js
4. Add env templates for staging and production
5. Add deploy-staging workflow
6. Add deploy-production workflow
7. Add smoke-test checklist document
8. Add rollback runbook document
9. Make CI required on develop and main
10. Run pilot release and capture retro

## Efficient Operating Model

Use this pull model for all work:

1. Feature branch from develop
2. PR to develop with tests passing
3. Auto deploy to staging
4. Smoke test and attach evidence to release PR
5. PR from develop to main
6. Approval and production deploy

This minimizes rework by finding integration problems before production and batching release verification in one place.

## KPIs to Track Weekly

- Lead time from merge to staging deployment
- Lead time from release PR open to production deploy
- Change failure rate after production deploy
- Rollback count
- Mean time to restore if incident occurs

## Ownership

- Release owner: approves release PR and production deploy.
- Engineering owner: maintains workflows and branch protections.
- QA owner: executes smoke tests and signs off.

If one person holds multiple roles, keep the sign-off checkpoints separate in the PR template.

## Immediate Next 3 Actions

1. Implement configurable DB path in src/db/index.js.
2. Add staging and production deployment workflows in .github/workflows.
3. Add smoke-test and rollback checklists and link them in README.
