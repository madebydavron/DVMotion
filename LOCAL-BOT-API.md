# Running your own Bot API server

This lifts a bot's upload limit from 50 MB to 2 GB. The bot stays the same, the
token stays the same — only the address the panel talks to changes.

Worth knowing before you start: the account route already works for you, and
the log shows a 69.9 MB file going through it. This is the alternative for when
you would rather the file arrive **from the bot** than from your account.

---

## 1. Get api_id and api_hash

You already have these. If not: **my.telegram.org** → API development tools →
fill in any app name → the page gives you `api_id` and `api_hash`.

These belong to you, not to the bot. The server needs them to talk to Telegram.

## 2. Run the server

Docker is by far the easiest route on Windows — the project has no official
Windows build, and compiling it yourself means CMake, vcpkg and an afternoon.

Install Docker Desktop, then:

```
docker run -d --name tg-bot-api -p 8081:8081 ^
  -e TELEGRAM_API_ID=YOUR_API_ID ^
  -e TELEGRAM_API_HASH=YOUR_API_HASH ^
  -v tgbotapi:/var/lib/telegram-bot-api ^
  aiogram/telegram-bot-api:latest
```

Use `^` for line continuation in Command Prompt, or put it all on one line.

Check it is alive:

```
curl http://localhost:8081/bot<YOUR_TOKEN>/getMe
```

`"ok":true` means it is working.

## 3. Log the bot out of Telegram's servers

A bot can only live on one Bot API server at a time. Before it will work
locally it has to leave the cloud one:

```
curl https://api.telegram.org/bot<YOUR_TOKEN>/logOut
```

This is one-way for as long as you use the local server. To go back, call
`http://localhost:8081/bot<TOKEN>/logOut` and let it return to the cloud.

## 4. Point the panel at it

Settings → **API server**:

```
http://localhost:8081
```

Leave *Upload with my account* unticked. The panel notices the address is not
Telegram's own and raises its limit to 2 GB by itself.

---

## Which route to use

| | Bot, Telegram's servers | Bot, your server | Your account |
|---|---|---|---|
| Limit | 50 MB | 2 GB | 2 GB (4 GB Premium) |
| Setup | token only | Docker + logOut | sign in once |
| Sent by | the bot | the bot | you |
| Runs when the PC is off | yes | no | no |

The local server has to be running whenever you render. If Docker is not up,
the panel gets a connection error rather than a Telegram one.
