<p align="center">
  <img src="docs/logo/logo.png" alt="Business Advisor CRM Logo" width="200"/>
</p>

<h1 align="center">Business Advisor CRM</h1>

A WhatsApp CRM for teams: connect a WhatsApp number, chat with customers and groups from a web dashboard,
broadcast one message to many groups, tag chats by status, and stamp each reply with the team member's name.

This guide has two parts:

1. [Develop locally](#part-1-develop-locally) on your own computer
2. [Deploy on a VPS](#part-2-deploy-on-a-vps) so the team can use it online

---

## Part 1: Develop locally

### What you need

- **Node.js 22.19 or newer** (check with `node --version`) and **npm**
- **Git**
- macOS, or Linux with glibc 2.34+ (Ubuntu 22.04+, Debian 12+). On Windows, use WSL2.

### Step 1: Get the code

```bash
git clone https://github.com/mracid-devs/OpenWA.git business-advisor-crm
cd business-advisor-crm
```

### Step 2: Install dependencies

```bash
npm install
npm run dashboard:install
```

### Step 3: Create the configuration file

```bash
cp .env.minimal .env
```

Open `.env` and check these two lines (they are already set this way in `.env.minimal`):

```env
PORT=3000
ENGINE_TYPE=baileys
```

`ENGINE_TYPE=baileys` connects to WhatsApp directly, without a browser, and is the engine to use.

### Step 4: Start the app

```bash
npm run dev
```

This starts the API and the dashboard together. Wait until the terminal shows
`Business Advisor CRM is running on: http://localhost:3000`.

| What                      | Address                        |
| ------------------------- | ------------------------------ |
| **Dashboard (open this)** | http://localhost:3001          |
| API                       | http://localhost:3000/api      |
| API docs (Swagger)        | http://localhost:3000/api/docs |

Open **http://localhost:3001** in your browser. Opening port 3000 alone shows `Cannot GET /`, because in
development the dashboard is served on port 3001.

### Step 5: Sign in

On the first start the app creates an admin API key and saves it in `data/.api-key`:

```bash
cat data/.api-key
```

Copy only the key (it starts with `owa_k1_`; the file has no trailing newline) and paste it into the
dashboard's sign-in page.

### Step 6: Connect WhatsApp

1. Open **Sessions** and create a session.
2. Start it. A QR code appears.
3. On the phone, open WhatsApp → **Linked devices** → **Link a device**, and scan the QR code.
4. Open **Settings** and enter your name. It is added at the start of every reply you send, for example `*Viraj:* Hello`.

### Everyday use

| Task                               | How                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| Chat with customers and groups     | **Chats**                                                                                  |
| Tag a chat (Pending, Completed...) | Open the chat's ⌄ menu in **Chats** and pick a tag. Rename or recolor tags in **Settings** |
| Send one message to many groups    | **Broadcast**: pick groups, type the message, choose a delay, send                         |
| Create keys for your team          | **API Keys**                                                                               |
| Stop the app                       | Press `Ctrl+C` in the terminal running `npm run dev`                                       |

### If something goes wrong

- **`address already in use` on port 3000 or 3001:** another copy is still running. Stop it, or change
  `PORT` in `.env` (and the ports in `dashboard/vite.config.ts`).
- **"Invalid API key":** copy the key again from `data/.api-key` with no spaces, and sign out of the dashboard first.
- **A session will not start or no QR code appears:** make sure `ENGINE_TYPE=baileys` is in `.env`, then restart `npm run dev`.
- **Reset everything:** stop the app and delete the `data/` folder. This removes all sessions and the API key.

---

## Part 2: Deploy on a VPS

This walks you from a blank Ubuntu server to Business Advisor CRM running on your own domain over HTTPS.
It uses Docker Compose and Caddy (a web server that gets a free HTTPS certificate for you).

**What you need**

- A VPS running **Ubuntu 22.04 or newer**, with at least **2 GB RAM** and 20 GB disk (4 GB is more comfortable).
- A **domain or subdomain** (for example `crm.yourcompany.com`) with an **A record** pointing to the VPS IP address.
- This code pushed to your own Git repository (Step 1).

### Step 1: Push your code to Git (on your own computer)

The VPS downloads the code from your repository, so commit and push everything first:

```bash
git add -A
git commit -m "Business Advisor CRM"
git push origin main
```

If the repository is private, create a GitHub personal access token (Settings → Developer settings → Tokens, with read access to the repository). You will use it as the password in Step 5.

### Step 2: Log in to the VPS and secure it

```bash
ssh root@YOUR_VPS_IP

# Update the system
apt update && apt upgrade -y

# Create a normal user to run the app (replace "deploy" with any name)
adduser deploy
usermod -aG sudo deploy

# Firewall: allow only SSH, HTTP and HTTPS
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

Log out, then log back in as the new user: `ssh deploy@YOUR_VPS_IP`.

> Do **not** open port `2785`. Compose publishes it on `127.0.0.1` only, and Caddy (Step 7) is the public entrance.

### Step 3: Add swap (only if the VPS has 2 GB RAM or less)

Building the image needs memory. Without swap the build can be killed.

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### Step 4: Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Log out and back in so the `docker` group applies, then check it works:

```bash
docker --version
docker compose version
```

### Step 5: Download the code

```bash
git clone https://github.com/YOUR_GITHUB_USER/YOUR_REPO.git business-advisor-crm
cd business-advisor-crm
```

For a private repository, Git asks for a username and password: use your GitHub username and the token from Step 1 as the password.

### Step 6: Configure the environment

Create a `.env` file next to `docker-compose.yml`:

```bash
nano .env
```

Paste this, replacing the domain with yours:

```env
# Use the Baileys engine: it connects straight to WhatsApp with no browser,
# so it is lighter and is not affected by WhatsApp Web changes.
ENGINE_TYPE=baileys

# Your public address. Browsers are only allowed to call the API from here.
BASE_URL=https://crm.yourcompany.com
DASHBOARD_URL=https://crm.yourcompany.com
CORS_ORIGINS=https://crm.yourcompany.com

# Keep time stamps in your timezone (optional)
TZ=Asia/Colombo
```

Save with `Ctrl+O`, `Enter`, then exit with `Ctrl+X`.

### Step 7: Start the application

```bash
docker compose up -d --build
```

The first build takes several minutes. Check that it is healthy:

```bash
docker compose ps
docker compose logs -f openwa-api     # press Ctrl+C to stop watching
curl http://127.0.0.1:2785/api/health/ready
```

### Step 8: Put HTTPS in front with Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Open the Caddy config and replace everything in it:

```bash
sudo nano /etc/caddy/Caddyfile
```

```caddyfile
crm.yourcompany.com {
    reverse_proxy 127.0.0.1:2785
}
```

Apply it:

```bash
sudo systemctl reload caddy
```

Caddy requests and renews the HTTPS certificate automatically. This only works once the domain's A record points at the VPS (see "What you need"). WebSocket traffic (live chat updates) passes through without extra settings.

### Step 9: Sign in

1. Get the admin API key (it is created on the first start):

   ```bash
   docker exec openwa-api cat /app/data/.api-key
   ```

   The file has no trailing newline, so copy only the key (it starts with `owa_k1_`).

2. Open `https://crm.yourcompany.com` and sign in with that key.
3. Go to **API Keys** and create separate keys for your team. Keep the first admin key private.
4. Go to **Sessions**, create a session, start it, and scan the QR code with WhatsApp on the phone (WhatsApp → Linked devices → Link a device).
5. Open **Settings** and set the name that appears at the start of your replies.

### Step 10: Keep it running and up to date

**Update to a new version** (after you push changes from your computer):

```bash
cd ~/business-advisor-crm
git pull
docker compose up -d --build
```

**Back up** the data (sessions, database, media) regularly. All of it lives in the `openwa-data` Docker volume:

```bash
docker run --rm -v openwa-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/crm-data-$(date +%F).tar.gz -C /data .
```

Copy the resulting `.tar.gz` somewhere off the server. The file contains the admin API key and your linked WhatsApp login, so store it privately.

**Useful commands**

| Task                  | Command                             |
| --------------------- | ----------------------------------- |
| See running services  | `docker compose ps`                 |
| Watch the logs        | `docker compose logs -f openwa-api` |
| Restart               | `docker compose restart openwa-api` |
| Stop everything       | `docker compose down`               |
| Check disk and memory | `df -h` and `free -m`               |

The containers start again automatically after a VPS reboot (`restart: unless-stopped`).

### Troubleshooting

- **The page does not load over HTTPS:** check that the A record points at the VPS (`dig +short crm.yourcompany.com`), that ports 80 and 443 are allowed in the firewall, and look at `sudo journalctl -u caddy --no-pager | tail`.
- **"Invalid API key":** copy the key again from `/app/data/.api-key` with no spaces, and log out of the dashboard first.
- **Browser errors about CORS or a blank page:** `CORS_ORIGINS` must match the address in the browser exactly (including `https://`, with no path). Edit `.env`, then run `docker compose up -d`.
- **The build is killed or stalls:** the VPS is out of memory. Add swap (Step 3) or build on a bigger machine temporarily.
- **A WhatsApp session will not start:** read the logs with `docker compose logs --tail 100 openwa-api`. Make sure `ENGINE_TYPE=baileys` is set in `.env`.
- More help: [docs/12-troubleshooting-faq.md](docs/12-troubleshooting-faq.md).
