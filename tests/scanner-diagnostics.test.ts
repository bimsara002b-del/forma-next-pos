import {describe,it,expect} from "vitest";
import {diagnoseScan} from "../src/lib/scanner-diagnostics";
const products=[{id:"1",name:"A",sku:"SKU1",barcode:"001234"},{id:"2",name:"B",sku:"SKU2",barcode:null}];
describe("scanner diagnostics",()=>{
 it("handles Enter suffix and calibration reference",()=>expect(diagnoseScan("123456789012\r\n","test",null,products).status).toBe("match"));
 it("preserves leading zeros and matches product",()=>expect(diagnoseScan("001234","product",products[0],products).status).toBe("match"));
 it("handles SKU fallback",()=>expect(diagnoseScan("SKU2","product",products[1],products).status).toBe("match"));
 it("rejects ambiguous catalog codes",()=>expect(diagnoseScan("001234","product",products[0],[...products,{id:"3",name:"C",sku:"001234",barcode:null}]).status).toBe("ambiguous"));
 it("rejects invalid characters",()=>expect(diagnoseScan("ABC\t","test",null,products).status).toBe("invalid"));
});
