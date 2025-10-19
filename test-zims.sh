#!/bin/bash
# Test ZIM files individually to find the corrupted one

KIWIX="/Users/nate/Documents/SafeHarbor/bin/kiwix-serve"
PORT=9999

# Array of ZIM files
ZIMS=(
  "/Users/nate/Documents/SafeHarbor/zim/pets.stackexchange.com_en_all_2025-08.zim"
  "/Users/nate/Documents/SafeHarbor/zim/fas-military-medicine_en_2025-06.zim"
  "/Users/nate/Documents/SafeHarbor/zim/zimgit-post-disaster_en_2024-05.zim"
  "/Users/nate/Documents/SafeHarbor/zim/www.ready.gov_en_2024-12.zim"
  "/Users/nate/Documents/SafeHarbor/zim/openstreetmap-wiki_en_all_maxi_2025-07.zim"
  "/Users/nate/Documents/SafeHarbor/zim/restarters_en_all_maxi_2025-07.zim"
  "/Users/nate/Documents/SafeHarbor/zim/php.net_en_all_2024-08.zim"
  "/Users/nate/Documents/SafeHarbor/zim/devdocs_en_node_2025-10.zim"
  "/Users/nate/Documents/SafeHarbor/zim/prunelle_en_budding-authors_2025-02.zim"
  "/Users/nate/Documents/SafeHarbor/zim/wikipedia_en_climate-change_mini_2025-10.zim"
  "/Users/nate/Documents/SafeHarbor/zim/phet_sh_all_2025-03.zim"
  "/Users/nate/Documents/SafeHarbor/zim/bitcoin_en_all_maxi_2021-03.zim"
)

echo "Testing ZIM files individually..."
echo "=================================="

for zim in "${ZIMS[@]}"; do
  echo ""
  echo "Testing: $(basename "$zim")"

  # Start kiwix-serve with this ZIM in background
  "$KIWIX" --port $PORT "$zim" > /tmp/kiwix-test.log 2>&1 &
  KIWIX_PID=$!

  # Wait 2 seconds to see if it crashes
  sleep 2

  # Check if process is still running
  if kill -0 $KIWIX_PID 2>/dev/null; then
    echo "  ✓ SUCCESS - ZIM loaded successfully"
    kill $KIWIX_PID 2>/dev/null
    wait $KIWIX_PID 2>/dev/null
  else
    echo "  ✗ FAILED - ZIM caused crash!"
    echo "  This is the corrupted ZIM file."
    cat /tmp/kiwix-test.log
    exit 1
  fi
done

echo ""
echo "All ZIM files passed individual tests!"
