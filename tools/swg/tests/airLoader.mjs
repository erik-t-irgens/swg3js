// The off-proof's module hooks (the volumetrics design's §4.0): registered with `module.register` by `airOff.test.ts`
// alone, never by any other suite, whose plain type stripping stays the rule they are held to.
//
// Inside its roots -- the tree checked out of the commit before the volumetrics pass, and today's `src/` -- it resolves
// an extensionless relative import to its `.ts` (or a folder's `index.ts`), and transpiles every `.ts` with the
// repository's own TypeScript (`ts.transpileModule`, which takes the parameter properties and the extensionless
// imports node's own stripping refuses). Nothing of one tree ever resolves into the other: a relative import resolves
// beside the file that made it. Outside the roots (three, node's own modules) node resolves and loads as it always does.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

/** The roots' file URLs, each ending in a slash. */
let roots = [];
/** Where a bare package (three) is resolved from: the repository's own `node_modules`, the same for both trees. */
let packageBase = null;

export async function initialize(data) {
  roots = (data?.roots ?? []).map((r) => {
    const href = pathToFileURL(r).href;
    return href.endsWith('/') ? href : `${href}/`;
  });
  packageBase = data?.packageBase ? pathToFileURL(data.packageBase).href : null;
}

const under = (url) => typeof url === 'string' && roots.some((r) => url.startsWith(r));
const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

export async function resolve(specifier, context, next) {
  const parent = context.parentURL;
  if (under(parent) && (specifier.startsWith('./') || specifier.startsWith('../'))) {
    const url = new URL(specifier, parent);
    const path = fileURLToPath(url);
    if (!isFile(path)) {
      for (const tail of ['.ts', '/index.ts', '.js']) {
        const cand = `${path}${tail}`;
        if (existsSync(cand) && isFile(cand)) return { url: pathToFileURL(cand).href, shortCircuit: true };
      }
    } else return { url: url.href, shortCircuit: true };
  }
  // A package by name, from a file of either tree: the repository's own copy (the tree out of git has no node_modules).
  if (under(parent) && packageBase && !specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('node:') && !specifier.includes(':')) {
    return next(specifier, { ...context, parentURL: packageBase });
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (under(url) && url.endsWith('.ts')) {
    const fileName = fileURLToPath(url);
    const text = readFileSync(fileName, 'utf8');
    const out = ts.transpileModule(text, {
      fileName,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        useDefineForClassFields: true,
        allowImportingTsExtensions: true,
        isolatedModules: true,
        esModuleInterop: true,
        sourceMap: false,
      },
    });
    return { format: 'module', source: out.outputText, shortCircuit: true };
  }
  if (under(url) && url.endsWith('.json')) {
    return { format: 'json', source: readFileSync(fileURLToPath(url), 'utf8'), shortCircuit: true };
  }
  return next(url, context);
}
