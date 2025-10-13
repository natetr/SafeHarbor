# SafeHarbor Automatic Startup

This guide explains how to configure SafeHarbor to start automatically when your Raspberry Pi boots up.

## Quick Install

The easiest way to enable automatic startup is to use the installation script:

```bash
./scripts/install-service.sh
```

This script will:
1. Detect your username and installation directory
2. Configure the systemd service file
3. Install and enable the service
4. Optionally start the service immediately

## Manual Installation

If you prefer to install manually, follow these steps:

### 1. Edit the Service File

Open `safeharbor.service` and update these lines:

```ini
User=pi              # Change to your username
Group=pi             # Change to your group
WorkingDirectory=/home/pi/SafeHarbor  # Change to your installation path
```

Also update this line in the security settings:

```ini
ReadWritePaths=/home/pi/SafeHarbor  # Change to your installation path
```

### 2. Install the Service

```bash
# Copy service file to systemd
sudo cp safeharbor.service /etc/systemd/system/

# Reload systemd to recognize the new service
sudo systemctl daemon-reload

# Enable the service to start on boot
sudo systemctl enable safeharbor

# Start the service now (optional)
sudo systemctl start safeharbor
```

### 3. Verify Installation

```bash
# Check if service is running
sudo systemctl status safeharbor

# View logs
sudo journalctl -u safeharbor -f
```

## Managing the Service

### Start/Stop/Restart

```bash
# Start SafeHarbor
sudo systemctl start safeharbor

# Stop SafeHarbor
sudo systemctl stop safeharbor

# Restart SafeHarbor
sudo systemctl restart safeharbor

# Check status
sudo systemctl status safeharbor
```

### Enable/Disable Autostart

```bash
# Enable autostart (starts on boot)
sudo systemctl enable safeharbor

# Disable autostart (won't start on boot)
sudo systemctl disable safeharbor
```

### View Logs

```bash
# View logs in real-time
sudo journalctl -u safeharbor -f

# View last 100 log lines
sudo journalctl -u safeharbor -n 100

# View logs since boot
sudo journalctl -u safeharbor -b

# View logs with priority (errors only)
sudo journalctl -u safeharbor -p err
```

## Service Features

The SafeHarbor systemd service includes several features:

### Automatic Restart

The service will automatically restart if it crashes:
- Maximum 5 restart attempts within 10 minutes
- 10-second delay between restart attempts
- If restart limit is reached, manual intervention is required

### Resource Limits

- Maximum 65,536 open files
- Maximum 512 tasks (prevents fork bombs)
- Optional memory limits (commented out by default)

### Security Hardening

- Runs as non-privileged user
- Cannot gain new privileges
- Private `/tmp` directory
- Read-only access to system directories
- Limited write access to SafeHarbor directory only

### Graceful Shutdown

When stopping the service:
- Sends SIGTERM to allow cleanup
- Waits up to 30 seconds for graceful shutdown
- Sends SIGKILL if still running after timeout

## Troubleshooting

### Service Won't Start

1. Check the status:
   ```bash
   sudo systemctl status safeharbor
   ```

2. View detailed logs:
   ```bash
   sudo journalctl -u safeharbor -n 50 --no-pager
   ```

3. Common issues:
   - **Wrong paths**: Verify `WorkingDirectory` and `ExecStart` paths
   - **Wrong user**: Ensure the `User` exists and has permissions
   - **Node.js not found**: Check Node.js path with `which node`
   - **Port in use**: Another process may be using port 3000

### Check Configuration

View the installed service file:
```bash
cat /etc/systemd/system/safeharbor.service
```

### Manually Test

Try running SafeHarbor manually to identify issues:
```bash
cd /home/pi/SafeHarbor
node server/index.js
```

### Permission Issues

If you see permission errors:
```bash
# Ensure user owns the directory
sudo chown -R pi:pi /home/pi/SafeHarbor

# Check database permissions
ls -la safeharbor.db
```

### Service Keeps Restarting

If the service keeps restarting (restart loop):
1. View logs to identify the issue
2. Fix the underlying problem
3. Reset the failure counter:
   ```bash
   sudo systemctl reset-failed safeharbor
   sudo systemctl start safeharbor
   ```

## Uninstalling

To remove the automatic startup:

```bash
# Stop the service
sudo systemctl stop safeharbor

# Disable autostart
sudo systemctl disable safeharbor

# Remove service file
sudo rm /etc/systemd/system/safeharbor.service

# Reload systemd
sudo systemctl daemon-reload
```

## Advanced Configuration

### Change Port

To run SafeHarbor on a different port, add an environment variable to the service file:

```ini
[Service]
Environment=NODE_ENV=production
Environment=PORT=8080
```

Then reload and restart:
```bash
sudo systemctl daemon-reload
sudo systemctl restart safeharbor
```

### Memory Limits

To limit memory usage (useful for Raspberry Pi), uncomment these lines in the service file:

```ini
MemoryMax=1G      # Hard limit - process killed if exceeded
MemoryHigh=800M   # Soft limit - process slowed if exceeded
```

### Custom Environment Variables

Add any environment variables your app needs:

```ini
[Service]
Environment=NODE_ENV=production
Environment=DATABASE_PATH=/var/safeharbor/safeharbor.db
Environment=ZIM_DIRECTORY=/media/external/zims
```

## Best Practices

1. **Test First**: Always test changes by running manually before enabling the service
2. **Monitor Logs**: Regularly check logs for errors or issues
3. **Backup Database**: Before making changes, backup your database
4. **Update Carefully**: When updating SafeHarbor, test the service after updating
5. **Resource Monitoring**: Monitor CPU and memory usage on your Raspberry Pi

## Additional Resources

- [systemd documentation](https://www.freedesktop.org/software/systemd/man/systemd.service.html)
- [Raspberry Pi documentation](https://www.raspberrypi.org/documentation/)
- [SafeHarbor GitHub](https://github.com/natetr/SafeHarbor)
