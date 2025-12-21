#!/usr/bin/env node
/**
 * reconstruct.js
 *
 * Builds the monolithic index.html from the modular directory structure.
 * Inlines all CSS and JavaScript into a single file.
 *
 * Usage: node scripts/reconstruct.js [--dry-run] [--output=path]
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const MODULAR_DIR = path.join(ROOT_DIR, 'modular');
const DEFAULT_OUTPUT = path.join(ROOT_DIR, 'index.html');

// Script load order (must match module dependencies)
const JS_FILES = [
    'js/preamble.js',                   // APP_BUILD_TIMESTAMP, debounce
    'js/services/utility.js',           // DOM, ActionHandler, UTILITY
    'js/services/db-service.js',        // DBService
    'js/services/story-service.js',     // StoryService
    'js/services/state-manager.js',     // StateManager, ReactiveStore
    'js/services/api-service.js',       // APIService, ModalManager
    'js/services/prompt-builder.js',    // PromptBuilder
    'js/services/image-processor.js',   // ImageProcessor
    'js/services/import-export-service.js', // ImportExportService
    'js/ui/ui-manager.js',              // UIComponents, UIManager
    'js/controller.js',                 // AppController, LibraryController, NarrativeController, WorldController, ActionDispatcher
    'js/app.js',                        // app
];

const CSS_FILE = 'css/styles.css';

const DRY_RUN = process.argv.includes('--dry-run');
const OUTPUT_ARG = process.argv.find(arg => arg.startsWith('--output='));
const OUTPUT_PATH = OUTPUT_ARG ? OUTPUT_ARG.split('=')[1] : DEFAULT_OUTPUT;

function readModularFile(relativePath) {
    const fullPath = path.join(MODULAR_DIR, relativePath);
    if (!fs.existsSync(fullPath)) {
        console.error(`  Error: ${relativePath} not found`);
        return null;
    }
    return fs.readFileSync(fullPath, 'utf8');
}

function buildMonolithic() {
    const templatePath = path.join(MODULAR_DIR, 'index.html');
    if (!fs.existsSync(templatePath)) {
        console.error(`Error: ${templatePath} not found`);
        process.exit(1);
    }

    let template = fs.readFileSync(templatePath, 'utf8');

    // Read CSS
    console.log('Reading CSS...');
    const css = readModularFile(CSS_FILE);
    if (!css) {
        console.error('Failed to read CSS file');
        process.exit(1);
    }
    console.log(`  ${CSS_FILE}: ${css.length} bytes`);

    // Read all JS files
    console.log('\nReading JavaScript modules...');
    const jsContents = [];
    for (const jsFile of JS_FILES) {
        const content = readModularFile(jsFile);
        if (!content) {
            console.error(`Failed to read ${jsFile}`);
            process.exit(1);
        }
        console.log(`  ${jsFile}: ${content.length} bytes`);
        jsContents.push(`// === ${jsFile} ===\n${content}`);
    }
    const combinedJS = jsContents.join('\n\n');

    // Escape $ in JS to prevent interpretation as replacement patterns
    // (e.g., $& means "matched string" in .replace())
    const escapedJS = combinedJS.replace(/\$/g, '$$$$');

    // Replace external CSS link with inline style
    console.log('\nBuilding monolithic file...');
    template = template.replace(
        /<link rel="stylesheet" href="css\/styles\.css">/,
        `<style>\n${css}\n</style>`
    );

    // Replace script tags with inline script
    // Find the first script tag for our modules and replace all of them with one inline script
    const scriptTagPattern = /<!-- Application Logic[\s\S]*?<script src="js\/app\.js"><\/script>/;
    template = template.replace(
        scriptTagPattern,
        `<script>\n${escapedJS}\n</script>`
    );

    // Also handle if the pattern doesn't match (simpler replacement)
    if (template.includes('<script src="js/services/utility.js">')) {
        // Remove all individual script tags
        template = template.replace(/<script src="js\/[^"]+"><\/script>\s*/g, '');
        // Add combined script before closing body
        template = template.replace('</body>', `<script>\n${escapedJS}\n</script>\n</body>`);
    }

    const finalSize = template.length;
    console.log(`  Final size: ${finalSize} bytes (${Math.round(finalSize / 1024)} KB)`);

    return template;
}

function main() {
    console.log('Reconstructing monolithic index.html from modular/\n');
    if (DRY_RUN) console.log('(DRY RUN - no files will be written)\n');

    const monolithic = buildMonolithic();

    if (DRY_RUN) {
        console.log(`\n[dry-run] Would write: ${OUTPUT_PATH}`);
        console.log(`[dry-run] Preview (first 500 chars):\n${monolithic.substring(0, 500)}...`);
    } else {
        fs.writeFileSync(OUTPUT_PATH, monolithic);
        console.log(`\nWrote: ${OUTPUT_PATH}`);
    }

    console.log('\nDone!');
}

main();
