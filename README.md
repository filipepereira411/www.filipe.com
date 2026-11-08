# www.filipe.com

Site institucional/loja com **área do cliente** e **painel do administrador**.
HTML, CSS e JavaScript puros no front-end + um servidor **Node.js sem dependências** para autenticação.

## Como rodar

Precisa do Node.js 18 ou superior (testado no Node 24).

```powershell
cd C:\Users\JCPereira\www.filipe.com
node server.js
```

Depois abra <http://localhost:3000>.

- Porta diferente: `$env:PORT=8080; node server.js` (ou `PORT=8080 node server.js` no Linux/macOS).
- Com recarregamento automático: `node --watch server.js`.
- `npm start` também funciona, se o npm estiver liberado no seu sistema.

> Abrir o `index.html` direto com duplo clique (`file://`) mostra o site, mas **login, registo e o
> formulário de contato precisam do servidor**.

## Contas e fluxos

| Perfil | Como entrar |
| --- | --- |
| **Administrador** | utilizador `admin`, senha `admin` |
| **Cliente** | cria a conta em `/registo.html` (ou o admin pode ser trocado por variáveis de ambiente) |

Fluxos implementados:

- **Registo** de cliente (`registo.html`) — nome, e-mail, senha (mín. 6) e confirmação.
- **Login** (`login.html`) — aceita e-mail **ou** utilizador; funciona para cliente e admin.
- **Logout** — botão "Sair" na conta e no painel; encerra a sessão no servidor e limpa o cookie.
- **Esqueci a senha** (`esqueci.html`) — gera um link de redefinição válido por 30 minutos.
- **Redefinir senha** (`redefinir.html?token=...`) — define nova senha e invalida sessões antigas.
- **Minha conta** (`conta.html`) — dados do cliente (protegida por sessão).
- **Painel admin** (`admin.html`) — estatísticas, lista de utilizadores e mensagens do formulário (só admin).

### Trocar as credenciais do admin

O admin é criado apenas na primeira execução (quando ainda não existe nenhum admin). Para definir
outra senha já na criação:

```powershell
$env:ADMIN_PASSWORD="umaSenhaForte"
$env:ADMIN_EMAIL="admin@seudominio.com"
node server.js
```

Se o admin já existir, apague `data/utilizadores.json` (ou edite o registo) para que seja recriado.
Também é possível alterar a senha do admin pelo fluxo "Esqueci a senha".

## Estrutura

```
www.filipe.com/
├── server.js            # servidor HTTP + API + arquivos estáticos
├── index.html           # site (hero, serviços, produtos, sobre, depoimentos, contato)
├── login.html           # entrar
├── registo.html         # criar conta
├── esqueci.html         # pedir link de recuperação
├── redefinir.html       # definir nova senha (recebe ?token=)
├── conta.html           # área do cliente
├── admin.html           # painel do administrador
├── css/
│   ├── styles.css       # tema e layout do site
│   └── auth.css         # telas de autenticação e painel
├── js/
│   ├── main.js          # menu, scrollspy, animações, contadores e contato
│   ├── auth.js          # formulários de auth, guardas de rota e painel
│   └── sessao.js        # troca "Entrar" por "Minha conta"/"Admin" no header
└── data/                # criado em tempo de execução (ignorado no git)
    ├── utilizadores.json
    ├── mensagens.json
    └── redefinicoes.json
```

## API

| Método | Rota | Acesso | Descrição |
| --- | --- | --- | --- |
| GET | `/api/me` | público | sessão atual |
| POST | `/api/registo` | público | cria cliente e já inicia sessão |
| POST | `/api/login` | público | `{ identificador, senha }` |
| POST | `/api/logout` | público | encerra sessão |
| POST | `/api/esqueci` | público | `{ email }` → devolve `demoLink` |
| POST | `/api/redefinir` | público | `{ token, senha }` |
| POST | `/api/contacto` | público | grava mensagem do formulário |
| GET | `/api/admin/utilizadores` | admin | lista + estatísticas |
| GET | `/api/admin/mensagens` | admin | mensagens recebidas |

## Segurança (leia)

- Senhas são guardadas com **scrypt + salt**; nunca em texto puro.
- Sessão em **cookie HttpOnly, SameSite=Lax**, com validade de 8 horas.
- Login tem limite de tentativas (8 falhas por IP em 10 minutos).
- `data/` não é servido publicamente; `server.js` e `package.json` também ficam bloqueados.
- **Modo demonstração:** como não há envio de e-mail, o link de recuperação aparece na tela e no
  terminal. Em produção, envie esse link por e-mail e remova o `demoLink` da resposta.
- A senha `admin`/`admin` é só para demonstração — **troque antes de publicar**.
- Para produção, rode atrás de HTTPS (proxy reverso como Caddy/Nginx) e defina
  `NODE_ENV=production`/credenciais fortes.

## Publicar

O site deixou de ser 100% estático: precisa de um host com **Node.js** (Render, Railway, Fly.io,
VPS etc.). Netlify/Vercel só com adaptação para funções serverless (o armazenamento em JSON local
não persiste nesses ambientes).

> O domínio `www.filipe.com` precisa ser registado/possuído por você; o apontamento DNS é feito
> no painel do provedor ou da hospedagem.
