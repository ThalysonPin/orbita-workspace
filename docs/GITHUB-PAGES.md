# Publicar no GitHub Pages e ativar o Supabase

## Responsabilidades

O Pages hospeda a interface estática. O Supabase autentica o usuário, guarda configurações criptografadas e executa as chamadas das integrações. Criar o repositório ou publicar a página não cria automaticamente um projeto Supabase ou uma conta de acesso.

Não coloque a senha no código, em variáveis `VITE_`, em arquivos versionados ou nos logs. A senha é gerenciada pelo Supabase Auth. As chaves públicas identificam o projeto; não substituem o login nem concedem acesso às credenciais das integrações.

## 1. Preparar o projeto Supabase

Crie ou selecione um projeto na sua conta Supabase. Em **Authentication → Providers**, mantenha Email habilitado. Nas configurações de autenticação, desabilite o cadastro de novos usuários: este painel permite somente a conta do proprietário.

Em **Authentication → URL Configuration**:

- **Site URL:** `https://thalysonpin.github.io/orbita-workspace/`, ou a URL efetiva mostrada pelo Pages.
- **Redirect URLs:** adicione a mesma URL exata e `https://thalysonpin.github.io/orbita-workspace/?auth=recovery` para recuperação de senha. Não use curingas amplos.
- Para testes locais, adicione a URL e o caminho informados pelo servidor local, incluindo a variação `?auth=recovery`.

Configure o envio de e-mail do Auth para que a recuperação de senha funcione fora de testes. As restrições e os limites dependem da configuração SMTP do seu projeto.

Anote a URL do projeto e sua **publishable key** nas configurações de API. A chave `sb_publishable_…` pode ir para o frontend. Chaves `sb_secret_…` ou `service_role` são administrativas e ficam exclusivamente no servidor ou no ambiente local de administração.

## 2. Criar a conta do proprietário

Use **Authentication → Users → Add user** no Supabase para criar a conta com o seu e-mail e uma senha. Confirme o e-mail pelo mecanismo administrativo disponível ou pelo fluxo configurado. Copie o UUID do usuário criado.

Alternativamente, use o helper local. Carregue `SUPABASE_URL` e `SUPABASE_SECRET_KEY` de um arquivo local ignorado pelo Git. Não digite chaves ou senha na linha de comando nem no histórico do terminal:

```sh
node --env-file=.env.local scripts/create-owner.mjs
```

Ele pede e-mail e senha em um terminal interativo, oculta a entrada da senha e não grava credenciais. O resultado informa o UUID para configurar no servidor. O helper cria uma conta nova; não altera a senha de uma conta existente. A chave administrativa pode ser removida do ambiente local após concluir a administração.

## 3. Banco e Edge Function

