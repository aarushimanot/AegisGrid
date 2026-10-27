#!/usr/bin/env bash
# Build the React app against the deployed backend and publish it to S3 + CloudFront.
#
#   ./scripts/deploy-frontend.sh            # stack aegisgrid-dev
#   STACK=aegisgrid-prod ./scripts/deploy-frontend.sh
set -euo pipefail

STACK="${STACK:-aegisgrid-dev}"
AWS="${AWS_CLI:-aws}"
command -v "$AWS" >/dev/null 2>&1 || AWS="$HOME/.aegisgrid-tools/bin/aws"
REGION="${AWS_REGION:-$("$AWS" configure get region || echo us-east-1)}"
HERE="$(cd "$(dirname "$0")" && pwd)"
FRONTEND="$(cd "$HERE/../../frontend" && pwd)"

output() {
  "$AWS" cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

echo "Reading outputs of stack $STACK ($REGION)…"
API_URL="$(output ApiUrl)"
POOL_ID="$(output UserPoolId)"
CLIENT_ID="$(output UserPoolClientId)"
COGNITO_DOMAIN="$(output CognitoDomain)"
GOOGLE_SIGNIN="$(output GoogleSignInEnabled)"
BUCKET="$(output FrontendBucketName)"
DIST_ID="$(output FrontendDistributionId)"
SITE="$(output WebsiteUrl)"

# Google Maps settings are taken from the environment or from frontend/.env.local, if present.
env_value() { grep -E "^$1=" "$FRONTEND/.env.local" 2>/dev/null | tail -1 | cut -d= -f2-; }
GMAPS_KEY="${VITE_GOOGLE_MAPS_API_KEY:-$(env_value VITE_GOOGLE_MAPS_API_KEY)}"
GMAPS_ID="${VITE_GOOGLE_MAP_ID:-$(env_value VITE_GOOGLE_MAP_ID)}"

cat > "$FRONTEND/.env.production.local" <<ENV
VITE_API_URL=$API_URL
VITE_COGNITO_USER_POOL_ID=$POOL_ID
VITE_COGNITO_CLIENT_ID=$CLIENT_ID
VITE_COGNITO_DOMAIN=$COGNITO_DOMAIN
VITE_GOOGLE_SIGNIN=$GOOGLE_SIGNIN
VITE_GOOGLE_MAPS_API_KEY=$GMAPS_KEY
VITE_GOOGLE_MAP_ID=$GMAPS_ID
ENV

echo "Building frontend…"
(cd "$FRONTEND" && npm ci --silent && npm run build)

echo "Uploading to s3://$BUCKET …"
# Hashed assets can be cached forever; index.html must always be revalidated.
"$AWS" s3 sync "$FRONTEND/dist" "s3://$BUCKET" --region "$REGION" --delete \
  --exclude index.html --cache-control "public, max-age=31536000, immutable"
"$AWS" s3 cp "$FRONTEND/dist/index.html" "s3://$BUCKET/index.html" --region "$REGION" \
  --cache-control "no-cache" --content-type "text/html"

"$AWS" cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/index.html" "/" >/dev/null
echo "Done. AegisGrid is live at: $SITE"
