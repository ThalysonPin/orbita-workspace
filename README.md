# Órbita

Painel pessoal para organizar o trabalho em três empresas: agenda, tarefas e mensagens numa única interface. A versão para **GitHub Pages** usa React/Vite na interface e **Supabase Auth + Edge Functions + Postgres** para login com e-mail e senha e integrações protegidas. A implementação anterior de Sites também está preservada.

## GitHub Pages + login com senha

Siga o [guia de publicação e ativação](docs/GITHUB-PAGES.md) para conectar um projeto Supabase, criar a conta do proprietário e publicar a API. Sem as variáveis Supabase, a página mostra **Configuração pendente** e não aceita credenciais. Nenhuma conta ou senha é distribuída neste repositório.

- Entrada, saída e recuperação de senha pelo Supabase, sem cadastro público.
- Sessão limitada à aba e dados locais separados pelo UUID da conta.
- Interface estática no Pages; chamadas das integrações e criptografia executadas na Edge Function.
- Backend restrito ao proprietário e à origem configurados, com tabelas protegidas por RLS.
- Publicação automática da interface e publicação manual da API via GitHub Actions.

```sh
npm ci --ignore-scripts
cp .env.example .env.local
# Preencha somente as variáveis públicas VITE_SUPABASE_* para o frontend.
npm run dev:pages
```

```sh
npm run typecheck
npm test
npm run build:pages
npm run build:supabase
```

`VITE_BASE_PATH` define o caminho no Pages, por exemplo `/orbita-workspace/`. Variáveis `VITE_` são públicas: nunca use uma chave administrativa nesses campos. `npm run preview:pages` serve o build estático local.

O workflow **Publicar Órbita no GitHub Pages** publica somente `dist-pages`. O workflow **Publicar API no Supabase** é manual. O recurso Pages precisa estar disponível no plano e na visibilidade do repositório.

| Caminho | Responsabilidade |
| --- | --- |
| `pages/` | Aplicação estática e telas de acesso Supabase |
| `lib/workspace-api.ts` | Transporte compartilhado Sites / Supabase |
| `lib/integration-crypto.ts` | Criptografia AES-GCM |
| `supabase/functions/orbita-api/` | API autenticada e armazenamento Postgres |
| `supabase/migrations/` | Tabelas, RLS e operações OAuth transacionais |
| `scripts/create-owner.mjs` | Criação local da conta com senha oculta |
| `.github/workflows/` | Publicação da interface e API |

O build da API gera `index.ts` e `bundle.mjs` antes da publicação. Segredos de runtime, bancos locais e arquivos `.env*` ficam fora do Git; `.env.example` contém somente campos vazios e exemplos de caminhos. O banco, os usuários e as configurações da implementação Sites são independentes do Supabase e não são migrados automaticamente.

## O que funciona

- Visão geral e filtros por empresa; navegação entre agenda, tarefas, mensagens e integrações.
- Criação de tarefas pessoais, busca, marcação de mensagens como lidas e conversão de mensagens em tarefas.
- Edição dos nomes das empresas, exportação dos dados locais e temporizador de foco.
- Demonstração interativa com dados fictícios explicitamente identificados.
- Adaptadores de leitura para Google Calendar, ClickUp, Slack e Discord, executados apenas no servidor, mediante configuração das contas.
- Formulários para configurar, testar, editar e desconectar integrações diretamente no painel.
- Autorização Google com retorno ao painel e credenciais criptografadas por usuário: Postgres no Supabase e D1 na implementação Sites.

No GitHub Pages, o painel começa vazio após o login; a implementação Sites oferece **modo demonstração** com exemplos identificados. Abra **Integrações → Configurar** para fornecer as credenciais e os canais permitidos, testar a conexão e salvar. As configurações ficam criptografadas no servidor e são isoladas pela sua identidade autenticada. Consulte [a configuração do Pages](docs/GITHUB-PAGES.md) ou [o guia das integrações Sites](docs/INTEGRATIONS.md). Os adaptadores leem informações; a interface não envia mensagens nem altera tarefas nos serviços externos.

No Pages, a sessão usa `sessionStorage` da aba, sem armazenar a senha. Tarefas pessoais e preferências usam `localStorage` em uma chave separada pelo UUID da conta e permanecem disponíveis para essa conta após sair. Eventos e mensagens sincronizados ficam em memória e são removidos da interface ao sair ou trocar de conta; os corpos desses dados reais não são persistidos no navegador.

## Executar a implementação Sites

Requer Node.js 22.13 ou superior.

```sh
npm run install:ci
npm run dev
```

O terminal informa a URL local. Para a prévia, configure uma chave de criptografia independente em `.env.local`, seguindo `.env.example`, e aplique as migrações D1 locais. Não adicione credenciais ao Git. Os tokens dos provedores são cadastrados na interface. O modo de desenvolvimento usa a identidade local de teste do starter Sites. A publicação privada exige autenticação do proprietário.

## Verificar

```sh
npm run typecheck
npm test
npm run build
```

Os testes dos adaptadores usam respostas simuladas das APIs. Eles verificam transformação dos dados, paginação, validação e tratamento de falhas; não comprovam autorização das suas contas. As conexões reais precisam ser verificadas depois da configuração.

## Estrutura

- `components/workspace-dashboard.tsx`: interface e ações locais.
- `lib/workspace-types.ts`: modelo comum das quatro fontes.
- `lib/demo-data.ts`: exemplos fictícios com datas relativas.
- `lib/provider-sync.ts`: leitura das APIs e normalização.
- `lib/integration-store.ts`: configurações criptografadas por usuário.
- `lib/integration-oauth.ts`: autorização Google e estado de uso único.
- `components/integration-settings-form.tsx`: formulários das conexões.
- `app/api/integrations`: configuração, testes e autorização das contas.
- `app/api/workspace`: estado das conexões, sem credenciais na resposta.
- `app/api/sync`: sincronização autenticada, sem escrita externa.
- `.openai/hosting.json`: identidade e configuração da publicação privada.

As configurações no D1 são isoladas pela identidade ChatGPT; no Supabase, pela identidade validada no Auth. A chave de criptografia é um segredo estável de cada instalação e não deve ser substituída enquanto houver registros criptografados.
