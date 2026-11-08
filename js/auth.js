/* ==========================================================================
   Filipe — autenticação (login, registo, recuperação, conta e admin)
   ========================================================================== */

(function () {
  "use strict";

  var params = new URLSearchParams(window.location.search);

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function setStatus(element, message, type) {
    if (!element) return;
    element.textContent = message;
    element.className = "form-status" + (type ? " " + type : "");
  }

  async function api(url, body) {
    var options = { credentials: "same-origin", headers: {} };
    if (body !== undefined) {
      options.method = "POST";
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }

    var response = await fetch(url, options);
    var data = {};
    try {
      data = await response.json();
    } catch (error) {
      /* resposta sem JSON */
    }
    return { ok: response.ok, status: response.status, data: data };
  }

  function esc(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDate(iso) {
    if (!iso) return "—";
    var date = new Date(iso);
    if (isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  }

  function formatDateTime(iso) {
    if (!iso) return "—";
    var date = new Date(iso);
    if (isNaN(date.getTime())) return "—";
    return date.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function initials(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    var first = parts[0].charAt(0);
    var last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
    return (first + last).toUpperCase();
  }

  function safeNext() {
    var next = params.get("next");
    if (!next) return null;
    // Só aceita caminhos internos (evita open redirect).
    if (!/^\/(?!\/)[A-Za-z0-9\-._~%/?#&=+]*$/.test(next)) return null;
    return next;
  }

  function redirectAfterLogin(user) {
    var next = safeNext();
    if (next) {
      window.location.replace(next);
      return;
    }
    window.location.replace(user && user.role === "admin" ? "admin.html" : "conta.html");
  }

  function bindLogout() {
    $all("[data-logout]").forEach(function (button) {
      button.addEventListener("click", function () {
        button.disabled = true;
        api("/api/logout", {})
          .catch(function () {
            /* segue para o site de qualquer forma */
          })
          .then(function () {
            window.location.replace("index.html");
          });
      });
    });
  }

  /* ---------- Limpeza visual ao digitar ---------- */
  $all(".auth-form input").forEach(function (input) {
    input.addEventListener("input", function () {
      input.classList.remove("invalid");
      var status = document.querySelector(".auth-form .form-status");
      if (status) setStatus(status, "", "");
    });
  });

  /* ---------- LOGIN ---------- */
  var loginForm = document.getElementById("form-login");
  if (loginForm) {
    loginForm.addEventListener("submit", async function (event) {
      event.preventDefault();

      var status = document.getElementById("status");
      var identificador = loginForm.identificador.value.trim();
      var senha = loginForm.senha.value;

      if (!identificador || !senha) {
        setStatus(status, "Preencha e-mail/utilizador e senha.", "error");
        return;
      }

      var button = loginForm.querySelector("button[type='submit']");
      if (button) {
        button.disabled = true;
        button.textContent = "Entrando...";
      }

      try {
        var result = await api("/api/login", { identificador: identificador, senha: senha });

        if (!result.ok) {
          setStatus(status, (result.data && result.data.erro) || "Não foi possível entrar.", "error");
          return;
        }

        setStatus(status, "Sessão iniciada. Redirecionando…", "ok");
        redirectAfterLogin(result.data.utilizador);
      } catch (error) {
        setStatus(status, "Servidor indisponível. Inicie o site com: node server.js", "error");
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = "Entrar";
        }
      }
    });
  }

  /* ---------- REGISTO ---------- */
  var registerForm = document.getElementById("form-registo");
  if (registerForm) {
    registerForm.addEventListener("submit", async function (event) {
      event.preventDefault();

      var status = document.getElementById("status");
      var nome = registerForm.nome.value.trim();
      var email = registerForm.email.value.trim();
      var senha = registerForm.senha.value;
      var confirmar = registerForm.confirmar.value;

      if (nome.length < 2) {
        setStatus(status, "Informe o seu nome.", "error");
        registerForm.nome.focus();
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setStatus(status, "Informe um e-mail válido.", "error");
        registerForm.email.focus();
        return;
      }
      if (senha.length < 6) {
        setStatus(status, "A senha precisa ter pelo menos 6 caracteres.", "error");
        registerForm.senha.focus();
        return;
      }
      if (senha !== confirmar) {
        setStatus(status, "As senhas não coincidem.", "error");
        registerForm.confirmar.focus();
        return;
      }

      var button = registerForm.querySelector("button[type='submit']");
      if (button) {
        button.disabled = true;
        button.textContent = "Criando conta...";
      }

      try {
        var result = await api("/api/registo", { nome: nome, email: email, senha: senha });

        if (!result.ok) {
          setStatus(status, (result.data && result.data.erro) || "Não foi possível criar a conta.", "error");
          return;
        }

        setStatus(status, "Conta criada! Entrando…", "ok");
        redirectAfterLogin(result.data.utilizador);
      } catch (error) {
        setStatus(status, "Servidor indisponível. Inicie o site com: node server.js", "error");
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = "Criar conta";
        }
      }
    });
  }

  /* ---------- ESQUECI A SENHA ---------- */
  var forgotForm = document.getElementById("form-esqueci");
  if (forgotForm) {
    forgotForm.addEventListener("submit", async function (event) {
      event.preventDefault();

      var status = document.getElementById("status");
      var demoBox = document.getElementById("demo-link");
      var email = forgotForm.email.value.trim();

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setStatus(status, "Informe um e-mail válido.", "error");
        forgotForm.email.focus();
        return;
      }

      var button = forgotForm.querySelector("button[type='submit']");
      if (button) {
        button.disabled = true;
        button.textContent = "Gerando...";
      }

      try {
        var result = await api("/api/esqueci", { email: email });

        if (!result.ok) {
          setStatus(status, (result.data && result.data.erro) || "Não foi possível gerar o link.", "error");
          return;
        }

        setStatus(status, result.data.mensagem || "Pedido registado.", "ok");

        if (demoBox) {
          demoBox.hidden = true;
          demoBox.textContent = "";
          if (result.data.demoLink) {
            var link = document.createElement("a");
            link.href = result.data.demoLink;
            link.textContent = "Abrir link para redefinir a senha →";
            demoBox.appendChild(link);
            demoBox.hidden = false;
          }
        }
      } catch (error) {
        setStatus(status, "Servidor indisponível. Inicie o site com: node server.js", "error");
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = "Gerar link de recuperação";
        }
      }
    });
  }

  /* ---------- REDEFINIR SENHA ---------- */
  var resetForm = document.getElementById("form-redefinir");
  if (resetForm) {
    var token = params.get("token");
    var resetStatus = document.getElementById("status");

    if (!token) {
      setStatus(resetStatus, "Link inválido ou incompleto. Solicite um novo em “Esqueci a senha”.", "error");
      var blockedButton = resetForm.querySelector("button[type='submit']");
      if (blockedButton) blockedButton.disabled = true;
    }

    resetForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (!token) return;

      var senha = resetForm.senha.value;
      var confirmar = resetForm.confirmar.value;

      if (senha.length < 6) {
        setStatus(resetStatus, "A senha precisa ter pelo menos 6 caracteres.", "error");
        resetForm.senha.focus();
        return;
      }
      if (senha !== confirmar) {
        setStatus(resetStatus, "As senhas não coincidem.", "error");
        resetForm.confirmar.focus();
        return;
      }

      var button = resetForm.querySelector("button[type='submit']");
      if (button) {
        button.disabled = true;
        button.textContent = "Salvando...";
      }

      try {
        var result = await api("/api/redefinir", { token: token, senha: senha });

        if (!result.ok) {
          setStatus(resetStatus, (result.data && result.data.erro) || "Não foi possível salvar a senha.", "error");
          return;
        }

        setStatus(resetStatus, "Senha alterada! Redirecionando para o login…", "ok");
        window.setTimeout(function () {
          window.location.replace("login.html");
        }, 1400);
      } catch (error) {
        setStatus(resetStatus, "Servidor indisponível. Inicie o site com: node server.js", "error");
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = "Salvar nova senha";
        }
      }
    });
  }

  /* ---------- Preenche dados do utilizador ---------- */
  function fillUser(user) {
    $all("[data-user]").forEach(function (element) {
      var key = element.getAttribute("data-user");

      if (key === "role") {
        element.textContent = user.role === "admin" ? "Administrador" : "Cliente";
        element.classList.add("badge", user.role === "admin" ? "admin" : "cliente");
        return;
      }

      if (key === "criadoEm") {
        element.textContent = formatDate(user.criadoEm);
        return;
      }

      element.textContent = user[key] || "—";
    });

    var avatar = document.getElementById("avatar");
    if (avatar) avatar.textContent = initials(user.nome);
  }

  /* ---------- Painel admin ---------- */
  async function loadAdmin() {
    var tbody = document.getElementById("tabela-corpo");

    try {
      var result = await api("/api/admin/utilizadores");
      if (!result.ok) throw new Error((result.data && result.data.erro) || "Falha ao carregar.");

      var stats = result.data.estatisticas || {};
      setNumber("stat-total", stats.total);
      setNumber("stat-clientes", stats.clientes);
      setNumber("stat-admins", stats.administradores);
      setNumber("stat-mensagens", stats.mensagens);

      if (tbody) {
        var rows = (result.data.utilizadores || []).map(function (user) {
          return (
            "<tr>" +
            "<td>" + esc(user.nome) + "</td>" +
            "<td>" + esc(user.email) + "</td>" +
            "<td>" + (user.utilizador ? esc(user.utilizador) : "—") + "</td>" +
            '<td><span class="badge ' + (user.role === "admin" ? "admin" : "cliente") + '">' +
              (user.role === "admin" ? "Administrador" : "Cliente") +
            "</span></td>" +
            "<td>" + esc(formatDate(user.criadoEm)) + "</td>" +
            "</tr>"
          );
        });

        tbody.innerHTML = rows.length
          ? rows.join("")
          : '<tr><td colspan="5" class="table-empty">Nenhum utilizador encontrado.</td></tr>';
      }

      var messages = await api("/api/admin/mensagens");
      renderMessages(messages.ok ? messages.data.mensagens : []);
    } catch (error) {
      if (tbody) {
        tbody.innerHTML =
          '<tr><td colspan="5" class="table-empty">Não foi possível carregar os dados.</td></tr>';
      }
      renderMessages([]);
    }
  }

  function setNumber(id, value) {
    var element = document.getElementById(id);
    if (element) element.textContent = typeof value === "number" ? String(value) : "—";
  }

  function renderMessages(list) {
    var container = document.getElementById("mensagens");
    if (!container) return;

    if (!list || !list.length) {
      container.innerHTML = '<p class="table-empty">Nenhuma mensagem recebida ainda.</p>';
      return;
    }

    container.innerHTML = list
      .map(function (message) {
        return (
          '<article class="message-card">' +
          "<header>" +
          "<strong>" + esc(message.nome) + "</strong>" +
          '<span class="message-meta">' + esc(formatDateTime(message.criadoEm)) + "</span>" +
          "</header>" +
          '<p class="message-meta">' + esc(message.email) +
            (message.telefone ? " · " + esc(message.telefone) : "") + "</p>" +
          "<p>" + esc(message.mensagem) + "</p>" +
          "</article>"
        );
      })
      .join("");
  }

  /* ---------- Guarda de páginas protegidas ---------- */
  var guard = document.querySelector("[data-require]");
  if (guard) {
    var requiredRole = guard.getAttribute("data-require");

    api("/api/me")
      .then(function (result) {
        var user = result.data && result.data.autenticado ? result.data.utilizador : null;

        if (!user) {
          var next = encodeURIComponent(window.location.pathname + window.location.search);
          window.location.replace("login.html?next=" + next);
          return;
        }

        if (requiredRole === "admin" && user.role !== "admin") {
          window.location.replace("conta.html");
          return;
        }

        fillUser(user);

        if (user.role === "admin") {
          $all("[data-admin-only]").forEach(function (element) {
            element.hidden = false;
          });
        }

        if (document.getElementById("tabela-corpo")) loadAdmin();
      })
      .catch(function () {
        window.location.replace("login.html");
      });
  }

  bindLogout();
})();
