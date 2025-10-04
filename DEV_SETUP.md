# SafeHarbor - Local Development Setup

Test SafeHarbor on your Mac/PC before deploying to Raspberry Pi.

## Quick Start (5 minutes)

### 1. Prerequisites

Install Node.js if you don't have it:
- **Mac**: `brew install node` or download from https://nodejs.org
- **Windows**: Download from https://nodejs.org
- **Linux**: `sudo apt install nodejs npm`

Verify installation:
```bash
node --version  # Should be v16 or higher
npm --version
```

### 2. Extract Frontend Components

The React components are bundled in `FRONTEND_COMPONENTS.md` and need to be extracted:

```bash
cd /Users/nate/Documents/SafeHarbor

# Create directory structure
mkdir -p client/src/layouts
mkdir -p client/src/pages/guest
mkdir -p client/src/pages/admin
```

Now copy the components from `FRONTEND_COMPONENTS.md` to their respective files. I'll create a helper script:

### 3. Install Dependencies

```bash
# Install backend dependencies
npm install

# Install frontend dependencies
cd client
npm install
cd ..
```

### 4. Set Up Environment

```bash
# Copy environment template
cp .env.example .env

# The defaults are fine for local testing
# Database will be created in project root
```

### 5. Start Development Servers

**Option A: Both servers with one command**
```bash
npm run dev
```

**Option B: Separate terminals**

Terminal 1 (Backend):
```bash
npm run server:dev
# Runs on http://localhost:3000
```

Terminal 2 (Frontend):
```bash
cd client
npm run dev
# Runs on http://localhost:5173
```

### 6. Access SafeHarbor

Open your browser to:
```
http://localhost:5173
```

Default login:
- Username: `admin`
- Password: `admin`

## What Works in Local Development

✅ **Fully Functional:**
- Authentication (login/logout)
- File upload and management
- Content organization (collections)
- Search functionality
- Media playback (videos, audio, PDFs)
- System monitoring (stats will be for your local machine)
- Admin dashboard
- Guest interface

⚠️ **Limited Functionality:**
- **Network configuration**: Won't actually configure Wi-Fi (requires Linux/Pi)
- **ZIM downloads**: Will work if you have internet
- **Kiwix serving**: Requires `kiwix-serve` to be installed locally
- **External storage**: Will work but uses your local drives

❌ **Not Available:**
- Hotspot mode (requires Raspberry Pi wireless hardware)
- Network mode switching (requires Linux networking tools)
- Raspberry Pi specific features (GPIO, temperature sensors)

## Development Features

### Hot Reload

Both servers support hot reload:
- **Backend**: Changes to server files restart the server automatically (nodemon)
- **Frontend**: Changes to React files update instantly in browser (Vite HMR)

### API Proxy

