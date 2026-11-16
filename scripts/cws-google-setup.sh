#!/usr/bin/env bash
# One-time Google setup so the release workflow can upload to the Chrome Web Store without
# any stored key: GitHub vouches for the workflow run, Google swaps that for a 15-minute
# token of a service account (Workload Identity Federation, the way google-github-actions/auth
# recommends), and only this repo's release workflow, from main or a version tag, is let in.
#
# Run it in Google Cloud Shell (https://shell.cloud.google.com, gcloud is ready there):
#   bash <(curl -fsSL https://raw.githubusercontent.com/gywreb/gytakusub/main/scripts/cws-google-setup.sh) YOUR_PROJECT_ID
# Running it again is safe: what exists is kept (the provider's rule is refreshed).
set -euo pipefail

PROJECT="${1:?usage: cws-google-setup.sh <google-cloud-project-id>}"
REPO="${REPO:-gywreb/gytakusub}"
SA_NAME="gytakusub-release" POOL="github" PROVIDER="gytakusub"
SA="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
trap 'echo; echo "Stopped at the step above. If Google asked for a billing account, you can stop here and use the refresh-token fallback in store/RELEASE-CHECKLIST.md instead; otherwise paste the message to Claude."' ERR

gcloud config set project "$PROJECT" >/dev/null

echo "1/5 Turning on the APIs: Chrome Web Store, IAM, token exchange…"
gcloud services enable chromewebstore.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com cloudresourcemanager.googleapis.com

echo "2/5 Service account $SA…"
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "$SA_NAME" --display-name="Gytakusub release (Chrome Web Store upload)"

echo "3/5 Identity pool for GitHub Actions…"
gcloud iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1 \
  || gcloud iam workload-identity-pools create "$POOL" --location=global --display-name="GitHub Actions"

echo "4/5 Who may sign in: $REPO's release workflow, from main or a version tag…"
MAPPING="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.workflow_ref=assertion.workflow_ref"
CONDITION="assertion.repository == '$REPO' && assertion.workflow_ref.startsWith('$REPO/.github/workflows/release.yml@') && (assertion.ref == 'refs/heads/main' || assertion.ref.startsWith('refs/tags/v'))"
if gcloud iam workload-identity-pools providers describe "$PROVIDER" --location=global --workload-identity-pool="$POOL" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers update-oidc "$PROVIDER" --location=global --workload-identity-pool="$POOL" \
    --attribute-mapping="$MAPPING" --attribute-condition="$CONDITION"
else
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --location=global --workload-identity-pool="$POOL" \
    --display-name="gytakusub releases" --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="$MAPPING" --attribute-condition="$CONDITION"
fi

echo "5/5 Letting that workflow act as the service account…"
POOL_NAME=$(gcloud iam workload-identity-pools describe "$POOL" --location=global --format='value(name)')
gcloud iam service-accounts add-iam-policy-binding "$SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/$POOL_NAME/attribute.repository/$REPO" >/dev/null
PROVIDER_NAME=$(gcloud iam workload-identity-pools providers describe "$PROVIDER" --location=global --workload-identity-pool="$POOL" --format='value(name)')

cat <<EOF

Done. Two more things, then releases upload to the store by themselves:

 a) Chrome Web Store Developer Dashboard → Account → service account: add
      $SA

 b) GitHub → $REPO → Settings → Secrets and variables → Actions → Variables tab →
    New repository variable, three times (variables, not secrets: none of these is secret):
      GCP_WORKLOAD_IDENTITY_PROVIDER = $PROVIDER_NAME
      GCP_SERVICE_ACCOUNT            = $SA
      CWS_PUBLISHER_ID               = (Developer Dashboard → Publisher → Settings)
EOF
