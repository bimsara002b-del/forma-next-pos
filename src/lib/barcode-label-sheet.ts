import { code128Bars, fitsLabel } from "./barcodes";

export type LabelPaper = "40x30" | "50x30" | "A4";
export type LabelProduct = {
  id: string; name: string; sku: string; barcode: string | null; priceCents: number;
};
export type LabelLine = { product: LabelProduct; copies: number };
export type LabelOptions = { showName: boolean; showPrice: boolean; showCode: boolean };
export const MAX_BATCH_LABELS = 200;
export const MAX_BATCH_PRODUCTS = 30;

export function barcodeValue(product: LabelProduct): string {
  return product.barcode?.trim() || product.sku.trim();
}
export function validateLabelBatch(lines: LabelLine[], paper: LabelPaper): number {
  if (!["40x30", "50x30", "A4"].includes(paper)) throw Error("Unsupported label paper.");
  if (!lines.length || lines.length > MAX_BATCH_PRODUCTS)
    throw Error("Select 1–30 distinct products to print.");
  let total = 0;
  const seen = new Set<string>();
  for (const { product, copies } of lines) {
    if (!product.id || seen.has(product.id)) throw Error("Product selected more than once.");
    seen.add(product.id);
    if (!Number.isSafeInteger(copies) || copies < 1 || copies > 100)
      throw Error("Choose 1–100 labels per product.");
    if (!Number.isSafeInteger(product.priceCents) || product.priceCents < 0)
      throw Error("Invalid product price.");
    const code = barcodeValue(product);
    const width = paper === "A4" ? 48 : paper === "40x30" ? 40 : 50;
    try {
      if (!fitsLabel(code, width)) throw Error("too narrow");
    } catch {
      throw Error(product.name + ": barcode/SKU is unsupported or too long for the selected label size.");
    }
    total += copies;
    if (total > MAX_BATCH_LABELS) throw Error("Maximum 200 labels per print batch.");
  }
  return total;
}

function escaped(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
export function barcodeSvg(code: string): string {
  const { width, bars } = code128Bars(code);
  return '<svg xmlns="http://www.w3.org/2000/svg" aria-label="Code 128 barcode" role="img" ' +
    'viewBox="0 0 ' + width + ' 60" preserveAspectRatio="none">' +
    bars.map(bar => '<rect x="' + bar.x + '" y="0" width="' + bar.width + '" height="60"/>').join("") + '</svg>';
}
export type LabelTemplate = "classic" | "compact" | "price-first";
export type PrinterProfile = {
  template: LabelTemplate;
  storeName: string;
  barcodeHeightMm: number;
  offsetXmm: number;
  offsetYmm: number;
};
export const DEFAULT_PRINTER_PROFILE: PrinterProfile = {
  template: "classic", storeName: "", barcodeHeightMm: 12, offsetXmm: 0, offsetYmm: 0
};
export function validatePrinterProfile(profile: PrinterProfile): void {
  if (!["classic", "compact", "price-first"].includes(profile.template) ||
    profile.storeName.length > 36 ||
    [...profile.storeName].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    !Number.isFinite(profile.barcodeHeightMm) || profile.barcodeHeightMm < 7 || profile.barcodeHeightMm > 16 ||
    !Number.isFinite(profile.offsetXmm) || Math.abs(profile.offsetXmm) > 2 ||
    !Number.isFinite(profile.offsetYmm) || Math.abs(profile.offsetYmm) > 2) {
    throw Error("Invalid label template or calibration values.");
  }
}
export function renderLabelSheet(lines: LabelLine[], paper: LabelPaper, options: LabelOptions, profile: PrinterProfile = DEFAULT_PRINTER_PROFILE): string {
  validateLabelBatch(lines, paper);
  validatePrinterProfile(profile);
  const a4 = paper === "A4";
  const width = paper === "A4" ? 48 : paper === "40x30" ? 40 : 50;
  const labels = lines.flatMap(({ product, copies }) => {
    const code = barcodeValue(product);
    const name = options.showName ? '<strong class="product-name">' + escaped(product.name) + '</strong>' : "";
    const amount = options.showPrice ? '<b>Rs. ' + (product.priceCents / 100).toFixed(2) + '</b>' : "";
    const codeText = options.showCode ? '<span>' + escaped(code) + '</span>' : "";
    const store = profile.storeName ? '<div class="store">' + escaped(profile.storeName) + '</div>' : '';
    const contents = profile.template === 'price-first' ? store + amount + name : store + name;
    const after = profile.template === 'price-first' ? codeText : codeText + amount;
    const labelClass = profile.template === "classic" ? "label" : "label template-" + profile.template;
    const markup = '<article class="' + labelClass + '">' + contents + '<div class="bars">' + barcodeSvg(code) +
      '</div>' + after + '</article>';
    return Array.from({ length: copies }, () => markup);
  }).join("");

  // A4 printable width = 210mm - 2*5mm; 4*48mm + 3*2mm = 198mm.
  const css = '@page{size:' + (a4 ? "A4" : width + "mm 30mm") +
    ';margin:' + (a4 ? "5mm" : "0") + '}' +
    '*{box-sizing:border-box}html,body{margin:0;background:#fff;color:#000;font-family:Arial,sans-serif}' +
    '.sheet{' + (a4 ? 'display:grid;grid-template-columns:repeat(4,48mm);column-gap:2mm;row-gap:2mm;' : '') + '}' +
    '.label{width:' + width + 'mm;height:30mm;display:flex;flex-direction:column;' +
    'justify-content:center;align-items:center;overflow:hidden;padding:1.5mm;text-align:center;' +
    (a4 ? 'break-inside:avoid;page-break-inside:avoid;' : 'break-after:page;page-break-after:always;') + '}' +
    '.label{position:relative;left:' + profile.offsetXmm + 'mm;top:' + profile.offsetYmm + 'mm}' +
    '.template-compact .product-name{font-size:7pt}.template-compact .store{font-size:6pt}' +
    '.store{font-size:7pt;max-width:100%;white-space:nowrap;overflow:hidden}' +
    '.label:last-child{break-after:auto;page-break-after:auto}' +
    '.product-name{font-size:9pt;line-height:1.1;max-height:9mm;overflow:hidden}' +
    '.bars{height:' + profile.barcodeHeightMm + 'mm;width:100%}.bars svg{width:100%;height:100%;fill:#000}' +
    '.label span{font:8pt monospace;white-space:nowrap}.label b{font-size:10pt}' +
    '.print-action{display:block;margin:16px auto;padding:9px 16px}' +
    '@media print{.print-action{display:none!important}}';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Forma POS Barcode Labels</title>' +
    '<style>' + css + '</style></head><body><button class="print-action" onclick="window.print()">' +
    'Print / Reprint</button><div class="sheet">' + labels + '</div></body></html>';
}
