/* ==========================================================================
   Filipe — link de conta no header da página inicial
   Consulta a sessão e troca "Entrar" por "Minha conta"/"Admin" quando logado.
   ========================================================================== */

(function () {
  "use strict";

  var link = document.getElementById("nav-conta");
  if (!link) return;

  fetch("/api/me", { credentials: "same-origin" })
    .then(function (response) {
      return response.json();
    })
    .then(function (data) {
      if (!data || !data.autenticado || !data.utilizador) return;

      var user = data.utilizador;
      if (user.role === "admin") {
        link.textContent = "Admin";
        link.href = "admin.html";
      } else {
        link.textContent = "Minha conta";
        link.href = "conta.html";
      }
    })
    .catch(function () {
      /* Sem servidor: mantém o link "Entrar". */
    });
})();
