"use client";

import { useState } from "react";

export function ProductForm({ pageId }: { pageId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setMessage("");
    try {
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const response = await fetch("/api/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pageId, ...data }) });
      const body = await response.json();
      if (!response.ok) return setMessage(body.error ?? "Unable to save the product draft.");
      setOpen(false); setMessage("Product saved as a draft. Live catalog is unchanged until publish.");
    } catch { setMessage("Unable to save the product draft."); } finally { setLoading(false); }
  }
  return <div>{!open ? <><button className="button primary" onClick={() => setOpen(true)}>Add product</button>{message && <div className="callout info" style={{ marginTop: 10 }}>{message}</div>}</> : <form onSubmit={submit} className="card" style={{ position: "absolute", right: 36, top: 125, width: 340, padding: 18, zIndex: 3, boxShadow: "0 6px 24px rgba(0,0,0,.08)" }}><h3 style={{ marginBottom: 15 }}>Add product</h3>{message && <div className="error-message">{message}</div>}<Field name="name" label="Product name" required /><Field name="sku" label="Variant SKU" required /><div className="grid grid-2" style={{ gap: 10 }}><Field name="price" label="Price" type="number" required /><Field name="oldPrice" label="Old price" type="number" /></div><div className="grid grid-2" style={{ gap: 10 }}><Field name="size" label="Size" /><Field name="color" label="Color" /></div><Field name="description" label="Description" textarea /><div className="form-actions"><button type="button" className="button secondary" onClick={() => setOpen(false)}>Cancel</button><button className="button primary" disabled={loading}>{loading ? "Saving…" : "Save draft"}</button></div></form>}</div>;
}

function Field({ name, label, type = "text", required, textarea }: { name: string; label: string; type?: string; required?: boolean; textarea?: boolean }) { return <div className="field"><label htmlFor={`product-${name}`}>{label}</label>{textarea ? <textarea className="textarea small" id={`product-${name}`} name={name} /> : <input className="input" id={`product-${name}`} name={name} type={type} required={required} step={type === "number" ? "0.01" : undefined} />}</div>; }
