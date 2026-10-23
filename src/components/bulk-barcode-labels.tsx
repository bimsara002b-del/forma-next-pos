"use client";

import { FormEvent, useMemo, useState } from "react";
import { barcodeSvg, barcodeValue, MAX_BATCH_LABELS, MAX_BATCH_PRODUCTS,
  renderLabelSheet, validateLabelBatch, type LabelOptions, type LabelPaper, type LabelProduct, type PrinterProfile } from "@/lib/barcode-label-sheet";

type QueueLine = { productId: string; copies: number };
function printDocument(html: string) {
  const popup = window.open("", "_blank", "width=900,height=850");
  if (!popup) throw Error("Allow pop-ups to open the print preview.");
  popup.addEventListener("load", () => { popup.focus(); popup.print(); }, { once: true });
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
}

export function BulkBarcodeLabels({ products, profile }: { products: LabelProduct[]; profile: PrinterProfile }) {
  const [search, setSearch] = useState("");
  const [choice, setChoice] = useState("");
  const [queue, setQueue] = useState<QueueLine[]>([]);
  const [paper, setPaper] = useState<LabelPaper>("50x30");
  const [options, setOptions] = useState<LabelOptions>({ showName: true, showPrice: true, showCode: true });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const byId = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const candidates = products.filter(product => [product.name, product.sku, product.barcode ?? ""]
    .some(value => value.toLowerCase().includes(search.toLowerCase())));
  const selected = choice ? byId.get(choice) : undefined;
  const lines = queue.flatMap(q => {
    const product = byId.get(q.productId);
    return product ? [{ product, copies: q.copies }] : [];
  });
  const total = queue.reduce((sum, item) => sum + item.copies, 0);
  let validation = "";
  if (lines.length) {
    try { validateLabelBatch(lines, paper); }
    catch (e) { validation = e instanceof Error ? e.message : "Invalid label batch."; }
  }
  let preview = "";
  try {
    if (lines.length && !validation) preview = barcodeSvg(barcodeValue(lines[0].product));
  } catch { /* Batch validation already explains unsupported barcodes. */ }
  function addProduct() {
    setError(""); setNotice("");
    if (!selected) { setError("Choose a product."); return; }
    if (queue.some(q => q.productId === selected.id)) {
      setError("Product already in the queue. Change its quantity below."); return;
    }
    if (queue.length >= MAX_BATCH_PRODUCTS || total >= MAX_BATCH_LABELS) {
      setError("Maximum 30 different products and 200 total labels per batch."); return;
    }
    setQueue(previous => [...previous, { productId: selected.id, copies: 1 }]);
    setChoice("");
  }
  function print(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(""); setNotice("");
    try {
      const html = renderLabelSheet(lines, paper, options, profile);
      printDocument(html);
      setNotice("Print preview opened for " + total + " labels. Select the matching paper and 100% scale.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not prepare label print."); }
  }
  const inputStyle = { width: "100%", padding: "10px 12px", border: "1px solid #dce4ea", borderRadius: 8 };
  return <section className="panel" style={{ padding: 22, marginTop: 22 }} aria-label="Bulk barcode label printing">
    <div className="panel-header"><h3>Bulk barcode label printing</h3><span className="subtle-pill">{total} / 200 labels</span></div>
    <p className="small-disclaimer">Combine up to 30 different products in one print job, with 1–100 labels per product.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p role="status" style={{ color: "#12815c" }}>{notice}</p>}
    <div className="form-grid" style={{ marginTop: 12 }}>
      <label>Find product<input style={inputStyle} value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search name / SKU / barcode" /></label>
      <label>Choose product<select style={inputStyle} value={choice} onChange={e => setChoice(e.target.value)}>
        <option value="">Select product</option>
        {candidates.map(product => <option value={product.id} key={product.id}>
          {product.name} · {product.barcode || product.sku}
        </option>)}
      </select></label>
    </div>
    <div className="stock-actions" style={{ marginTop: 12 }}>
      <button type="button" disabled={!selected || queue.length >= MAX_BATCH_PRODUCTS}
        onClick={addProduct}>Add to print queue</button>
      <button type="button" disabled={!queue.length} onClick={() => { setQueue([]); setError(""); setNotice(""); }}>Clear queue</button>
    </div>
    {queue.length > 0 && <div className="table-scroll" style={{ marginTop: 16 }}>
      <table><thead><tr><th>Product</th><th>Code</th><th>Labels</th><th>Action</th></tr></thead>
        <tbody>{queue.map(row => {
          const product = byId.get(row.productId);
          return <tr key={row.productId}>
            <td>{product?.name ?? "Missing product"}</td><td>{product ? barcodeValue(product) : "—"}</td>
            <td><input aria-label={"Label count for " + (product?.name ?? "product")} type="number" min={1} max={100} step={1}
              style={{ width: 95 }} value={row.copies} onChange={e => {
                const count = e.target.valueAsNumber;
                setQueue(old => old.map(q => q.productId === row.productId ? { ...q, copies: count } : q));
              }} /></td>
            <td><button type="button" onClick={() => setQueue(old => old.filter(q => q.productId !== row.productId))}>Remove</button></td>
          </tr>;
        })}</tbody></table>
    </div>}
    <form onSubmit={print} style={{ marginTop: 18 }}>
      <div className="form-grid">
        <label>Paper / label stock<select style={inputStyle} value={paper}
          onChange={e => setPaper(e.target.value as LabelPaper)}>
          <option value="50x30">50 × 30 mm thermal</option>
          <option value="40x30">40 × 30 mm thermal</option>
          <option value="A4">A4 · 48 × 30 mm (4 columns)</option>
        </select></label>
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", margin: "16px 0" }}>
        <label><input type="checkbox" checked={options.showName}
          onChange={e => setOptions(o => ({ ...o, showName: e.target.checked }))} /> Product name</label>
        <label><input type="checkbox" checked={options.showPrice}
          onChange={e => setOptions(o => ({ ...o, showPrice: e.target.checked }))} /> Price</label>
        <label><input type="checkbox" checked={options.showCode}
          onChange={e => setOptions(o => ({ ...o, showCode: e.target.checked }))} /> Barcode text</label>
      </div>
      {validation && <p className="form-error" role="alert">{validation}</p>}
      {lines.length > 0 && !validation && <div style={{ background: "#f1f5f9", padding: 16, borderRadius: 8, marginBottom: 15 }}>
        <div style={{ width: 210, maxWidth: "100%", margin: "auto", padding: 12, color: "#000", background: "#fff", textAlign: "center" }}>
          <strong style={{ fontSize: 12 }}>{lines[0].product.name}</strong>
          <div style={{ height: 48 }} dangerouslySetInnerHTML={{ __html: preview }} />
          <span style={{ fontSize: 10, fontFamily: "monospace" }}>{barcodeValue(lines[0].product)}</span>
        </div>
        <p className="small-disclaimer" style={{ textAlign: "center" }}>Preview: first product · {queue.length} unique products</p>
      </div>}
      <button className="small-action" type="submit" disabled={!lines.length || !!validation}>
        Print {total} barcode labels
      </button>
    </form>
  </section>;
}
