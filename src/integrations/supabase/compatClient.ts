import { getApiBase } from "@/lib/apiBase";
import { getToken, setToken } from "@/lib/authStorage";

type Filter =
  | { type: "eq"; column: string; value: unknown }
  | { type: "neq"; column: string; value: unknown }
  | { type: "in"; column: string; values: unknown[] }
  | { type: "gte"; column: string; value: unknown }
  | { type: "lte"; column: string; value: unknown }
  | { type: "is"; column: string; null: boolean }
  | { type: "or"; raw: string };

type OrderSpec = { column: string; ascending?: boolean; nullsFirst?: boolean };

function apiUrl(path: string) {
  return `${getApiBase()}${path}`;
}

async function safeFetch(input: RequestInfo, init?: RequestInit) {
  try {
    const res = await fetch(input, init);
    return { res, error: null };
  } catch (err) {
    return {
      res: null,
      error: err instanceof Error ? err.message : String(err) || "Network error",
    };
  }
}

async function apiQuery(body: Record<string, unknown>) {
  const token = getToken();
  const { res, error: fetchError } = await safeFetch(apiUrl("/api/query"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res) {
    console.error("❌ [compatClient] Network error on query:", body, fetchError);
    return {
      data: null,
      error: { message: fetchError ?? "Failed to reach API" },
      count: undefined as number | undefined,
    };
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("❌ [compatClient] API Error on query:", body.table, body.action, json?.error || json);
    return { data: null, error: { message: json?.error?.message || json?.error || res.statusText }, count: undefined as number | undefined };
  }
  return { data: json.data ?? null, error: json.error ?? null, count: json.count as number | undefined };
}

export type SupabaseResponse<T = unknown> = { data: T; error: { message: string } | null; count?: number };

class SelectBuilder implements PromiseLike<{ data: unknown; error: { message: string } | null; count?: number }> {
  constructor(
    private readonly table: string,
    private readonly columns: string,
    private readonly selectOptions: { count?: "exact"; head?: boolean } | undefined,
    private readonly filters: Filter[],
    private readonly orders: OrderSpec[],
    private readonly limitVal: number | undefined,
    private readonly offsetVal: number | undefined,
    private readonly singleMode: "none" | "maybe" | "one",
  ) {}

  private clone(p: Partial<{ filters: Filter[]; orders: OrderSpec[]; limitVal: number | undefined; offsetVal: number | undefined; singleMode: "none" | "maybe" | "one" }>) {
    return new SelectBuilder(
      this.table,
      this.columns,
      this.selectOptions,
      p.filters ?? this.filters,
      p.orders ?? this.orders,
      p.limitVal !== undefined ? p.limitVal : this.limitVal,
      p.offsetVal !== undefined ? p.offsetVal : this.offsetVal,
      p.singleMode ?? this.singleMode,
    );
  }

  eq(column: string, value: unknown) {
    return this.clone({ filters: [...this.filters, { type: "eq", column, value }] });
  }
  neq(column: string, value: unknown) {
    return this.clone({ filters: [...this.filters, { type: "neq", column, value }] });
  }
  in(column: string, values: unknown[]) {
    return this.clone({ filters: [...this.filters, { type: "in", column, values }] });
  }
  gte(column: string, value: unknown) {
    return this.clone({ filters: [...this.filters, { type: "gte", column, value }] });
  }
  lte(column: string, value: unknown) {
    return this.clone({ filters: [...this.filters, { type: "lte", column, value }] });
  }
  is(column: string, value: null) {
    return this.clone({ filters: [...this.filters, { type: "is", column, null: value === null }] });
  }
  or(raw: string) {
    return this.clone({ filters: [...this.filters, { type: "or", raw }] });
  }
  order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    return this.clone({ orders: [...this.orders, { column, ascending: opts?.ascending, nullsFirst: opts?.nullsFirst }] });
  }
  limit(n: number) {
    return this.clone({ limitVal: n });
  }

  maybeSingle() {
    return this.clone({ singleMode: "maybe" }).execute();
  }
  single() {
    return this.clone({ singleMode: "one" }).execute();
  }

  then<TResult1 = { data: unknown; error: { message: string } | null; count?: number }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: { message: string } | null; count?: number }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return (this.execute() as Promise<{ data: unknown; error: { message: string } | null; count?: number }>).then(onfulfilled as never, onrejected as never);
  }

  private execute() {
    const body: Record<string, unknown> = {
      action: "select",
      table: this.table,
      columns: this.columns,
      filters: this.filters,
      orders: this.orders,
      limit: this.limitVal,
      offset: this.offsetVal,
      count: this.selectOptions?.count,
      head: this.selectOptions?.head,
    };
    if (this.singleMode === "maybe") body.single = "maybe";
    if (this.singleMode === "one") body.single = "one";
    return apiQuery(body);
  }
}

