import * as wasm from "./solvec_wasm_bg.wasm";
import { __wbg_set_wasm } from "./solvec_wasm_bg.js";

__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    run_pure_v1
} from "./solvec_wasm_bg.js";
