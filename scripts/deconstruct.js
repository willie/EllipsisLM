#!/usr/bin/env node
/**
 * deconstruct.js
 *
 * Extracts JavaScript modules from the monolithic index.html into separate files
 * for the modular directory structure.
 *
 * Usage: node scripts/deconstruct.js [--dry-run]
 *
 * Approach: Find module starts (const X = {) and ends (};) by line pattern,
 * then pair them sequentially.
 */

const fs = require('fs');
const path = require('path');

// Configuration: maps module names to their output files
const MODULE_MAP = {
    // Core utilities
    'DOM': 'js/services/utility.js',
    'ActionHandler': 'js/services/utility.js',
    'UTILITY': 'js/services/utility.js',

    // Data services
    'DBService': 'js/services/db-service.js',
    'StoryService': 'js/services/story-service.js',
    'StateManager': 'js/services/state-manager.js',
    'ReactiveStore': 'js/services/state-manager.js',

    // API services
    'APIService': 'js/services/api-service.js',
    'ModalManager': 'js/services/api-service.js',
    'PromptBuilder': 'js/services/prompt-builder.js',
    'ImageProcessor': 'js/services/image-processor.js',
    'ImportExportService': 'js/services/import-export-service.js',

    // UI layer
    'UIComponents': 'js/ui/ui-manager.js',
    'UIManager': 'js/ui/ui-manager.js',

    // Controllers
    'AppController': 'js/controller.js',
    'LibraryController': 'js/controller.js',
    'NarrativeController': 'js/controller.js',
    'WorldController': 'js/controller.js',
    'ActionDispatcher': 'js/controller.js',

    // App entry point
    'app': 'js/app.js',
};

const ROOT_DIR = path.join(__dirname, '..');
const INDEX_PATH = path.join(ROOT_DIR, 'index.html');
const MODULAR_DIR = path.join(ROOT_DIR, 'modular');

const DRY_RUN = process.argv.includes('--dry-run');

// Script load order (must match module dependencies) - same as reconstruct.js
const JS_FILES = [
    'js/preamble.js',              // APP_BUILD_TIMESTAMP, debounce
    'js/services/utility.js',
    'js/services/db-service.js',
    'js/services/story-service.js',
    'js/services/state-manager.js',
    'js/services/api-service.js',
    'js/services/prompt-builder.js',
    'js/services/image-processor.js',
    'js/services/import-export-service.js',
    'js/ui/ui-manager.js',
    'js/controller.js',
    'js/app.js',
];

// Set of module names we care about
const TARGET_MODULES = new Set(Object.keys(MODULE_MAP));

// Preamble output file
const PREAMBLE_FILE = 'js/preamble.js';

function extractPreamble(lines) {
    // Find the <script> tag and the first module (DOM)
    let scriptStart = -1;
    let firstModuleLine = -1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('<script>') && scriptStart === -1) {
            scriptStart = i;
        }
        if (scriptStart !== -1 && line.match(/^\s*const\s+DOM\s*=\s*\{/)) {
            firstModuleLine = i;
            break;
        }
    }

    if (scriptStart === -1 || firstModuleLine === -1) {
        return null;
    }

    // Extract content between <script> and first module
    const preambleLines = lines.slice(scriptStart + 1, firstModuleLine);
    let preambleContent = preambleLines.join('\n').trim();

    // Also find standalone functions/variables between modules
    // Look for 'const debounce' specifically (it's between ActionHandler and DBService)
    for (let i = firstModuleLine; i < lines.length; i++) {
        const line = lines[i];
        // Match standalone const declarations that are not module objects
        const standaloneMatch = line.match(/^\s*const\s+(debounce)\s*=/);
        if (standaloneMatch) {
            // Add a newline separator and the standalone code
            preambleContent += '\n\n' + line;
        }
    }

    if (preambleContent.length === 0) {
        return null;
    }

    return preambleContent;
}

function findModuleBoundaries(lines) {
    const starts = []; // {name, line, indent}
    const ends = [];   // {line, indent}

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Module start: "const ModuleName = {" (allowing leading whitespace)
        const startMatch = line.match(/^(\s*)const\s+([A-Za-z_]\w*)\s*=\s*\{/);
        if (startMatch && TARGET_MODULES.has(startMatch[2])) {
            starts.push({
                name: startMatch[2],
                line: i,
                indent: startMatch[1].length
            });
        }

        // Module end: "};" with optional leading whitespace
        const endMatch = line.match(/^(\s*)};/);
        if (endMatch) {
            ends.push({ line: i, indent: endMatch[1].length });
        }
    }

    return { starts, ends };
}

function pairBoundaries(starts, ends) {
    const modules = [];

    for (let i = 0; i < starts.length; i++) {
        const start = starts[i];
        const nextStart = starts[i + 1];

        // Find the }; that:
        // 1. Comes after this module start
        // 2. Comes before the next module start (if any)
        // 3. Has the same indentation level
        const validEnds = ends.filter(e =>
            e.line > start.line &&
            e.indent === start.indent &&
            (!nextStart || e.line < nextStart.line)
        );

        if (validEnds.length > 0) {
            // Take the last valid end (the one that closes this module)
            const endLine = validEnds[validEnds.length - 1].line;
            modules.push({
                name: start.name,
                startLine: start.line,
                endLine: endLine,
            });
        }
    }

    return modules;
}

