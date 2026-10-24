<div align="center">

<img src="https://files.catbox.moe/r47367.png" alt="Michiko MD Banner" width="100%" style="border-radius:12px" />

<br/>
<br/>

<img src="https://img.shields.io/badge/Michiko%20MD-v3.0.0-blueviolet?style=for-the-badge&logo=whatsapp&logoColor=white" />
<img src="https://img.shields.io/badge/Node.js-18%2B-green?style=for-the-badge&logo=node.js&logoColor=white" />
<img src="https://img.shields.io/badge/Baileys-Powered-blue?style=for-the-badge" />
<img src="https://img.shields.io/badge/Built%20by-Mr%20Shefzy-orange?style=for-the-badge" />
<img src="https://img.shields.io/badge/ShefzyTech-2024-red?style=for-the-badge" />

<br/>
<br/>

# ⚡ Michiko MD v3.0.0

**A powerful WhatsApp bot built with Node.js and Baileys.**
Group management · Economy · Games · Media tools · AI chatbot · Sticker maker · Anti-abuse & more.

<br/>

[🌐 Web Pair](https://michikopair.vercel.app) · [🎫 Session Generator](https://mich-session-id.onrender.com/) · [📢 Channel](https://whatsapp.com/channel/0029VbCRdBDFi8xeQJcl1o1C) · [👨‍💻 Developer](https://wa.me/2349028711461)

</div>

---

## ⚠️ IMPORTANT DISCLAIMER

> **Michiko MD is NOT created, affiliated with, or endorsed by Meta Platforms, Inc. or WhatsApp LLC.**
>
> This bot is an independent  project that operates using the WhatsApp Web API via the Baileys library. By using Michiko MD, you agree to the following:
>
> - ❗ Use this bot **at your own risk**. Your WhatsApp account may be **temporarily or permanently banned** by WhatsApp for using unofficial third-party bots.
> - ❗ **ShefzyTech and Mr Shefzy will NOT be held responsible** for any damage, account suspension, data loss, or any other consequences resulting from the use of this bot.
> - ❗ Do NOT use this bot for **spamming, harassment, illegal activities**, or any violation of WhatsApp's Terms of Service.
> - ❗ This project is intended for **educational and personal use only**.
> - ❗ By deploying or using Michiko MD, you take **full responsibility** for all actions performed through your instance.

---

## 📋 Table of Contents

- [Features](#-features)
- [Deployment Options](#-deployment-options)
  - [Option 1 — Free Bot (Web Pair)](#option-1--free-bot-web-pair)
  - [Option 2 — Free Bot (Telegram Pair)](#option-2--free-bot-telegram-pair)
  - [Option 3 — Self-Host with Session ID](#option-3--self-host-with-session-id)
  - [Option 4 — Termux Deployment](#option-4--termux-deployment)
  - [Option 5 — Panel Deployment](#option-5--panel-deployment)
- [Configuration](#-configuration)
- [Commands](#-commands)
- [Tech Stack](#-tech-stack)
- [Support](#-support)
- [License](#-license)

---

## ✨ Features

| Category | Features |
|---|---|
| 🛡️ **Group Management** | Antilink, Antibot, Antibadword, Welcome/Goodbye, Promote/Demote, Kick, Mute |
| 💰 **Economy** | Balance, Daily reward, Transfer, Leaderboard |
| 🎮 **Games** | 27 games including Tetris, 2048, Snake, Chess, Sudoku, Wordle and more |
| 🤖 **AI Chatbot** | Auto-reply chatbot, Michiko AI, summarize / rewrite / explain tools |
| 🎵 **Media** | YouTube/SoundCloud downloader, Audio converter, Video tools |
| 🖼️ **Sticker** | Image/Video to sticker, Sticker to image |
| 🎶 **Music** | AI music generation (Sonu), SoundCloud search & download |
| ⚙️ **Bot Settings** | Always online, Auto-read, Auto-typing, Auto-recording |
| 🔄 **Stays Online** | Automatic reconnect, safe restarts, built-in updater (`.update`) |
| 🔐 **Session Generator** | Generate Session IDs for instant bot deployment |

---

## 🚀 Deployment Options

There are **5 ways** to use Michiko MD. Choose the one that suits you best:

---

### Option 1 — Free Bot (Web Pair)

> ✅ **Best for:** Users who want to use the bot without downloading anything.
> You don't need any technical knowledge. Just pair your number on the website.

**Steps:**

1. Visit the Web Panel: **[michikopair.vercel.app](https://michikopair.vercel.app)**
2. Enter your WhatsApp number with country code (e.g. `2349028711461`)
3. Click **Get Code**
4. Open WhatsApp → **Settings → Linked Devices → Link a Device**
5. Tap **"Link with phone number instead"** and enter the code
6. Your number is now connected to the bot ✅

> ⚠️ Your number will only stay active as long as the bot server is running. This is a **shared instance** wether it stays active or not is not for you to control.

---

### Option 2 — Free Bot (Telegram Pair)

> ✅ **Best for:** Users who prefer pairing through Telegram.

**Steps:**

1. Open Telegram and search for the bot: **[@Ilovemichbot](http://t.me/Ilovemichbot)**
2. Send `/start` to begin
3. Follow the instructions to pair your WhatsApp number
4. Your number will be connected to the shared bot instance ✅

> ⚠️ Same limitations as Web Pair — shared instance, no control over bot.

---

### Option 3 — Self-Host with Session ID

> ✅ **Best for:** Users who want their **own private bot** deployed on a free cloud platform.

**Free hosting platforms (click to open):**

| Platform | Link |
|---|---|
| 🟢 **Render** | [render.com](https://render.com) |
| 🟣 **Koyeb** | [koyeb.com](https://www.koyeb.com) |
| 🔵 **Railway** | [railway.com](https://railway.com) |
| 🟡 **Replit** | [replit.com](https://replit.com) |
| ⚫ **Heroku** | [heroku.com](https://www.heroku.com) |

**Step 1 — Generate your Session ID**

1. Visit: **[Michiko Session Generator](https://mich-session-id.onrender.com/)**
2. Enter your WhatsApp number
3. Enter the pairing code in WhatsApp Linked Devices
4. Your **Session ID** is sent to your own WhatsApp chat ("Message yourself"). Copy it and keep it safe ✅

> 🔒 Your Session ID is **not stored anywhere**. If you lose it, you have to generate a new one. Never share it with anyone, it gives full access to your WhatsApp.

**Step 2 — Fork this repository**

Click the **Fork** button at the top right of this page.

**Step 3 — Deploy on your preferred platform**

> 🎥 New to this? **[Watch how to deploy on Render using Session ID](https://youtu.be/ND_xdXl7CSk)**

<details>
<summary>🟢 Deploy on Render (Recommended)</summary>

🎥 **[Watch: How to deploy on Render using Session ID](https://youtu.be/ND_xdXl7CSk)**

1. Go to [render.com](https://render.com) → Sign up free
2. Click **New** → **Web Service**
3. Connect your forked GitHub repo
4. Set the following:
   ```
   Build Command: npm install
   Start Command: node index.js
   ```
5. Add Environment Variables:
   ```
   SESSION_ID = your_session_id_here
   ```
6. Click **Deploy** — bot starts automatically ✅

</details>

<details>
<summary>🟣 Deploy on Koyeb</summary>

1. Go to [koyeb.com](https://www.koyeb.com) → Sign up free
2. Click **Create App** → **GitHub**
3. Connect your forked repo
4. Set environment variables:
   ```
   SESSION_ID = your_session_id_here
   ```
5. Set run command to `node index.js`
6. Deploy ✅

</details>

<details>
<summary>🔵 Deploy on Railway</summary>

1. Go to [railway.com](https://railway.com) → Sign up free
2. Click **New Project** → **Deploy from GitHub repo**
3. Connect your forked repo
4. Add environment variable:
   ```
   SESSION_ID = your_session_id_here
   ```
5. Railway auto-detects Node.js and deploys ✅

</details>

<details>
<summary>🟡 Deploy on Replit</summary>

1. Go to [replit.com](https://replit.com) → Sign up free
2. Click **Create Repl** → **Import from GitHub**
3. Paste your forked repo URL
4. Open **Secrets** (🔒 icon) and add:
   ```
   SESSION_ID = your_session_id_here
   ```
5. Click **Run** ✅

</details>

<details>
<summary>⚫ Deploy on Heroku</summary>

> Heroku no longer has a fully free plan. It needs a paid plan or credits.

1. Go to [heroku.com](https://www.heroku.com) → Sign up
2. Click **New** → **Create new app**
3. In the **Deploy** tab, choose **GitHub** and connect your forked repo
4. Open the **Settings** tab → **Reveal Config Vars** and add:
   ```
   SESSION_ID = your_session_id_here
   ```
5. Back in the **Deploy** tab, click **Deploy Branch** ✅

</details>

> ⚠️ **Free tier platforms** may sleep after inactivity. Use [UptimeRobot](https://uptimerobot.com) to ping your deployment URL every 10 minutes to keep it awake.
>
> ⚠️ Run **only one copy** of the bot per Session ID. If the same Session ID runs on two hosts at once, WhatsApp will disconnect both.

---

### Option 4 — Termux Deployment

> ✅ **Best for:** Users who want to run the bot straight from their Android phone, no hosting account needed.

**Steps:**

1. Install **Termux** from [F-Droid](https://f-droid.org/packages/com.termux/) (the Play Store version is outdated)

2. Open Termux and install the tools:
   ```bash
   pkg update -y && pkg upgrade -y
   pkg install -y git nodejs ffmpeg
   ```

3. Download the bot and install dependencies:
   ```bash
   git clone https://github.com/shefzy-tech/michiko-md.git
   cd michiko-md
   npm install
   ```

4. Start the bot:
   ```bash
   node index.js
   ```

5. Link your WhatsApp. Choose **one**:

   **A. Pair code (no Session ID needed)**
   - When asked, type your WhatsApp number with country code (e.g. `2349028711461`)
   - A pairing code appears in Termux
   - Open WhatsApp → **Settings → Linked Devices → Link a Device** → **"Link with phone number instead"** and enter the code

   **B. Session ID**
   - Generate one at the [Session Generator](https://mich-session-id.onrender.com/)
   - Start the bot like this instead:
     ```bash
     SESSION_ID="your_session_id_here" node index.js
     ```

6. Bot connects automatically ✅

**Keep it running in the background:**
```bash
termux-wake-lock
```
Also turn off battery optimization for Termux in your phone settings, or Android may stop it.

**Update later:** send `.update` to the bot, or run `git pull` inside the folder.

---

### Option 5 — Panel Deployment

> ✅ **Best for:** Users who have their own private panel (Pterodactyl or similar) and want maximum control.

Start the bot on your panel, enter your WhatsApp number when asked, then link with the pair code.

### 🎥 [Watch: How to deploy on a panel using pair code](https://youtu.be/vh3GVhl2ZAY)

---

## ⚙️ Configuration

Set these as **environment variables** on your host:

| Variable | Description | Example |
|---|---|---|
| `SESSION_ID` | Your base64 session string (for cloud deploy) | `eyJub2lz...` |
| `PAIR_NUMBER` | Your number with country code. Use it with a pair code when your host has no console to type in | `2349028711461` |
| `BOT_OWNER_NUMBER` | Owner number (optional) | `2349028711461` |

> Use **either** `SESSION_ID` **or** `PAIR_NUMBER`, not both.

---

## 💬 Commands

> Default prefix: `.`  ·  Send `.menu` to see everything.

<details>
<summary>🛡️ Group Management</summary>

| Command | Description |
|---|---|
| `.antilink on/off` | Toggle anti-link protection |
| `.antibot on/off` | Toggle anti-bot protection |
| `.antibadword on/off` | Toggle bad word filter |
| `.kick @user` | Remove a member |
| `.promote @user` | Make member admin |
| `.demote @user` | Remove admin rights |
| `.mute` | Mute the group |
| `.unmute` | Unmute the group |
| `.welcome on/off` | Toggle welcome messages |
| `.goodbye on/off` | Toggle goodbye messages |

</details>

<details>
<summary>🤖 AI & Chat</summary>

| Command | Description |
|---|---|
| `.ai <query>` | Ask the AI anything |
| `.chatbot on/off` | Toggle auto chatbot replies |
| `.summarize <text>` | Summarize text (or reply to a message) |
| `.rewrite <text>` | Rewrite text more clearly |
| `.explain <text>` | Explain something simply |
| `.sonu <prompt>` | Generate AI music |

</details>

<details>
<summary>🎵 Media & Downloads</summary>

| Command | Description |
|---|---|
| `.play <song name>` | Download and send audio |
| `.video <name>` | Download and send video |
| `.scdlsearch <query>` | Search SoundCloud |
| `.sticker` | Convert image/video to sticker |
| `.toimg` | Convert sticker to image |

</details>

<details>
<summary>💰 Economy</summary>

| Command | Description |
|---|---|
| `.bal` | Check your balance |
| `.daily` | Claim daily reward |
| `.transfer @user <amount>` | Send coins to another user |
| `.leaderboard` | View top users |

</details>

<details>
<summary>🎮 Games</summary>

| Command | Description |
|---|---|
| `.gamemenu` | See all 27 games |
| `.tetris` `.game2048` `.snake` `.chess` `.sudoku` `.wordle` | Examples, see `.gamemenu` for the full list |

</details>

<details>
<summary>ℹ️ Info & Tools</summary>

| Command | Description |
|---|---|
| `.botinfo` | Bot version, uptime and memory |
| `.status` | Connection status |
| `.sessioninfo` | Your bot settings (owner) |
| `.timezone <city>` | Current time in any city |
| `.mention` | Set a custom reply when the bot is @mentioned |
| `.update` | Update the bot (owner) |

</details>

<details>
<summary>⚙️ Settings (Owner Only)</summary>

| Command | Description |
|---|---|
| `.alwaysonline on/off` | Toggle always online status |
| `.autoread on/off` | Toggle auto message read |
| `.autotyping on/off` | Toggle auto typing indicator |
| `.autorecording on/off` | Toggle auto recording indicator |

</details>

---

## 🛠️ Tech Stack

| Tool | Purpose |
|---|---|
| [Node.js](https://nodejs.org) | Runtime |
| [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) | WhatsApp Web API |
| [Pino](https://getpino.io) | Logging |
| [Chalk](https://www.npmjs.com/package/chalk) | Console styling |

---

## 📞 Support

Having issues? Reach out:

- 📢 **WhatsApp Channel:** [Join here](https://whatsapp.com/channel/0029VbCRdBDFi8xeQJcl1o1C)
- 💬 **WhatsApp Group:** [Join here](https://chat.whatsapp.com/BvNebap1oHL8mpACb0MNpi)
- 👨‍💻 **Developer:** [Mr Shefzy](https://wa.me/2349028711461)

---

## 📄 License

This project is open-source under the [MIT License](LICENSE).

You are free to use, modify and distribute this project. However:
- You **must** credit **ShefzyTech / Mr Shefzy** as the original author
- You **must not** remove copyright notices from the source files
- You **must not** sell this bot or claim it as your own original work

---

<div align="center">

© 2026 **ShefzyTech** — All rights reserved

⚡ **Michiko MD v3.0.0** · Built by **Mr Shefzy**

*This project is not affiliated with Meta or WhatsApp LLC.*

</div>