class InsertWithReturning implements PromiseLike<{ data: any; error: { message: string } | null }> {
  constructor(private table: string, private rows: Record<string, unknown>[], private onConflict?: string) {}

  single() {
    return this.run("one");
  }
  maybeSingle() {
    return this.run("maybe");
  }

  then<TResult1 = { data: any; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.runMany().then(onfulfilled as never, onrejected as never);
  }

  private runMany() {
    const body: Record<string, unknown> = {
      action: "insert",
      table: this.table,
      values: this.rows.length === 1 ? this.rows[0] : this.rows,
      returning: true,
    };
    if (this.onConflict) body.onConflict = this.onConflict;
    return apiQuery(body);
  }

  private run(single: "one" | "maybe") {
    const body: Record<string, unknown> = {
      action: "insert",
      table: this.table,
      values: this.rows.length === 1 ? this.rows[0] : this.rows,
      returning: true,
      single,
    };
    if (this.onConflict) body.onConflict = this.onConflict;
    return apiQuery(body);
  }
}

class InsertBuilder implements PromiseLike<{ data: any; error: { message: string } | null }> {
  constructor(private table: string, private rows: Record<string, unknown>[], private onConflict?: string) {}

  select(_columns?: string) {
    return new InsertWithReturning(this.table, this.rows, this.onConflict);
  }

  then<TResult1 = { data: any; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const body: Record<string, unknown> = {
      action: "insert",
      table: this.table,
      values: this.rows.length === 1 ? this.rows[0] : this.rows,
      returning: false,
    };
    if (this.onConflict) body.onConflict = this.onConflict;
    return apiQuery(body).then(onfulfilled as never, onrejected as never);
  }
}

class TableQuery {
  constructor(private table: string) {}

  select(columns = "*", options?: { count?: "exact"; head?: boolean }) {
    return new SelectBuilder(this.table, columns, options, [], [], undefined, undefined, "none");
  }

  insert(values: Record<string, unknown> | Record<string, unknown>[]) {
    const rows = Array.isArray(values) ? values : [values];
    return new InsertBuilder(this.table, rows);
  }

  upsert(values: Record<string, unknown>, opts?: { onConflict?: string }) {
    return new InsertBuilder(this.table, [values], opts?.onConflict);
  }

  update(values: Record<string, unknown>) {
    return new UpdateBuilder(this.table, values, []);
  }

  delete() {
    return new DeleteBuilder(this.table, []);
  }
}

class UpdateWithReturning implements PromiseLike<{ data: any; error: { message: string } | null }> {
  constructor(
    private table: string,
    private values: Record<string, unknown>,
    private filters: Filter[],
    private singleMode: "none" | "maybe" | "one" = "none",
  ) {}

  eq(column: string, value: unknown) {
    return new UpdateWithReturning(this.table, this.values, [...this.filters, { type: "eq", column, value }], this.singleMode);
  }
  neq(column: string, value: unknown) {
    return new UpdateWithReturning(this.table, this.values, [...this.filters, { type: "neq", column, value }], this.singleMode);
  }
  in(column: string, values: unknown[]) {
    return new UpdateWithReturning(this.table, this.values, [...this.filters, { type: "in", column, values }], this.singleMode);
  }
  maybeSingle() {
    return new UpdateWithReturning(this.table, this.values, this.filters, "maybe");
  }
  single() {
    return new UpdateWithReturning(this.table, this.values, this.filters, "one");
  }

  then<TResult1 = { data: any; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return apiQuery({
      action: "update",
      table: this.table,
      values: this.values,
      filters: this.filters,
      returning: true,
      single: this.singleMode === "none" ? undefined : this.singleMode,
    }).then(onfulfilled as never, onrejected as never);
  }
}

class UpdateBuilder implements PromiseLike<{ data: any; error: { message: string } | null }> {
  constructor(private table: string, private values: Record<string, unknown>, private filters: Filter[]) {}

  eq(column: string, value: unknown) {
    return new UpdateBuilder(this.table, this.values, [...this.filters, { type: "eq", column, value }]);
  }
  neq(column: string, value: unknown) {
    return new UpdateBuilder(this.table, this.values, [...this.filters, { type: "neq", column, value }]);
  }
  in(column: string, values: unknown[]) {
    return new UpdateBuilder(this.table, this.values, [...this.filters, { type: "in", column, values }]);
  }

  /** Request updated rows back (use to detect zero-row updates). */
  select(_columns?: string) {
    return new UpdateWithReturning(this.table, this.values, this.filters);
  }

  then<TResult1 = { data: any; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return apiQuery({
      action: "update",
      table: this.table,
      values: this.values,
      filters: this.filters,
    }).then(onfulfilled as never, onrejected as never);
  }
}

class DeleteBuilder implements PromiseLike<{ data: any; error: { message: string } | null }> {
  constructor(private table: string, private filters: Filter[]) {}

