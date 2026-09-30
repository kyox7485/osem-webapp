import "server-only";
import type { InventoryContext } from "../server";
import { barcodeVariants } from "../core";
import type { ReportColumn, ReportKey, ReportParams, ReportResult, ReportRow } from "./types";

// Shared plumbing for the report loaders: paged reads through the caller's
// own Supabase session (RLS decides the rows, never the service role), id
// lookups that stay clear of URL-length limits, and the result envelope.

export type Sb = InventoryContext["supabase"];
export type Translate = (text: string, params?: Record<string, string | number>) => string;

export type ReportCtx = {
  sb: Sb;
  branchId: number;
  rank: number;
  t: Translate;
  /** rows the result may hold; loaders read one more to detect truncation */
  cap: number;
  params: ReportParams;
};

/** Thrown by fetchRows; loadReport turns it into an error result. */
export class ReportQueryError extends Error {}

const PAGE = 1000; // PostgREST returns at most this many rows per request
const ID_CHUNK = 200; // ids per `in (...)` filter, keeps the URL short

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Paged = { range: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: { message: string } | null }> };

/** Reads up to `max` rows page by page. `make` builds the (ordered) query afresh each time. */
export async function fetchRows<T = Record<string, unknown>>(make: () => Paged, max: number): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < max; offset += PAGE) {
    const end = Math.min(offset + PAGE, max) - 1;
    const { data, error } = await make().range(offset, end);
    if (error) throw new ReportQueryError(error.message);
    const page = (data ?? []) as T[];
    out.push(...page);
    if (page.length < end - offset + 1) break;
  }
  return out;
}

/** Rows whose `column` is in `ids`, fetched in chunks. */
export async function fetchByIds<T = Record<string, unknown>>(
  sb: Sb,
  table: string,
  columns: string,
  column: string,
  ids: number[]
): Promise<T[]> {
  const unique = [...new Set(ids)];
  const chunks: number[][] = [];
  for (let i = 0; i < unique.length; i += ID_CHUNK) chunks.push(unique.slice(i, i + ID_CHUNK));
  const pages = await Promise.all(
    chunks.map(async (chunk) => {
      const { data, error } = await sb.from(table).select(columns).in(column, chunk).limit(5000);
      if (error) throw new ReportQueryError(error.message);
      return (data ?? []) as unknown as T[];
    })
  );
  return pages.flat();
}

export type ProductMeta = {
  id: number;
  sku: string;
  name: string;
  categoryId: number;
  isActive: boolean;
  supplierId: number | null;
  /** code of the product's base UOM — the unit stock qty is counted in */
  baseUomCode: string;
};

/** UOM id -> code, for the products' base units. */
async function loadUomCodes(sb: Sb, ids: number[]): Promise<Map<number, string>> {
  const rows = await fetchByIds<{ id: number; code: string }>(sb, "tbl_inv_uoms", "id, code", "id", ids);
  return new Map(rows.map((u) => [Number(u.id), u.code]));
}

/** Every product the caller can see (RLS), keyed by id. */
export async function loadProductMeta(sb: Sb): Promise<Map<number, ProductMeta>> {
  const rows = await fetchRows<{
    id: number;
    sku: string;
    name: string;
    category_id: number;
    is_active: boolean;
    default_supplier_id: number | null;
    base_uom_id: number;
  }>(() => sb.from("tbl_inv_products").select("id, sku, name, category_id, is_active, default_supplier_id, base_uom_id").order("id"), 20000);
  // base_uom_id is joined separately: tbl_inv_products has two FKs to
  // tbl_inv_uoms (base + purchase), so PostgREST cannot resolve an embedded
  // `base_uom(...)` and fails with "could not find a relationship".
  const uoms = await loadUomCodes(sb, rows.map((p) => Number(p.base_uom_id)));
  return new Map(
    rows.map((p) => [
      Number(p.id),
      {
        id: Number(p.id),
        sku: p.sku,
        name: p.name,
        categoryId: Number(p.category_id),
        isActive: p.is_active,
        supplierId: p.default_supplier_id === null ? null : Number(p.default_supplier_id),
        baseUomCode: uoms.get(Number(p.base_uom_id)) ?? "",
      },
    ])
  );
}

const MAX_MATCHES = 200;

/**
 * Products matching free text: an exact barcode (UPC-A and EAN-13 spellings),
 * or part of the name or SKU. Returns a set of product ids; an empty set means
 * "nothing matches". Wildcards typed by the user are escaped.
 */
export async function resolveProductIds(sb: Sb, text: string): Promise<Set<number>> {
  const like = `%${text.replace(/[\\%_]/g, "\\$&")}%`;
  const [barcodes, names, skus] = await Promise.all([
    sb.from("tbl_inv_product_barcodes").select("product_id").in("barcode", barcodeVariants(text)).limit(MAX_MATCHES),
    sb.from("tbl_inv_products").select("id").ilike("name", like).limit(MAX_MATCHES),
    sb.from("tbl_inv_products").select("id").ilike("sku", like).limit(MAX_MATCHES),
  ]);
  const failed = barcodes.error ?? names.error ?? skus.error;
  if (failed) throw new ReportQueryError(failed.message);
  return new Set([
    ...(barcodes.data ?? []).map((r) => Number(r.product_id)),
    ...(names.data ?? []).map((r) => Number(r.id)),
    ...(skus.data ?? []).map((r) => Number(r.id)),
  ]);
}

/** Resident id -> name for the given ids. */
export async function loadResidentNames(sb: Sb, ids: (number | null)[]): Promise<Map<number, string>> {
  const wanted = ids.filter((id): id is number => id !== null);
  if (wanted.length === 0) return new Map();
  const rows = await fetchByIds<{ id: number; resident_name: string }>(sb, "tbl_residents", "id, resident_name", "id", wanted);
  return new Map(rows.map((r) => [Number(r.id), r.resident_name]));
}

export function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** First instant of a KL calendar day as an ISO string (timestamptz filters). */
export function klDayStart(date: string): string {
  return `${date}T00:00:00+08:00`;
}
/** First instant after a KL calendar day. */
export function klDayEnd(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.toISOString().slice(0, 10)}T00:00:00+08:00`;
}

/** Date part (YYYY-MM-DD) of a timestamptz as seen in Kuala Lumpur. */
export function klDate(timestamp: string | null): string | null {
  if (!timestamp) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(new Date(timestamp));
}

export type ReportBody = {
  columns: ReportColumn[];
  rows: ReportRow[];
  totals?: ReportRow | null;
  /** the source query itself hit its limit */
  truncated?: boolean;
  notes?: string[];
};

/** Applies the row cap and wraps a loader's rows in the result envelope. */
export function buildResult(ctx: ReportCtx, key: ReportKey, title: string, body: ReportBody): ReportResult {
  const truncated = (body.truncated ?? false) || body.rows.length > ctx.cap;
  return {
    key,
    title,
    columns: body.columns,
    rows: body.rows.slice(0, ctx.cap),
    totals: body.totals ?? null,
    truncated,
    notes: body.notes ?? [],
    filters: [],
    error: null,
  };
}