function extractModules(content) {
    // Normalize line endings (handle Windows \r\n)
    const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalizedContent.split('\n');
    const { starts, ends } = findModuleBoundaries(lines);

    console.log(`  Found ${starts.length} module starts, ${ends.length} module ends`);

    const moduleBoundaries = pairBoundaries(starts, ends);
    const modules = {};

    for (const mod of moduleBoundaries) {
        const moduleContent = lines.slice(mod.startLine, mod.endLine + 1).join('\n');
        modules[mod.name] = {
            content: moduleContent,
            startLine: mod.startLine + 1, // 1-indexed for display
            endLine: mod.endLine + 1,
        };
        console.log(`  ${mod.name}: lines ${mod.startLine + 1}-${mod.endLine + 1} (${mod.endLine - mod.startLine + 1} lines)`);
    }

    return modules;
}

function writeModularFiles(modules) {
    // Track what we've written to each file
    const fileContents = {};

    for (const [moduleName, outputFile] of Object.entries(MODULE_MAP)) {
        if (!modules[moduleName]) {
            console.log(`  Warning: Module '${moduleName}' not found`);
            continue;
        }

        if (!fileContents[outputFile]) {
            fileContents[outputFile] = [];
        }
        fileContents[outputFile].push(modules[moduleName].content);
    }

    // Write each file
    for (const [outputFile, contents] of Object.entries(fileContents)) {
        const outputPath = path.join(MODULAR_DIR, outputFile);
        const combined = contents.join('\n\n');

        if (DRY_RUN) {
            console.log(`  [dry-run] Would write: ${outputFile} (${combined.length} bytes)`);
        } else {
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            fs.writeFileSync(outputPath, combined);
            console.log(`  Wrote: ${outputFile} (${combined.length} bytes)`);
        }
    }
}

function extractCSS(content) {
    const styleMatch = content.match(/<style>([\s\S]*?)<\/style>/);
    if (styleMatch) {
        const cssContent = styleMatch[1].trim();
        const cssPath = path.join(MODULAR_DIR, 'css', 'styles.css');

        if (DRY_RUN) {
            console.log(`  [dry-run] Would write: css/styles.css (${cssContent.length} bytes)`);
        } else {
            fs.mkdirSync(path.dirname(cssPath), { recursive: true });
            fs.writeFileSync(cssPath, cssContent);
            console.log(`  Wrote: css/styles.css (${cssContent.length} bytes)`);
        }
    }
}

function extractHTML(content) {
    let html = content;

    // Normalize line endings
    html = html.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Replace inline <style>...</style> with external link
    html = html.replace(
        /<style>[\s\S]*?<\/style>/,
        '<link rel="stylesheet" href="css/styles.css">'
    );

    // Build the script tags block with proper indentation
    const scriptTags = JS_FILES.map(f => `<script src="${f}"></script>`).join('\n    ');

    // Replace inline <script>...</script> with external script tags
    // The <!-- Application Logic --> comment is already in the HTML, just replace the script block
    html = html.replace(
        /<script>[\s\S]*?<\/script>/,
        scriptTags
    );

    const htmlPath = path.join(MODULAR_DIR, 'index.html');

    if (DRY_RUN) {
        console.log(`  [dry-run] Would write: index.html (${html.length} bytes)`);
    } else {
        fs.writeFileSync(htmlPath, html);
        console.log(`  Wrote: index.html (${html.length} bytes)`);
    }
}

function main() {
    console.log('Extracting modules from index.html...');
    if (DRY_RUN) console.log('(DRY RUN - no files will be written)\n');
    else console.log('');

    if (!fs.existsSync(INDEX_PATH)) {
        console.error(`Error: ${INDEX_PATH} not found`);
        process.exit(1);
    }

    const content = fs.readFileSync(INDEX_PATH, 'utf8');

    // Normalize line endings
    const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalizedContent.split('\n');

    // Extract preamble (code before first module)
    console.log('Extracting preamble:');
    const preamble = extractPreamble(lines);
    if (preamble) {
        const preamblePath = path.join(MODULAR_DIR, PREAMBLE_FILE);
        if (DRY_RUN) {
            console.log(`  [dry-run] Would write: ${PREAMBLE_FILE} (${preamble.length} bytes)`);
        } else {
            fs.mkdirSync(path.dirname(preamblePath), { recursive: true });
            fs.writeFileSync(preamblePath, preamble);
            console.log(`  Wrote: ${PREAMBLE_FILE} (${preamble.length} bytes)`);
        }
    } else {
        console.log('  No preamble found');
    }

    console.log('\nFinding modules:');
    const modules = extractModules(content);

    console.log('\nWriting modular files:');
    writeModularFiles(modules);

    console.log('\nExtracting CSS:');
    extractCSS(content);

    console.log('\nExtracting HTML template:');
    extractHTML(content);

    console.log('\nDone!');
}

main();
