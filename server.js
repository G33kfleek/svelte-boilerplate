const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const XLSX = require('xlsx');

const port = Number(process.env.PORT) || 3001;
const publicDirectory = path.join(__dirname, 'public');
const workbookPath = path.join(__dirname, 'src', 'Assets', 'documents', 'TRANSCRIPTS.pdf.xlsx');
const transcriptPath = path.join(__dirname, 'src', 'Assets', 'documents', 'TRANSCRIPTS.pdf');
const sessionLifetime = 30 * 60 * 1000;
const sessions = new Map();
const workbook = XLSX.readFile(workbookPath, { cellDates: false });

function normalizeRegistry(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function getStudentProfile(registry) {
    const normalizedRegistry = normalizeRegistry(registry);
    if (!normalizedRegistry) {
        return null;
    }

    const sheetName = workbook.SheetNames.find((name) => normalizeRegistry(name) === normalizedRegistry);
    if (!sheetName) {
        return null;
    }

    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        defval: '',
        raw: true
    });
    const fields = rows.slice(1).filter((row) => row[0] !== '');
    const registration = fields.find((row) => /(register|registration|student id)/i.test(String(row[0])));
    if (!registration || normalizeRegistry(registration[1]) !== normalizedRegistry) {
        return null;
    }

    return {
        registry: String(registration[1]),
        sheetName,
        fields: fields.map((row) => {
            const label = String(row[0]);
            let value = row[1] == null ? '' : row[1];
            if (typeof value === 'number' && /^date\b/i.test(label)) {
                value = XLSX.SSF.format('dd mmmm yyyy', value);
            }
            return [label, String(value)];
        })
    };
}

function sendJson(response, status, payload) {
    response.writeHead(status, {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff'
    });
    response.end(JSON.stringify(payload));
}