  eq(column: string, value: unknown) {
    return new DeleteBuilder(this.table, [...this.filters, { type: "eq", column, value }]);
  }
  in(column: string, values: unknown[]) {
    return new DeleteBuilder(this.table, [...this.filters, { type: "in", column, values }]);
  }

  then<TResult1 = { data: any; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return apiQuery({
      action: "delete",
      table: this.table,
      filters: this.filters,
    }).then(onfulfilled as never, onrejected as never);
  }
}

class FakeChannel {
  on(_event: string, _opts: unknown, _cb?: unknown) {
    return this;
  }
  subscribe(_cb?: (status: string) => void) {
    return { unsubscribe: () => {} };
  }
}

type AuthSessionPayload = { user: { id: string; email?: string }; access_token: string } | null;

type AuthListener = (event: string, session: AuthSessionPayload) => void;

function createAuth() {
  const listeners: AuthListener[] = [];
  let cachedSession: { access_token: string; user: { id: string; email?: string } } | null = null;

  async function refreshSessionFromToken() {
    const token = getToken();
    if (!token) {
      cachedSession = null;
      listeners.forEach((l) => l("SIGNED_OUT", null));
      return;
    }
    const { res, error: fetchError } = await safeFetch(apiUrl("/api/auth/me"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res) {
      setToken(null);
      cachedSession = null;
      listeners.forEach((l) => l("SIGNED_OUT", null));
      console.error("Auth refresh failed:", fetchError);
      return;
    }
    if (!res.ok) {
      setToken(null);
      cachedSession = null;
      listeners.forEach((l) => l("SIGNED_OUT", null));
      return;
    }
    const j = await res.json();
    cachedSession = {
      access_token: token,
      user: { id: j.user?.id, email: j.user?.email },
    };
    listeners.forEach((l) =>
      l("INITIAL_SESSION", { user: cachedSession!.user, access_token: cachedSession!.access_token }),
    );
  }

  return {
    async getSession() {
      await refreshSessionFromToken();
      return { data: { session: cachedSession }, error: null };
    },
    async signInWithPassword({ email, password }: { email: string; password: string }) {
      const { res, error: fetchError } = await safeFetch(apiUrl("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res) {
        return { data: null, error: { message: fetchError || "Failed to reach auth server" } };
      }
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return { data: null, error: { message: j.error || "Login failed" } };
      setToken(j.token);
      cachedSession = { access_token: j.token, user: { id: j.user.id, email: j.user.email } };
      listeners.forEach((l) =>
        l("SIGNED_IN", { user: cachedSession!.user, access_token: cachedSession!.access_token }),
      );
      return { data: { session: cachedSession }, error: null };
    },
    async signUp({ email, password, options }: { email: string; password: string; options?: { data?: { full_name?: string } } }) {
      const { res, error: fetchError } = await safeFetch(apiUrl("/api/auth/register"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          full_name: options?.data?.full_name,
        }),
      });
      if (!res) {
        return { data: null, error: { message: fetchError || "Failed to reach auth server" } };
      }
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return { data: null, error: { message: j.error || "Sign up failed" } };
      setToken(j.token);
      cachedSession = { access_token: j.token, user: { id: j.user.id, email: j.user.email } };
      listeners.forEach((l) =>
        l("SIGNED_IN", { user: cachedSession!.user, access_token: cachedSession!.access_token }),
      );
      return { data: { user: cachedSession.user }, error: null };
    },
    async signOut() {
      setToken(null);
      cachedSession = null;
      listeners.forEach((l) => l("SIGNED_OUT", null));
      return { error: null };
    },
    onAuthStateChange(cb: AuthListener) {
      listeners.push(cb);
      queueMicrotask(() => {
        refreshSessionFromToken().then(() => {
          if (cachedSession) cb("INITIAL_SESSION", { user: cachedSession.user, access_token: cachedSession.access_token });
          else cb("INITIAL_SESSION", null);
        });
      });
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              const i = listeners.indexOf(cb);
              if (i >= 0) listeners.splice(i, 1);
            },
          },
        },
      };
    },
  };
}

async function invokeFunction(name: string, opts?: { body?: unknown }) {
  const token = getToken();
  const { res, error: fetchError } = await safeFetch(apiUrl(`/api/functions/${name}`), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(opts?.body ?? {}),
  });
  if (!res) {
    return { data: null, error: { message: fetchError || "Failed to reach API" } };
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 501 || data.notImplemented) {
    return { data, error: { message: data.error || "Not implemented on API server" } };
  }
  if (!res.ok) {
    return { data: null, error: { message: data.error || data.message || res.statusText } };
  }
  if (data.success === false && data.error) {
    return { data, error: { message: String(data.error) } };
  }
  return { data, error: null };
}

export const supabase = {
  from(table: string) {
    return new TableQuery(table);
  },
  auth: createAuth(),
  channel(_name: string) {
    return new FakeChannel();
  },
  removeChannel(_ch: unknown) {},
  functions: {
    invoke: invokeFunction,
  },
};
