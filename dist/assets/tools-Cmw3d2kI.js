import{H as n}from"./vendor-CD5_UGGr.js";async function a(t){if(t.length===0)return new Set;try{const e=await n("detect_binaries",{bins:t});return new Set(e)}catch{return new Set}}export{a as d};