Instale a [CLI oficial do Supabase](https://supabase.com/docs/guides/local-development/cli/getting-started), autentique-se e vincule o projeto. Execute na raiz do repositório:

```sh
npm ci --ignore-scripts
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase db push
npm run build:supabase
```

A migração cria as tabelas com RLS e sem acesso direto para `anon` ou `authenticated`. A Edge Function valida o token com o Auth e compara o UUID ao proprietário autorizado antes de acessar os registros. O cliente não escolhe o proprietário.

Em **Edge Functions → Secrets**, configure:

| Nome | Conteúdo |
| --- | --- |
| `ORBITA_OWNER_ID` | UUID exato da conta do proprietário criada no Auth |
| `ORBITA_ALLOWED_ORIGIN` | Origem do frontend, como `https://thalysonpin.github.io`, sem caminho nem barra final |
| `ORBITA_APP_URL` | URL completa do painel, como `https://thalysonpin.github.io/orbita-workspace/` |
| `ORBITA_CREDENTIALS_KEY` | Chave aleatória estável de 32 bytes em Base64, somente no servidor |

O Supabase disponibiliza suas próprias variáveis de projeto às funções. O código aceita `SUPABASE_PUBLISHABLE_KEYS` e `SUPABASE_SECRET_KEYS` no formato JSON com propriedade `default`, as variáveis singulares e as legadas `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`. Overrides opcionais: `ORBITA_SUPABASE_PUBLISHABLE_KEY` e `ORBITA_SUPABASE_SECRET_KEY`. `SUPABASE_URL` também precisa estar disponível no runtime.

### Alternativa: configuração protegida pelo Vault

Quando não houver acesso à configuração de secrets da Edge Function, a segunda migração permite preparar a instalação pelo SQL Editor administrativo. Depois de criar o usuário no Auth, execute com o UUID real e suas URLs:

```sql
select public.orbita_provision_runtime_configuration(
  'UUID_DO_USUARIO'::uuid,
  'https://thalysonpin.github.io',
  'https://thalysonpin.github.io/orbita-workspace/'
);
```

Essa operação gera uma chave aleatória dentro do Vault e não a retorna. Reexecutar com o mesmo proprietário permite atualizar as URLs sem rotacionar a chave. Trocar o proprietário exige uma migração explícita. A API completa somente as variáveis `ORBITA_*` ausentes, consultando uma RPC reservada a `service_role`; variáveis já configuradas no ambiente têm prioridade.

Não execute nem publique o resultado de `orbita_runtime_configuration()`: essa RPC entrega a chave descriptografada apenas ao backend. Usuários anônimos e autenticados não têm permissão de execução nem acesso à tabela de configuração. A presença de RLS sem políticas nessas tabelas é intencional, pois o navegador não deve acessá-las diretamente.

Gere uma chave de criptografia independente da publicação Sites e armazene-a como segredo. **Não substitua essa chave enquanto houver configurações criptografadas**, pois isso impede sua leitura. Nunca copie essa chave para `VITE_`, variáveis públicas do GitHub ou código do navegador.

Publique a função:

```sh
supabase functions deploy orbita-api
```

`supabase/config.toml` desabilita a verificação automática de JWT para permitir o callback Google, que chega sem sessão do navegador. As demais rotas exigem validação explícita no handler; essa checagem precisa ser preservada.

O callback Google é:

```text
https://SEU_PROJECT_REF.supabase.co/functions/v1/orbita-api/integrations/google/callback
```

Adicione essa URL exata ao cliente OAuth no Google Cloud e informe cliente/segredo pelo formulário **Integrações** do Órbita. Também é possível usar o modo de tokens. ClickUp, Slack e Discord são configurados no próprio painel. Consulte o [guia das integrações](INTEGRATIONS.md); a callback desta versão substitui a callback Sites nos exemplos daquele guia.

## 4. Publicar a interface

No repositório GitHub:

1. Em **Settings → Pages**, selecione **GitHub Actions** como origem. O plano deve permitir Pages na visibilidade escolhida.
2. Em **Settings → Secrets and variables → Actions → Variables**, adicione `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`. São os dados públicos do projeto, não a chave administrativa.
3. Execute **Actions → Publicar Órbita no GitHub Pages → Run workflow**, ou envie uma alteração à branch `main`.
4. Aguarde a conclusão e abra o endereço informado pela publicação.

O workflow deriva o caminho automaticamente, verifica o projeto e publica exclusivamente `dist-pages`. Sem as duas variáveis Supabase, o site mostra **Configuração pendente** e não libera o formulário de acesso.

## 5. Automação opcional da API

O workflow **Publicar API no Supabase** é manual. Para usá-lo, crie o ambiente GitHub `supabase-production`, preferencialmente com revisão de implantação, e configure nele:

- Variável `SUPABASE_PROJECT_REF`.
- Secrets `SUPABASE_ACCESS_TOKEN` e `SUPABASE_DB_PASSWORD`.

As secrets `ORBITA_*` ficam no Supabase. A automação vincula o projeto, aplica migrações e publica a função. A publicação do Pages não executa migrações e não precisa de chave administrativa.

## 6. Verificar o acesso

- Entre com a conta criada e confira se o painel aparece.
- Saia e confirme que o painel não reaparece ao voltar pelo navegador.
- Outra conta Supabase deve ser recusada pela API, mesmo que o Auth aceite o login.
- Teste recuperação de senha com um e-mail que você controla.
- Salve e teste uma integração e confira a conexão depois de atualizar a página.
- Requisições sem token devem receber `401`; outro usuário, `403`. As respostas de configuração não devem conter tokens.

O frontend guarda a sessão na `sessionStorage` da aba, pelo SDK Supabase. Tarefas pessoais e preferências locais usam uma chave separada pelo UUID e continuam disponíveis no próximo acesso dessa conta. Os eventos e as mensagens sincronizadas são removidos da interface ao sair. Não há senha em `localStorage` ou `sessionStorage`.

## Diferenças em relação a Sites

Sites usa identidade ChatGPT, D1 e sua própria chave de criptografia. A versão Pages usa Supabase Auth, Postgres e uma chave independente. Os tokens do Site anterior não são publicados no GitHub e precisam ser configurados novamente. A publicação anterior permanece independente.

Referências: [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [autenticação com senha](https://supabase.com/docs/guides/auth/passwords), [funções](https://supabase.com/docs/guides/functions/deploy), [chaves de API](https://supabase.com/docs/guides/getting-started/api-keys), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
