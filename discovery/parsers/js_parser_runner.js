/**
 * discovery/parsers/js_parser_runner.js
 * 
 * Dynamic runner for HPE SAN Javascript parsing functions.
 * Reads 'beta-analysis-tools/testcases.txt', extracts the requested parsing 
 * function on-the-fly, compiles it in a sandbox V8 context, and executes it.
 * Accepts input CLI data via standard input to prevent shell length limitations.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const COMMAND_TO_FUNC = {
    "showversion -b": "parseShowVersion",
    "showsys": "parseShowSys",
    "shownode": "parseShowNode",
    "showport": "parseShowPort",
    "showswitch": "parseShowSwitch",
    "showhost": "parseShowHost",
    "showcage": "parseShowCageBasic",
    "showcage -state": "parseShowCageState",
    "showcage -pci": "parseShowCagePCI",
    "showcage -sfp": "parseShowCageSFP",
    "showpd": "parseShowPdBasic",
    "showpd -s": "parseShowPdS",
    "showpd -i": "parseShowPdI"
};

/**
 * Extracts and returns all 'function parseX(...)' definitions in testcases.txt
 */
function loadParsers() {
    const baseDir = __dirname;
    const filePath = path.join(baseDir, 'testcases-markdown.md');
    if (!fs.existsSync(filePath)) {
        throw new Error(`HPE SAN testcases file not found in ${baseDir}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const functions = {};
    let index = 0;

    // Brace-matching parser to extract clean function blocks
    while (true) {
        const matchIndex = content.indexOf('function parse', index);
        if (matchIndex === -1) break;

        const openParen = content.indexOf('(', matchIndex);
        const closeParen = content.indexOf(')', openParen);
        const openBrace = content.indexOf('{', closeParen);

        if (openParen === -1 || closeParen === -1 || openBrace === -1) {
            index = matchIndex + 14;
            continue;
        }

        const funcHeader = content.substring(matchIndex, openBrace).trim();
        const funcNameMatch = funcHeader.match(/function\s+(parse\w+)/);
        if (!funcNameMatch) {
            index = matchIndex + 14;
            continue;
        }
        const funcName = funcNameMatch[1];

        let braceCount = 1;
        let i = openBrace + 1;
        while (braceCount > 0 && i < content.length) {
            if (content[i] === '{') braceCount++;
            else if (content[i] === '}') braceCount--;
            i++;
        }

        const funcBody = content.substring(openBrace, i);
        const fullFunc = funcHeader + ' ' + funcBody;

        functions[funcName] = fullFunc;
        index = i;
    }

    return functions;
}

/**
 * Runs the selected parser inside a V8 VM context
 */
/**
 * useVM=true  → V8 isolated context (default)
 * useVM=false → direct new Function() evaluation (no VM sandbox, works on locked-down VMs)
 */
function runParser(funcName, cliOutput, useVM = true) {
    const parsers = loadParsers();
    const funcCode = parsers[funcName];
    if (!funcCode) {
        throw new Error(`Parser function '${funcName}' not found in testcases file.`);
    }

    if (!useVM) {
        // Direct mode: skip VM sandbox entirely
        console.warn(`[js_parser] Running in DIRECT mode (no VM sandbox) for ${funcName}.`);
        const runFn = new Function('inputData', `
            ${funcCode}
            return ${funcName}(inputData);
        `);
        return runFn(cliOutput);
    }

    try {
        // VM Sandbox mode (default)
        const sandbox = { console: console, inputData: cliOutput };
        vm.createContext(sandbox);
        vm.runInContext(funcCode, sandbox);
        return vm.runInContext(`${funcName}(inputData)`, sandbox);
    } catch (vmErr) {
        console.warn(`[js_parser] VM sandbox failed: ${vmErr.message}. Auto-falling back to direct mode.`);
        const runFn = new Function('inputData', `
            ${funcCode}
            return ${funcName}(inputData);
        `);
        return runFn(cliOutput);
    }
}

function main() {
    const rawArgs = process.argv.slice(2);
    if (rawArgs.length === 0) {
        console.error("Usage: node js_parser_runner.js <cmd_or_func_name> [--no-vm]");
        process.exit(1);
    }

    // Parse flags
    const noVm = rawArgs.includes('--no-vm');
    const useVM = !noVm;
    const args = rawArgs.filter(a => !a.startsWith('--'));

    const target = args[0].toLowerCase();
    let funcName = COMMAND_TO_FUNC[target];
    if (!funcName) {
        if (target.startsWith("showportdev")) {
            funcName = "parseShowPortDevNS";
        } else {
            funcName = args[0];
        }
    }

    // Stream stdin fully
    let cliOutput = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
        cliOutput += chunk;
    });

    process.stdin.on("end", () => {
        try {
            const result = runParser(funcName, cliOutput, useVM);
            console.log(JSON.stringify(result, null, 2));
            process.exit(0);
        } catch (err) {
            console.error(`Runner Execution Error: ${err.message}`);
            process.exit(1);
        }
    });
}

main();
