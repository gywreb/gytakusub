// Vendors OpenCV.js (official 4.5.5 WebAssembly build, published on npm as
// `opencv-bindings`) into extension/vendor as an ES module + separate .wasm:
//   node scripts/vendor-opencv.mjs
// The npm file is the single-file UMD build from docs.opencv.org with the wasm
// inlined as base64. We (1) pull the wasm out so the browser can stream-compile
// and cache it, (2) replace the UMD wrapper with `export default function
// loadOpenCV(Module)`, so it imports cleanly in a module service worker or a
// module Web Worker. Nothing inside the Emscripten output is modified.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(path.join(root, "tests", "package.json"));
const srcPath = require.resolve("opencv-bindings");
const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(srcPath), "package.json"), "utf8"));
let src = fs.readFileSync(srcPath, "utf8");

// 1. wasm out
const m = src.match(/var wasmBinaryFile="data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)"/);
if (!m) throw new Error("embedded wasm not found — upstream layout changed");
const wasm = Buffer.from(m[1], "base64");
src = src.replace(m[0], 'var wasmBinaryFile="opencv_js.wasm"'); // Emscripten's own code passes it through locateFile next

// 2. MV3 forbids dynamic code ('unsafe-eval'). This Emscripten build has exactly
//    two `new Function` sites, both cosmetic (a function's display name, and a
//    dynCall wrapper with named parameters). Replace them with plain closures.
const patches = [
  [/function createNamedFunction\(name,body\)\{name=makeLegalFunctionName\(name\);return new Function\("body","return function "\+name\+"\(\) \{\\n"\+'    "use strict";'\+"    return body.apply\(this, arguments\);\\n"\+"\};\\n"\)\(body\)\}/,
   'function createNamedFunction(name,body){name=makeLegalFunctionName(name);var f=function(){"use strict";return body.apply(this,arguments)};try{Object.defineProperty(f,"name",{value:name})}catch(e){}return f}'],
  [/function makeDynCaller\(dynCall\)\{var args=\[\];for\(var i=1;i<signature\.length;\+\+i\)\{args\.push\("a"\+i\)\}var name="dynCall_"\+signature\+"_"\+rawFunction;var body="return function "\+name\+"\("\+args\.join\(", "\)\+"\) \{\\n";body\+="    return dynCall\(rawFunction"\+\(args\.length\?", ":""\)\+args\.join\(", "\)\+"\);\\n";body\+="\};\\n";return new Function\("dynCall","rawFunction",body\)\(dynCall,rawFunction\)\}/,
   'function makeDynCaller(dynCall){var f=function(){var a=[rawFunction];for(var i=0;i<arguments.length;++i)a.push(arguments[i]);return dynCall.apply(null,a)};try{Object.defineProperty(f,"length",{value:signature.length-1})}catch(e){}return f}'],
];
for (const [re, rep] of patches) {
  if (!re.test(src)) throw new Error("dynamic-code site not found — upstream layout changed: " + re.source.slice(0, 40));
  src = src.replace(re, rep);
}

// The two real code generators: Embind's invoker factory and the emval method
// caller build function bodies as strings. These are the closure equivalents
// (what Emscripten emits with -sDYNAMIC_EXECUTION=0), same wire semantics:
// arity check, toWireType per argument, destructor handling, fromWireType.
function replaceFunction(name, until, replacement) {
  const a = src.indexOf("function " + name + "(");
  const b = src.indexOf("function " + until + "(", a);
  if (a < 0 || b < 0) throw new Error(name + " not found — upstream layout changed");
  src = src.slice(0, a) + replacement + src.slice(b);
}
replaceFunction("craftInvokerFunction", "heap32VectorToArray", `function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc){var argCount=argTypes.length;if(argCount<2){throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!")}var isClassMethodFunc=argTypes[1]!==null&&classType!==null;var needsDestructorStack=false;for(var i=1;i<argTypes.length;++i){if(argTypes[i]!==null&&argTypes[i].destructorFunction===undefined){needsDestructorStack=true;break}}var returns=argTypes[0].name!=="void";var retType=argTypes[0];var classParam=argTypes[1];var expected=argCount-2;var dtors=[];if(!needsDestructorStack){for(var i=isClassMethodFunc?1:2;i<argTypes.length;++i){if(argTypes[i].destructorFunction!==null){dtors.push([i,argTypes[i].destructorFunction])}}}var invoker=function(){if(arguments.length!==expected){throwBindingError("function "+humanName+" called with "+arguments.length+" arguments, expected "+expected+" args!")}var destructors=needsDestructorStack?[]:null;var wired=[cppTargetFunc];var thisWired;if(isClassMethodFunc){thisWired=classParam.toWireType(destructors,this);wired.push(thisWired)}for(var i=0;i<expected;++i){wired.push(argTypes[i+2].toWireType(destructors,arguments[i]))}var rv=cppInvokerFunc.apply(null,wired);if(needsDestructorStack){runDestructors(destructors)}else{for(var d=0;d<dtors.length;++d){var idx=dtors[d][0];dtors[d][1](idx===1?thisWired:wired[1+(isClassMethodFunc?1:0)+(idx-2)])}}if(returns){return retType.fromWireType(rv)}};try{Object.defineProperty(invoker,"name",{value:makeLegalFunctionName(humanName)})}catch(e){}return invoker}`);
replaceFunction("__emval_get_method_caller", "__emval_get_property", `function __emval_get_method_caller(argCount,argTypes){var types=__emval_lookupTypes(argCount,argTypes);var retType=types[0];var n=argCount-1;var offsets=[];var off=0;for(var i=0;i<n;++i){offsets.push(off);off+=types[i+1]["argPackAdvance"]}var caller=function(handle,name,destructors,args){var a=new Array(n);for(var i=0;i<n;++i){a[i]=types[i+1].readValueFromPointer(args+offsets[i])}var rv=handle[name].apply(handle,a);for(var i=0;i<n;++i){if(types[i+1]["deleteObject"]){types[i+1].deleteObject(a[i])}}if(!retType.isVoid){return retType.toWireType(destructors,rv)}};return __emval_addMethodCaller(caller)}`);
if (/new Function\(|new_\(Function|[^a-zA-Z_.]eval\(/.test(src)) throw new Error("dynamic code still present after patching");

// 3. UMD wrapper → ES module factory. The Emscripten body is
//    `var cv = (function(){ ... return (function(cv){ ... return cv }) })();`
//    followed by the UMD tail that calls `cv(Module)`.
const start = src.indexOf("var cv = (function() {");
const tail = src.lastIndexOf("if (typeof exports === 'object' && typeof module === 'object')");
if (start < 0 || tail < 0) throw new Error("UMD wrapper not found — upstream layout changed");
const body = src.slice(start, tail);
const out = `// OpenCV.js ${pkg.version} (Apache-2.0) — see LICENSE-OpenCV.txt. Generated by scripts/vendor-opencv.mjs; do not edit.
${body}
/** @param {{locateFile?: (file: string) => string}} Module */
export default function loadOpenCV(Module = {}) { return cv(Module); }
`;
fs.mkdirSync(path.join(root, "extension/vendor"), { recursive: true });
fs.writeFileSync(path.join(root, "extension/vendor/opencv.js"), out);
fs.writeFileSync(path.join(root, "extension/vendor/opencv_js.wasm"), wasm);
console.log(`opencv.js ${pkg.version}: loader ${(out.length / 1e6).toFixed(2)} MB, wasm ${(wasm.length / 1e6).toFixed(2)} MB`);
