"use strict";

/* ==========================================================================
   Filipe — servidor HTTP sem dependências
   - Site estático (index.html, css, js)
   - API de autenticação: registo, login, logout, recuperação de senha
   - Sessões em cookie HttpOnly
   - Senhas com hash scrypt + salt
   - Dados persistidos em data/*.json
   ========================================================================== */

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const USERS_FILE = path.join(DATA_DIR, "utilizadores.json");
const MESSAGES_FILE = path.join(DATA_DIR, "mensagens.json");
const RESETS_FILE = path.join(DATA_DIR, "redefinicoes.json");

const PORT = Number(process.env.PORT) || 3000;
const SESSION_COOKIE = "sessao";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 horas
const RESET_TTL_MS = 30 * 60 * 1000; // 30 minutos

const ADMIN_UTILIZADOR = process.env.ADMIN_UTILIZADOR || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@filipe.com";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sessions = new Map(); // token -> { userId, exp }
const loginAttempts = new Map(); // ip -> { count, resetAt }

/* ---------- Persistência ---------- */

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDataDir();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

let users = [];
let messages = [];

function loadData() {
  ensureDataDir();
  users = readJson(USERS_FILE, []);
  messages = readJson(MESSAGES_FILE, []);
}

/* ---------- Senhas ---------- */

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function newUser({ nome, email, utilizador = null, senha, role = "cliente" }) {
  const { salt, hash } = hashPassword(senha);
  return {
    id: crypto.randomUUID(),
    nome: nome.trim(),
    email: email.trim().toLowerCase(),
    utilizador: utilizador ? utilizador.trim() : null,
    salt,
    hash,
    role,
    criadoEm: new Date().toISOString(),
  };
}

function publicUser(user) {
  return {
    id: user.id,
    nome: user.nome,
    email: user.email,
    utilizador: user.utilizador,
    role: user.role,
    criadoEm: user.criadoEm,
  };
}

function findByIdentifier(identifier) {
  const value = String(identifier || "").trim().toLowerCase();
  if (!value) return null;
  return (
    users.find((u) => u.email.toLowerCase() === value) ||
    users.find((u) => u.utilizador && u.utilizador.toLowerCase() === value) ||
    null
  );
}

function seedAdmin() {
  const hasAdmin = users.some((u) => u.role === "admin");
  if (hasAdmin) return;

  users.push(
    newUser({
      nome: "Administrador",
      email: ADMIN_EMAIL,
      utilizador: ADMIN_UTILIZADOR,
      senha: ADMIN_PASSWORD,
      role: "admin",
    })
  );
  writeJson(USERS_FILE, users);
  console.log(
    `[seed] Administrador criado — utilizador: "${ADMIN_UTILIZADOR}" | senha: "${ADMIN_PASSWORD}"`
  );
}

/* ---------- Sessões / cookies ---------- */

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { userId, exp: Date.now() + SESSION_TTL_MS });
  return token;
}

function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(
    SESSION_TTL_MS / 1000
  )}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

function parseCookies(header) {
  const out = {};
  String(header || "")
    .split(";")
    .forEach((part) => {
      const eq = part.indexOf("=");
      if (eq < 0) return;
      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (key) out[key] = decodeURIComponent(value);
    });
  return out;
}

function currentUser(req) {
  const token = parseCookies(req.headers.cookie || "")[SESSION_COOKIE];
  if (!token) return null;

  const session = sessions.get(token);
  if (!session) return null;
  if (session.exp < Date.now()) {
    sessions.delete(token);
    return null;
  }

  return users.find((u) => u.id === session.userId) || null;
}

function destroyUserSessions(userId) {
  for (const [token, session] of sessions) {
    if (session.userId === userId) sessions.delete(token);
  }
}

/* ---------- Helpers HTTP ---------- */

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Corpo do pedido demasiado grande."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("JSON inválido."));
      }
    });

    req.on("error", reject);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tooManyAttempts(ip) {
  const attempt = loginAttempts.get(ip);
  if (!attempt) return false;
  if (Date.now() > attempt.resetAt) {
    loginAttempts.delete(ip);
    return false;
  }
  return attempt.count >= 8;
}

function registerFailure(ip) {
  const now = Date.now();
  const attempt = loginAttempts.get(ip) || { count: 0, resetAt: now + 10 * 60 * 1000 };
  attempt.count += 1;
  loginAttempts.set(ip, attempt);
}

function requireAdmin(req, res) {
  const user = currentUser(req);
  if (!user) {
    sendJson(res, 401, { erro: "É preciso iniciar sessão." });
    return null;
  }
  if (user.role !== "admin") {
    sendJson(res, 403, { erro: "Acesso restrito ao administrador." });
    return null;
  }
  return user;
}

