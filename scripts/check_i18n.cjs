/**
 * Compara las keys de los 3 diccionarios de traduccion.
 * Imprime que keys faltan en cada idioma.
 */
const fs = require('node:fs');
const path = require('node:path');

const file = path.resolve('C:/Users/jagua/Desktop/MeetNinja/src/i18n/translations.ts');
const src = fs.readFileSync(file, 'utf8');

// Extraer los 3 dicts: const es, const en, const pt
function extractDict(name) {
  // match "const <name>: Dict = { ... };" con balance de braces
  const start = src.indexOf(`const ${name}: Dict = {`);
  if (start < 0) return {};
  let i = src.indexOf('{', start);
  let depth = 0;
  const begin = i;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  const body = src.slice(begin, i + 1);
  // Sacar las keys: 'algo': valor
  const keys = new Set();
  const re = /'([^']+)'\s*:/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    keys.add(m[1]);
  }
  return keys;
}

const ks = extractDict('es');
const ke = extractDict('en');
const kp = extractDict('pt');

console.log(`es: ${ks.size} keys`);
console.log(`en: ${ke.size} keys`);
console.log(`pt: ${kp.size} keys`);

const all = new Set([...ks, ...ke, ...kp]);
const missing = {
  en: [],
  pt: [],
  es: [],
};
for (const k of all) {
  if (!ks.has(k)) missing.es.push(k);
  if (!ke.has(k)) missing.en.push(k);
  if (!kp.has(k)) missing.pt.push(k);
}
for (const lang of ['es', 'en', 'pt']) {
  if (missing[lang].length === 0) {
    console.log(`[${lang}] OK - sin keys faltantes`);
  } else {
    console.log(`[${lang}] FALTAN ${missing[lang].length} keys:`);
    for (const k of missing[lang]) console.log(`   - ${k}`);
  }
}

// Keys duplicadas dentro de un mismo dict
function findDuplicates(name) {
  const start = src.indexOf(`const ${name}: Dict = {`);
  let i = src.indexOf('{', start);
  let depth = 0;
  const begin = i;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  const body = src.slice(begin, i + 1);
  const re = /'([^']+)'\s*:/g;
  const seen = new Map();
  let m;
  while ((m = re.exec(body)) !== null) {
    seen.set(m[1], (seen.get(m[1]) || 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1);
}

for (const lang of ['es', 'en', 'pt']) {
  const dups = findDuplicates(lang);
  if (dups.length === 0) {
    console.log(`[${lang}] sin keys duplicadas`);
  } else {
    console.log(`[${lang}] DUPLICADAS:`);
    for (const [k, n] of dups) console.log(`   - ${k} (x${n})`);
  }
}