function constantTimeEqual(value, expected) {
    const actualBuffer = Buffer.from(String(value || ''));
    const expectedBuffer = Buffer.from(String(expected || ''));
    return actualBuffer.length === expectedBuffer.length &&
        actualBuffer.length > 0 &&
        crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

async function readJson(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > 8192) {
            throw new Error('Request body too large');
        }
        chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function getSession(request) {
    const cookies = String(request.headers.cookie || '').split(';');
    const cookie = cookies.find((value) => value.trim().startsWith('transcript_session='));
    if (!cookie) {
        return false;
    }

    const token = cookie.trim().slice('transcript_session='.length);
    const session = sessions.get(token);
    if (!session || session.expiresAt < Date.now()) {
        sessions.delete(token);
        return false;
    }
    session.expiresAt = Date.now() + sessionLifetime;
    return session;
}

function download(response, content, contentType, filename) {
    response.writeHead(200, {
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': content.length,
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff'
    });
    response.end(content);
}

function serveStatic(request, response, pathname) {
    let requestedPath;
    try {
        requestedPath = decodeURIComponent(pathname);
    } catch (error) {
        response.writeHead(400);
        response.end('Invalid path');
        return;
    }

    let filePath = path.resolve(publicDirectory, `.${requestedPath}`);
    if (filePath !== publicDirectory && !filePath.startsWith(`${publicDirectory}${path.sep}`)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
    }

    try {
        if (fs.statSync(filePath).isDirectory()) {
            filePath = path.join(filePath, 'index.html');
        }
    } catch (error) {
        filePath = path.join(publicDirectory, 'index.html');
    }

    fs.readFile(filePath, (error, content) => {
        if (error) {
            response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('Application build not found. Run npm run build first.');
            return;
        }
        const contentTypes = {
            '.css': 'text/css; charset=utf-8',
            '.html': 'text/html; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.svg': 'image/svg+xml'
        };
        response.writeHead(200, {
            'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff'
        });
        response.end(content);
    });
}

async function handleRequest(request, response) {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/api/verify' && request.method === 'GET') {
        const registry = url.searchParams.get('register');
        if (!registry) {
            sendJson(response, 400, { message: 'A register number is required.' });
            return;
        }
        const profile = getStudentProfile(registry);
        if (!profile) {
            sendJson(response, 404, { message: 'No matching student record was found.' });
            return;
        }
        sendJson(response, 200, { profile });
        return;
    }

    if (url.pathname === '/api/login' && request.method === 'POST') {
        let credentials;
        try {
            credentials = await readJson(request);
        } catch (error) {
            sendJson(response, 400, { message: 'Invalid sign-in request.' });
            return;
        }
        const student = getStudentProfile(credentials.username);
        const expectedPassword = process.env.TRANSCRIPT_PASSWORD || 'password';
        if (!student || !constantTimeEqual(credentials.password, expectedPassword)) {
            sendJson(response, 401, { message: 'Incorrect username or password.' });
            return;
        }

        const token = crypto.randomBytes(32).toString('hex');
        sessions.set(token, { username: student.registry, expiresAt: Date.now() + sessionLifetime });
        const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
        response.writeHead(200, {
            'Cache-Control': 'no-store',
            'Set-Cookie': `transcript_session=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=1800${secure}`,
            'Content-Type': 'application/json; charset=utf-8',
            'X-Content-Type-Options': 'nosniff'
        });
        response.end(JSON.stringify({ authenticated: true }));
        return;
    }

    if (url.pathname === '/api/session' && request.method === 'GET') {
        const profile = getStudentProfile(url.searchParams.get('register'));
        if (!profile) {
            sendJson(response, 404, { message: 'No matching student record was found.' });
            return;
        }

        const session = getSession(request);
        sendJson(response, 200, {
            signedIn: Boolean(session && normalizeRegistry(session.username) === normalizeRegistry(profile.registry))
        });
        return;
    }

    if (url.pathname === '/api/logout' && request.method === 'POST') {
        const cookies = String(request.headers.cookie || '').split(';');
        const cookie = cookies.find((value) => value.trim().startsWith('transcript_session='));
        if (cookie) {
            const token = cookie.trim().slice('transcript_session='.length);
            sessions.delete(token);
        }

        const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
        response.writeHead(200, {
            'Cache-Control': 'no-store',
            'Set-Cookie': `transcript_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${secure}`,
            'Content-Type': 'application/json; charset=utf-8',
            'X-Content-Type-Options': 'nosniff'
        });
        response.end(JSON.stringify({ signedOut: true }));
        return;
    }

    if (url.pathname === '/api/transcript' && request.method === 'GET') {
        const session = getSession(request);
        if (!session) {
            sendJson(response, 401, { message: 'Sign-in is required to download a transcript.' });
            return;
        }

        const profile = getStudentProfile(url.searchParams.get('register'));
        if (!profile) {
            sendJson(response, 404, { message: 'No matching student record was found.' });
            return;
        }
        if (normalizeRegistry(session.username) !== normalizeRegistry(profile.registry)) {
            sendJson(response, 403, { message: 'This login is only authorized for its matching register number.' });
            return;
        }

        if (url.searchParams.get('format') === 'xlsx') {
            const exportWorkbook = XLSX.utils.book_new();
            const sheet = XLSX.utils.aoa_to_sheet([['Field', 'Details'], ...profile.fields]);
            XLSX.utils.book_append_sheet(exportWorkbook, sheet, profile.sheetName.slice(0, 31));
            const content = XLSX.write(exportWorkbook, { bookType: 'xlsx', type: 'buffer' });
            download(response, content, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `TRANSCRIPT_${normalizeRegistry(profile.registry)}.xlsx`);
            return;
        }

        if (url.searchParams.get('format') !== 'pdf') {
            sendJson(response, 400, { message: 'Unsupported transcript format.' });
            return;
        }
        fs.readFile(transcriptPath, (error, content) => {
            if (error) {
                sendJson(response, 404, { message: 'Transcript PDF not found.' });
                return;
            }
            download(response, content, 'application/pdf', 'TRANSCRIPT.pdf');
        });
        return;
    }

    if (url.pathname.startsWith('/api/')) {
        sendJson(response, 404, { message: 'API endpoint not found.' });
        return;
    }
    serveStatic(request, response, url.pathname);
}

function createServer() {
    return http.createServer((request, response) => {
        handleRequest(request, response).catch(() => {
            if (!response.headersSent) {
                sendJson(response, 500, { message: 'An internal server error occurred.' });
            } else {
                response.destroy();
            }
        });
    });
}

if (require.main === module) {
    createServer().listen(port, () => {
        console.log(`Transcript verification server listening on port ${port}`);
    });
}

module.exports = { createServer, getStudentProfile, normalizeRegistry };