/* ---------- API ---------- */

async function handleApi(req, res, pathname) {
  const method = req.method;

  if (method === "POST") {
    const type = String(req.headers["content-type"] || "");
    if (!type.includes("application/json")) {
      return sendJson(res, 415, { erro: "Envie o corpo como application/json." });
    }
  }

  /* Sessão atual */
  if (pathname === "/api/me" && method === "GET") {
    const user = currentUser(req);
    if (!user) return sendJson(res, 200, { autenticado: false });
    return sendJson(res, 200, { autenticado: true, utilizador: publicUser(user) });
  }

  /* Registro (cliente) */
  if (pathname === "/api/registo" && method === "POST") {
    const body = await readBody(req);
    const nome = String(body.nome || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const senha = String(body.senha || "");

    if (nome.length < 2) return sendJson(res, 400, { erro: "Informe o seu nome." });
    if (!EMAIL_RE.test(email)) return sendJson(res, 400, { erro: "E-mail inválido." });
    if (senha.length < 6)
      return sendJson(res, 400, { erro: "A senha precisa ter pelo menos 6 caracteres." });
    if (users.some((u) => u.email.toLowerCase() === email))
      return sendJson(res, 409, { erro: "Já existe uma conta com este e-mail." });

    const user = newUser({ nome, email, senha, role: "cliente" });
    users.push(user);
    writeJson(USERS_FILE, users);

    const token = createSession(user.id);
    res.setHeader("Set-Cookie", sessionCookie(token));
    return sendJson(res, 201, { ok: true, utilizador: publicUser(user) });
  }

  /* Login (cliente ou admin) */
  if (pathname === "/api/login" && method === "POST") {
    const ip = req.socket.remoteAddress || "local";
    if (tooManyAttempts(ip)) {
      return sendJson(res, 429, {
        erro: "Demasiadas tentativas. Tente novamente em alguns minutos.",
      });
    }

    const body = await readBody(req);
    const identificador = String(body.identificador || "").trim();
    const senha = String(body.senha || "");

    const user = findByIdentifier(identificador);
    const valid = user && verifyPassword(senha, user.salt, user.hash);

    if (!valid) {
      registerFailure(ip);
      await delay(350);
      return sendJson(res, 401, { erro: "E-mail/utilizador ou senha incorretos." });
    }

    loginAttempts.delete(ip);
    const token = createSession(user.id);
    res.setHeader("Set-Cookie", sessionCookie(token));
    return sendJson(res, 200, { ok: true, utilizador: publicUser(user) });
  }

  /* Logout */
  if (pathname === "/api/logout" && method === "POST") {
    const token = parseCookies(req.headers.cookie || "")[SESSION_COOKIE];
    if (token) sessions.delete(token);
    res.setHeader("Set-Cookie", clearSessionCookie());
    return sendJson(res, 200, { ok: true });
  }

  /* Esqueci a senha */
  if (pathname === "/api/esqueci" && method === "POST") {
    const body = await readBody(req);
    const email = String(body.email || "").trim().toLowerCase();

    if (!EMAIL_RE.test(email)) return sendJson(res, 400, { erro: "E-mail inválido." });

    const user = users.find((u) => u.email.toLowerCase() === email);
    let demoLink = null;

    if (user) {
      const resets = readJson(RESETS_FILE, []).filter((r) => r.exp > Date.now());
      const token = crypto.randomBytes(32).toString("hex");
      resets.push({ token, userId: user.id, exp: Date.now() + RESET_TTL_MS });
      writeJson(RESETS_FILE, resets);

      demoLink = `/redefinir.html?token=${token}`;
      console.log(`[recuperação] ${email} -> ${demoLink}`);
    }

    return sendJson(res, 200, {
      ok: true,
      mensagem: "Se o e-mail existir, as instruções de recuperação foram geradas.",
      demoLink,
    });
  }

  /* Redefinir senha com token */
  if (pathname === "/api/redefinir" && method === "POST") {
    const body = await readBody(req);
    const token = String(body.token || "");
    const senha = String(body.senha || "");

    if (senha.length < 6)
      return sendJson(res, 400, { erro: "A senha precisa ter pelo menos 6 caracteres." });

    const resets = readJson(RESETS_FILE, []);
    const entry = resets.find((r) => r.token === token && r.exp > Date.now());

    if (!entry) return sendJson(res, 400, { erro: "Link inválido ou expirado." });

    const user = users.find((u) => u.id === entry.userId);
    if (!user) return sendJson(res, 400, { erro: "Conta não encontrada." });

    const { salt, hash } = hashPassword(senha);
    user.salt = salt;
    user.hash = hash;
    writeJson(USERS_FILE, users);

    writeJson(RESETS_FILE, resets.filter((r) => r.token !== token));
    destroyUserSessions(user.id);

    return sendJson(res, 200, { ok: true });
  }

  /* Contato do site */
  if (pathname === "/api/contacto" && method === "POST") {
    const body = await readBody(req);
    const nome = String(body.nome || "").trim().slice(0, 120);
    const email = String(body.email || "").trim().toLowerCase().slice(0, 160);
    const telefone = String(body.telefone || "").trim().slice(0, 40);
    const mensagem = String(body.mensagem || "").trim().slice(0, 2000);

    if (nome.length < 2) return sendJson(res, 400, { erro: "Informe o seu nome." });
    if (!EMAIL_RE.test(email)) return sendJson(res, 400, { erro: "E-mail inválido." });
    if (mensagem.length < 5)
      return sendJson(res, 400, { erro: "Escreva uma mensagem um pouco mais longa." });

    messages.push({
      id: crypto.randomUUID(),
      nome,
      email,
      telefone,
      mensagem,
      criadoEm: new Date().toISOString(),
      lida: false,
    });
    writeJson(MESSAGES_FILE, messages);

    return sendJson(res, 201, { ok: true });
  }

  /* Admin — utilizadores + estatísticas */
  if (pathname === "/api/admin/utilizadores" && method === "GET") {
    if (!requireAdmin(req, res)) return;
    return sendJson(res, 200, {
      utilizadores: users.map(publicUser),
      estatisticas: {
        total: users.length,
        administradores: users.filter((u) => u.role === "admin").length,
        clientes: users.filter((u) => u.role === "cliente").length,
        mensagens: messages.length,
      },
    });
  }

  /* Admin — mensagens de contato */
  if (pathname === "/api/admin/mensagens" && method === "GET") {
    if (!requireAdmin(req, res)) return;
    const sorted = [...messages].sort((a, b) => (a.criadoEm < b.criadoEm ? 1 : -1));
    return sendJson(res, 200, { mensagens: sorted });
  }

  return sendJson(res, 404, { erro: "Rota não encontrada." });
}

/* ---------- Arquivos estáticos ---------- */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

async function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendText(res, 405, "Método não permitido.");
  }

  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return sendText(res, 400, "Pedido inválido.");
  }

  if (rel === "/") rel = "/index.html";

  const blocked =
    rel.startsWith("/data") ||
    rel.startsWith("/.") ||
    rel === "/server.js" ||
    rel.startsWith("/package") ||
    rel === "/README.md";
  if (blocked) return sendText(res, 404, "Não encontrado.");

  rel = rel.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT, rel);

  if (!filePath.startsWith(ROOT + path.sep)) {
    return sendText(res, 403, "Acesso negado.");
  }

  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return sendText(res, 404, "Página não encontrada.");
  }

  if (!stat.isFile()) return sendText(res, 404, "Página não encontrada.");

  const ext = path.extname(filePath).toLowerCase();
  res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
  res.setHeader("Content-Length", stat.size);
  res.setHeader("Cache-Control", ext === ".html" ? "no-cache" : "public, max-age=3600");

  if (req.method === "HEAD") {
    res.writeHead(200);
    return res.end();
  }

  res.writeHead(200);
  fs.createReadStream(filePath).pipe(res);
}

/* ---------- Servidor ---------- */

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self'; base-uri 'self'; form-action 'self'"
  );
}

const server = http.createServer((req, res) => {
  setSecurityHeaders(res);

  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  } catch {
    return sendText(res, 400, "Pedido inválido.");
  }

  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url.pathname).catch((err) => {
      console.error("[api]", err);
      if (!res.headersSent) sendJson(res, 500, { erro: "Erro interno do servidor." });
      else res.end();
    });
    return;
  }

  serveStatic(req, res, url.pathname).catch((err) => {
    console.error("[static]", err);
    if (!res.headersSent) sendText(res, 500, "Erro interno do servidor.");
    else res.end();
  });
});

/* ---------- Início ---------- */

loadData();
seedAdmin();

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.exp < now) sessions.delete(token);
  }
}, 15 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log("");
  console.log(`  Filipe rodando em http://localhost:${PORT}`);
  console.log(`  Admin: ${ADMIN_UTILIZADOR} / ${ADMIN_PASSWORD}`);
  console.log("  (Pressione Ctrl+C para parar)");
  console.log("");
});
