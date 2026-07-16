#!/bin/bash
# Run this ONCE, after you have bought your domain and the site is live on it.
#
#   ./set-domain.sh houseofalden.in
#
# It does two things to all eight pages:
#   1. adds the "canonical" tag  — tells Google this is the real address of the page,
#      so it doesn't treat copies (www vs non-www, netlify.app vs your domain) as
#      duplicates and split your search ranking between them.
#   2. makes the share picture address absolute — WhatsApp and Facebook will not load
#      a picture written as "images/og-card.jpg"; they need the full https:// address.
#      Until you run this, links you share show your text but no picture.
#
# Safe to run more than once. Run it again if you ever change domain.

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: ./set-domain.sh yourdomain.com"
  echo "   eg: ./set-domain.sh houseofalden.in"
  exit 1
fi

# Accept houseofalden.in, www.houseofalden.in, or https://houseofalden.in/ alike.
DOMAIN=$(echo "$1" | sed -E 's#^https?://##; s#/+$##')
BASE="https://${DOMAIN}"

cd "$(dirname "$0")"

for f in *.html; do
  page="$f"
  [ "$f" = "index.html" ] && page=""

  # 1. canonical — replace an existing one, or add it after the <title>.
  if grep -q 'rel="canonical"' "$f"; then
    sed -i '' -E "s#<link rel=\"canonical\"[^>]*>#<link rel=\"canonical\" href=\"${BASE}/${page}\">#" "$f"
  else
    sed -i '' -E "s#(</title>)#\1\n<link rel=\"canonical\" href=\"${BASE}/${page}\">#" "$f"
  fi

  # 2. share picture -> absolute
  sed -i '' -E "s#(og:image\" content=\")[^\"]*(\")#\1${BASE}/images/og-card.jpg\2#" "$f"

  echo "  ${f}  ->  ${BASE}/${page}"
done

echo
echo "Done. Upload the folder again so the changes go live."
echo "Check the result at: https://developers.facebook.com/tools/debug/  (paste ${BASE})"
