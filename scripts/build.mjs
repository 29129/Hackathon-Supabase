import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptsDirectory, '..');
const outputDirectory = resolve(projectDirectory, 'dist');

if (dirname(outputDirectory) !== projectDirectory) {
  throw new Error('El directorio de salida no es seguro.');
}

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });

for (const file of ['index.html', 'app.js', 'styles.css']) {
  cpSync(join(projectDirectory, file), join(outputDirectory, file));
}
cpSync(join(projectDirectory, 'assets'), join(outputDirectory, 'assets'), { recursive: true });

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY?.trim();
const localConfigPath = join(projectDirectory, 'config.js');
const outputConfigPath = join(outputDirectory, 'config.js');

if (supabaseUrl && supabaseAnonKey) {
  const parsedUrl = new URL(supabaseUrl);
  if (parsedUrl.protocol !== 'https:') throw new Error('SUPABASE_URL debe utilizar HTTPS.');
  const generatedConfig = `window.SUPABASE_CONFIG = ${JSON.stringify({ url: supabaseUrl, anonKey: supabaseAnonKey }, null, 2)};\n`;
  writeFileSync(outputConfigPath, generatedConfig, 'utf8');
} else if (!process.env.VERCEL && existsSync(localConfigPath)) {
  writeFileSync(outputConfigPath, readFileSync(localConfigPath, 'utf8'), 'utf8');
} else {
  throw new Error('Configura SUPABASE_URL y SUPABASE_ANON_KEY en Vercel antes de desplegar.');
}

console.log('AulaSegura compilada en dist/.');
