import { createClient } from '@supabase/supabase-js';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

// Run locally with server-only environment variables. Nothing is written to disk.
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Configure SUPABASE_URL e SUPABASE_SECRET_KEY apenas no ambiente local. Consulte docs/GITHUB-PAGES.md.');
  process.exit(1);
}
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) {
  console.error('SUPABASE_URL deve ser a URL HTTPS oficial do seu projeto Supabase.');
  process.exit(1);
}
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Execute em um terminal interativo para informar a senha com a entrada oculta.');
  process.exit(1);
}
let muted = false;
const output = new Writable({ write(chunk, encoding, done) { if (!muted) process.stdout.write(chunk, encoding); done(); } });
const prompt = createInterface({ input: process.stdin, output, terminal: true });
let password = '';
try {
  const email = (await prompt.question('E-mail do proprietário: ')).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Informe um e-mail válido.');
  process.stdout.write('Senha do novo usuário (entrada oculta): ');
  muted = true;
  password = await prompt.question('');
  muted = false;
  process.stdout.write('\nConfirme a senha (entrada oculta): ');
  muted = true;
  let confirmation = await prompt.question('');
  muted = false;
  process.stdout.write('\n');
  if (password !== confirmation) throw new Error('As senhas não coincidem.');
  confirmation = '';
  if (password.length < 8) throw new Error('Use uma senha com pelo menos 8 caracteres.');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await client.auth.admin.createUser({ email, password, email_confirm: true });
  password = '';
  if (error || !data.user) throw new Error('O Supabase não criou o usuário. Verifique os dados, as regras de senha e se a conta já existe no painel do projeto.');
  console.log(`Conta criada. Configure ORBITA_OWNER_ID nas secrets da Edge Function com este UUID: ${data.user.id}`);
} catch (error) {
  muted = false;
  console.error(error instanceof Error ? error.message : 'Não foi possível criar a conta.');
  process.exitCode = 1;
} finally {
  password = '';
  muted = false;
  prompt.close();
}
