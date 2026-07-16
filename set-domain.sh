#!/bin/bash
# Run this ONCE, after you have bought your domain and the site is live on it.
#
#   ./set-domain.sh houseofalden.in
#
# It swaps your real web address into every place that needs the full https://…
# form rather than a relative path:
#   1. the "canonical" tag — tells Google this is the real address of the page, so it
#      doesn't treat copies (www vs non-www, vercel.app vs your domain) as duplicates
#      and split your search ranking between them.
#   2. the share picture — WhatsApp and Facebook will not load a picture written as
#      "images/og-card.jpg"; they need the full address. Until you run this, links you
#      share show your text but no picture.
#   3. sitemap.xml and robots.txt — the map you hand to Google.
#   4. the JSON-LD blocks — the machine-readable shop/product data Google reads to
#      show your prices in search results.
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

# Every address currently baked into the site. Anything matching this gets swapped.
OLD='https://[a-z0-9.-]*\.vercel\.app'

for f in *.html; do
  page="$f"
  [ "$f" = "index.html" ] && page=""
  # 404.html is served for unknown paths and has no canonical address of its own.
  if [ "$f" != "404.html" ]; then
    if grep -q 'rel="canonical"' "$f"; then
      sed -i '' -E "s#<link rel=\"canonical\"[^>]*>#<link rel=\"canonical\" href=\"${BASE}/${page}\">#" "$f"
    else
      sed -i '' -E "s#(</title>)#\1\n<link rel=\"canonical\" href=\"${BASE}/${page}\">#" "$f"
    fi
  fi

  sed -i '' -E "s#(og:image\" content=\")[^\"]*(\")#\1${BASE}/images/og-card.jpg\2#" "$f"
  # JSON-LD and anything else still pointing at the old address.
  sed -i '' -E "s#${OLD}#${BASE}#g" "$f"

  echo "  ${f}"
done

# The map handed to search engines, and the JS that builds product data.
for f in sitemap.xml robots.txt js/product.js js/home.js; do
  [ -f "$f" ] || continue
  sed -i '' -E "s#${OLD}#${BASE}#g" "$f"
  echo "  ${f}"
done

echo
echo "Done. Now push it live:"
echo "    git add -A && git commit -m 'Point the site at ${DOMAIN}' && git push"
echo
echo "Then check the share preview at https://developers.facebook.com/tools/debug/"
echo "(paste ${BASE}) and submit ${BASE}/sitemap.xml in Google Search Console."
