# Free Public Hosting for Testing

The application is stateless/in-memory at this stage, so a free web-service host is suitable for demos. Do not treat free instances as production infrastructure.

## Recommended test option: Render

Create a Node Web Service from your Git repository.

- Build command: `npm install`
- Start command: `npm start`
- Health path: `/health`
- Add your `.env` values as host environment variables.
- Use the generated HTTPS domain as the Meta callback base.

Example WhatsApp callback:

`https://YOUR-SERVICE.onrender.com/webhooks/whatsapp/default`

Free services can sleep/spin down and are intended for testing, not production.

## Alternative: Koyeb

Koyeb also offers one free web service suitable for testing. Its free instance scales to zero after inactivity and does not provide persistent volumes.

## Persistence warning

Nova currently stores CRM, Memory, Commerce orders, Cleaning requests and conversation state in memory. A restart or free-host sleep/redeploy clears that data. Before production we will migrate these repositories to PostgreSQL/Redis.
