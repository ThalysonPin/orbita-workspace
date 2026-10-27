# Configurar integrações pelo painel

Abra **Integrações**, escolha a empresa e clique em **Configurar**. Preencha os campos da ferramenta e use **Testar conexão** para verificar o acesso. Depois, salve a integração. A configuração fica disponível em outros dispositivos após entrar na mesma conta do painel.

**Salvar** guarda as credenciais; **Testar** consulta a ferramenta sem alterar sua configuração salva. Um teste que falhou não deve ser interpretado como uma conta conectada. **Desconectar** remove a configuração do Órbita; para revogar o token ou a autorização na ferramenta de origem, use também as configurações dessa ferramenta.

## Google Calendar

O modo recomendado usa autorização pelo Google:

1. Crie ou escolha um cliente OAuth do tipo **Aplicativo da Web** no Google Cloud Console e habilite a API Google Calendar.
2. Cadastre a URL de retorno exibida no próprio formulário do Órbita como URI de redirecionamento autorizada. Em produção, ela termina em `/api/integrations/google/callback`.
3. Informe o ID do cliente, o segredo do cliente e o ID da agenda (`primary` para a agenda principal).
4. Clique em **Autorizar com Google**, escolha a conta desejada e conceda a leitura da agenda. Ao retornar ao painel, a conexão é salva automaticamente.

Repita por empresa/conta. As regras de consentimento e aprovação do administrador do Google Workspace continuam sendo aplicadas. Aplicativos OAuth externos em modo de teste podem receber refresh tokens de curta duração; configure a publicação do aplicativo no Google conforme seu uso.

O modo manual aceita um **access token**, que é temporário, ou um **refresh token** acompanhado do ID e segredo do cliente. Trocar de modo remove as credenciais incompatíveis com o novo modo.

Referência: [OAuth para aplicativos Web do Google](https://developers.google.com/identity/protocols/oauth2/web-server), [Google Calendar API](https://developers.google.com/calendar/api/guides/overview).

## ClickUp

Informe o token da conta e o ID do workspace. O campo de responsável é opcional; sem ele, a sincronização procura as tarefas atribuídas ao usuário do token. Cada empresa usa sua própria conexão.

O token pessoal pode ser criado em Apps nas configurações do ClickUp. Ele pode ter permissões amplas no serviço de origem; o Órbita só executa consultas de leitura.

Referência: [Autenticação do ClickUp](https://developer.clickup.com/docs/authentication).

## Slack

Informe o token de um bot autorizado (`xoxb-...`) e os IDs dos canais permitidos, separados por vírgula. Os nomes dos canais são opcionais e seguem a mesma ordem dos IDs.

O aplicativo precisa estar instalado no workspace e o bot deve participar dos canais. Os escopos dependem dos canais e recursos usados: `channels:history` para canais públicos, `groups:history` para privados e `users:read` para resolver nomes. A leitura pode sofrer limites de frequência definidos pelo Slack.

Referência: [Tokens do Slack](https://docs.slack.dev/authentication/tokens/), [Histórico dos canais](https://docs.slack.dev/reference/methods/conversations.history/).

## Discord

Informe o token de um **bot**, sem o prefixo `Bot`, o ID do servidor e os IDs dos canais permitidos. Para copiar IDs, habilite o modo de desenvolvedor no Discord. Os nomes dos canais são opcionais e seguem a ordem dos IDs.

O bot precisa de `View Channel` e `Read Message History`. O acesso ao texto pode exigir `Message Content Intent`. A integração não usa tokens de usuário ou automação de contas pessoais.

Referência: [Aplicativos e bots no Discord](https://discord.com/developers/docs/quick-start/getting-started), [Permissões](https://discord.com/developers/docs/topics/permissions).

## Proteção dos dados

- As configurações são isoladas pelo ID autenticado do usuário do painel.
- As credenciais são criptografadas no servidor com AES-256-GCM e guardadas no banco D1; não ficam no localStorage, nos arquivos de exportação nem no código publicado.
- Ao editar, campos secretos vazios mantêm o valor já salvo, dentro do mesmo modo de autenticação. O servidor não devolve o token ou segredo salvo.
- Os formulários enviam credenciais por requisições autenticadas ao próprio painel. O teste só envia cada credencial à API oficial correspondente.
- A autorização Google usa estado de uso único com expiração e PKCE. O código é trocado no servidor; tokens não aparecem na URL de retorno do painel.
- As integrações continuam sendo de leitura: o Órbita não envia mensagens nem altera tarefas ou eventos nos serviços externos.

## Implantação e desenvolvimento

A hospedagem declara o binding D1 `DB` em `.openai/hosting.json`. O esquema é versionado em `db/schema.ts` e `drizzle/`; as migrações são aplicadas pelo fluxo Sites na publicação.

A única configuração de infraestrutura é `ORBITA_CREDENTIALS_KEY`, uma chave aleatória de 32 bytes em Base64, registrada como segredo do runtime. Ela deve permanecer estável. Sua ausência ou uma falha de descriptografia interrompe a operação; o sistema não salva credenciais em texto puro como alternativa. Um desenvolvedor que roda a prévia local pode configurar uma chave independente em `.env.local`, que é ignorado pelo Git.

A antiga variável global `ORBITA_CONNECTIONS_JSON` não alimenta as novas conexões por usuário. Configure as contas no painel. O login simulado da prévia local serve apenas para desenvolvimento; a hospedagem exige identidade autenticada.

Os testes automatizados usam credenciais fictícias e respostas simuladas. Eles não comprovam autorização real em suas contas; use **Testar conexão** após configurar cada ferramenta.
