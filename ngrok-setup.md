# Ngrok Setup Guide for AR Indoor Navigation System

## Prerequisites
1. Install ngrok from https://ngrok.com/download
2. Sign up for a free ngrok account at https://dashboard.ngrok.com/signup
3. Get your authtoken from https://dashboard.ngrok.com/get-started/your-authtoken

## Setup Steps

### 1. Configure ngrok.yml
1. Open `ngrok.yml` in the project root
2. Replace `YOUR_NGROK_AUTH_TOKEN_HERE` with your actual ngrok authtoken
3. Update the port if your XAMPP Apache is not running on port 80:
   - Check your XAMPP Control Panel for the Apache port
   - Common ports: 80 (default), 8080, 8000
   - Update the `addr` value in the `web` tunnel section

### 2. Start XAMPP Services
1. Open XAMPP Control Panel
2. Start Apache
3. Start MySQL (if needed for database)

### 3. Run ngrok

#### Option A: From Command Prompt/PowerShell
```bash
cd C:\xampp\htdocs\nddusiena
ngrok start --all --config ngrok.yml
```

#### Option B: Using specific tunnel only
```bash
cd C:\xampp\htdocs\nddusiena
ngrok start web --config ngrok.yml
```

### 4. Access Your Application
- After starting ngrok, you'll see a forwarding URL like: `https://xxxx-xxxx-xxxx.ngrok-free.app`
- Open this URL in your browser to access your application
- The ngrok web interface is available at: `http://localhost:4040` (for monitoring requests)

## Important Notes

### Port Configuration
- **Default XAMPP Apache Port**: 80
- If you changed it, update `addr: 80` to your port number in `ngrok.yml`
- Common alternative ports: 8080, 8000

### File Location
- The `ngrok.yml` file should be in the project root: `C:\xampp\htdocs\nddusiena\ngrok.yml`
- You can also place it in your user directory: `C:\Users\YourUsername\.ngrok2\ngrok.yml` (for global config)

### Testing Mobile Devices
- Use the ngrok HTTPS URL on your mobile device
- Make sure your mobile device and computer are on the same network (or use ngrok's public URL)
- For AR features, HTTPS is required (ngrok provides this automatically)

### Troubleshooting
- **Port already in use**: Check if Apache is running on the specified port
- **Connection refused**: Make sure XAMPP Apache is started
- **403 Forbidden**: Check XAMPP Apache configuration and file permissions
- **HTTPS required**: ngrok automatically provides HTTPS, but ensure your app handles HTTPS URLs correctly

## Quick Commands

```bash
# Navigate to project
cd C:\xampp\htdocs\nddusiena

# Start ngrok with config
ngrok start --all --config ngrok.yml

# Start only web tunnel
ngrok start web --config ngrok.yml

# Check ngrok status
ngrok api tunnels list
```