The frontend dev server (Vite) proxies API requests to the backend:
- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3000`
- Requests to `/api/*` are automatically proxied

### Database

SQLite database is created at `./safeharbor.db` in the project root. You can:
- Inspect it with `sqlite3 safeharbor.db`
- Delete it to reset: `rm safeharbor.db` (will recreate on restart)

## Testing Workflows

### Test Content Upload

1. Start both servers (`npm run dev`)
2. Login as admin
3. Go to Admin → Content
4. Click "Upload Files"
5. Select a local video/PDF/image
6. Upload and verify it appears
7. Click to view/play in player

### Test Search

1. Upload several files with different names
2. Go to Search page
3. Search for keywords in filenames
4. Verify results appear
5. Click results to view content

### Test Collections

1. Admin → Content → Collections
2. Create new collection "Testing"
3. Upload files and assign to "Testing"
4. View in Guest interface
5. Filter by collection

### Test Guest vs Admin

1. Open main window logged in as admin
2. Open incognito window as guest
3. Upload content and mark as "hidden" in admin
4. Verify hidden content doesn't show in guest view
5. Unhide and verify it appears

## Development Tips

### Use Sample Content

Create test files:
```bash
# Create sample files for testing
mkdir test-content
echo "Test PDF content" > test-content/sample.txt
# Then manually create or download some small test files
```

### Reset Database

```bash
# Stop servers (Ctrl+C)
rm safeharbor.db
# Restart servers - fresh database with admin user
npm run dev
```

### Check Logs

Backend logs appear in the terminal where you ran `npm run server:dev`

### Debug Frontend

Open browser DevTools:
- **Console**: See errors and logs
- **Network**: See API requests/responses
- **Application → Local Storage**: See JWT token

### Check API Directly

Test API endpoints with curl:
```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'

# Get content (as guest)
curl http://localhost:3000/api/content

# Search
curl "http://localhost:3000/api/search?q=test"
```

## Installing Kiwix (Optional)

To test ZIM functionality locally:

**Mac (Homebrew):**
```bash
brew install kiwix-tools
```

**Linux:**
```bash
sudo apt install kiwix-tools
```

**Windows:**
Download from https://www.kiwix.org/en/downloads/kiwix-tools/

Then download a small ZIM file for testing:
```bash
mkdir zim
cd zim
# Download simple Wikipedia (small, ~200MB)
wget https://download.kiwix.org/zim/wikipedia/wikipedia_en_simple_all_nopic_2024-01.zim
```

Start Kiwix manually:
```bash
kiwix-serve --port 8080 zim/*.zim
```

## Troubleshooting

### Port Already in Use

If port 3000 is taken:
```bash
# Edit .env
PORT=3001

# Or find what's using it
lsof -i :3000
```

### Cannot Find Module

```bash
# Reinstall dependencies
rm -rf node_modules client/node_modules
npm install
cd client && npm install
```

### Database Locked

```bash
# Only one process can write to SQLite
# Make sure you don't have multiple servers running
killall node
npm run dev
```

### CORS Errors

If you see CORS errors:
- Make sure you're accessing via `localhost:5173` (not `localhost:3000`)
- Check `vite.config.js` has proxy configured
- Restart both servers

### File Upload Fails

```bash
# Check upload directory exists and is writable
mkdir -p content
chmod 755 content
```

## Building for Production (Local Test)

Test the production build locally:

```bash
# Build frontend
cd client
npm run build
cd ..

# Run in production mode
NODE_ENV=production npm start
```

Access at `http://localhost:3000` (frontend is served by backend)

## Performance Testing

Test with multiple browser windows:
- Open 3-5 browser tabs
- Login in one, stay as guest in others
- Upload and play different videos simultaneously
- Monitor your computer's Activity Monitor/Task Manager

Expected local performance:
- Should handle 5-10 concurrent streams easily
- CPU usage will vary by file type (video encoding)
- Memory usage ~200-500MB

## Differences from Raspberry Pi

| Feature | Local Dev | Raspberry Pi |
|---------|-----------|--------------|
| Web Interface | ✅ Full | ✅ Full |
| File Upload | ✅ Works | ✅ Works |
| Media Playback | ✅ Works | ✅ Works |
| Search | ✅ Works | ✅ Works |
| Collections | ✅ Works | ✅ Works |
| ZIM Libraries | ⚠️ Needs kiwix-serve | ✅ Auto-installed |
| Network Config UI | ✅ Shows UI | ✅ Actually changes network |
| Hotspot Mode | ❌ Mock only | ✅ Creates real AP |
| System Stats | ✅ Shows Mac/PC stats | ✅ Shows Pi stats |
| External Storage | ✅ Uses local drives | ✅ USB/SSD |

## Next Steps After Local Testing

Once you've tested locally and everything works:

1. ✅ Verify all features you need work
2. ✅ Test with your actual content files
3. ✅ Confirm UI is acceptable
4. 🚀 Deploy to Raspberry Pi using `install.sh`
5. 🔧 Configure network mode on Pi
6. 📚 Load production content

## Quick Reference

**Start development:**
```bash
npm run dev
```

**Access:**
- Frontend: http://localhost:5173
- Backend API: http://localhost:3000
- Login: admin / admin

**Reset:**
```bash
rm safeharbor.db content/* uploads/*
```

**Stop servers:**
```
Ctrl+C in terminal
```

---

**Happy local testing!** 🧪

Once everything works locally, you can confidently deploy to your Raspberry Pi knowing it will work the same way (plus actual network features).
