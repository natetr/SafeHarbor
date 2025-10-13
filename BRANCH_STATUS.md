# ⚠️ BRANCH STATUS: EXPERIMENTAL / NOT WORKING

## Current State
This branch contains experimental improvements to torrent download reliability that are **not yet stable** and should **not be used in production**.

## Known Issues
- Torrent downloads may hang at 99-100%
- Kiwix server crashes with MMapException on some files
- Completion detection is unreliable for large files (>1GB)

## What Was Attempted
- Complete rewrite of torrent completion detection
- Byte-based verification instead of event-based
- Improved HTTP fallback mechanism
- Better file flush handling

## Contributions Welcome
If you have experience with WebTorrent and want to help fix these issues, contributions are very welcome! The main problems are:
1. WebTorrent's 'done' event doesn't fire reliably for large files
2. Progress can show 100% while data is still being written
3. File system sync timing issues causing Kiwix crashes

Please open a PR or issue if you'd like to help improve this.

## Testing
The problematic files tested include:
- Urban Prepper ZIM (~2GB) - hangs at 99-100%
- TED Coronavirus ZIM (>1GB) - similar issues

These same files work fine in Transmission, indicating the issue is with our WebTorrent implementation.
