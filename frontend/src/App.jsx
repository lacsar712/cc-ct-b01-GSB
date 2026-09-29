import { createSignal, onMount, Show, For, createEffect } from "solid-js";
import {
  amendSubmission,
  clearSession,
  createSubmission,
  fetchSubmission,
  fetchSubmissions,
  getUser,
  login,
  setSession,
} from "./api";

const statusLabel = {
  pending: "待复核",
  processing: "复核中",
  done: "已完成",
};

const roleLabel = {
  machinist: "操作员",
  auditor: "复核员",
};

function readHash() {
  const raw = (location.hash || "#/").replace(/^#/, "") || "/";
  let m = raw.match(/^\/detail\/(\d+)/);
  if (m) return { name: "detail", id: Number(m[1]) };
  if (raw === "/restation") return { name: "restation", id: null };
  return { name: "home", id: null };
}

function App() {
  const [user, setUser] = createSignal(getUser());
  const [rows, setRows] = createSignal([]);
  const [detail, setDetail] = createSignal(null);
  const [route, setRoute] = createSignal(readHash());
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);

  const [loginUser, setLoginUser] = createSignal("machinist");
  const [loginPass, setLoginPass] = createSignal("machine123456");

  const [toolCode, setToolCode] = createSignal("");
  const [offsetUm, setOffsetUm] = createSignal("");

  // 重投台状态
  const [stationRows, setStationRows] = createSignal([]);
  const [stationLoading, setStationLoading] = createSignal(false);
  const [selected, setSelected] = createSignal(null); // 带 amendments 的完整行
  const [amendValue, setAmendValue] = createSignal("");
  const [amendMsg, setAmendMsg] = createSignal(null);
  const [amending, setAmending] = createSignal(false);

  function goHome() {
    location.hash = "#/";
  }

  function goDetail(id) {
    location.hash = `#/detail/${id}`;
  }

  function goStation() {
    location.hash = "#/restation";
  }

  async function loadRows() {
    setLoading(true);
    setError("");
    try {
      const data = await fetchSubmissions();
      setRows(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id) {
    setLoading(true);
    setError("");
    try {
      setDetail(await fetchSubmission(id));
    } catch (e) {
      setError(e.message);
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }

  async function loadStation({ silent = false } = {}) {
    if (!silent) setStationLoading(true);
    try {
      const data = await fetchSubmissions();
      setStationRows(data.filter((r) => r.status === "pending"));
      const cur = selected();
      if (cur) {
        const fresh = data.find((r) => r.id === cur.id);
        if (!fresh || fresh.status !== "pending") {
          // 选中的行已被领走（复核中）或结清：锁住改数区，只留履历可看
          setSelected(fresh || null);
          setAmendValue("");
          setAmendMsg({
            tone: "error",
            text: `该刀补已${fresh && fresh.status === "done" ? "结清" : "被领走复核中"}，不能再改。`,
          });
        }
        // 仍是待复核：保留 selected（改数成功后由 handleAmend 刷新为最新详情）
      }
    } catch (e) {
      setAmendMsg({ tone: "error", text: e.message });
    } finally {
      if (!silent) setStationLoading(false);
    }
  }

  async function selectRow(row) {
    setAmendMsg(null);
    try {
      const full = await fetchSubmission(row.id);
      setSelected(full);
      setAmendValue(String(full.offset_um));
    } catch (e) {
      setAmendMsg({ tone: "error", text: e.message });
    }
  }

  function clearSelection() {
    setSelected(null);
    setAmendValue("");
    setAmendMsg(null);
  }

  async function handleAmend(e) {
    e.preventDefault();
    const row = selected();
    if (!row) return;
    if (amendValue() === "" || Number.isNaN(Number(amendValue()))) {
      setAmendMsg({ tone: "error", text: "请输入有效的整数刀补（微米）" });
      return;
    }
    if (Number(amendValue()) === row.offset_um) {
      setAmendMsg({ tone: "error", text: "新刀补与当前值相同，无需重投" });
      return;
    }
    setAmending(true);
    setAmendMsg(null);
    try {
      const updated = await amendSubmission(row.id, amendValue());
      setSelected(updated);
      setAmendValue(String(updated.offset_um));
      setAmendMsg({
        tone: "ok",
        text: `重投成功：${updated.tool_code} 刀补已更新为 ${updated.offset_um} µm，重新进入待复核。`,
      });
      await loadStation({ silent: true });
    } catch (err) {
      // 认领先成 / 已复核中 / 已结清：改数明确失败
      setAmendMsg({ tone: "error", text: `改数失败：${err.message}` });
      try {
        setSelected(await fetchSubmission(row.id));
      } catch {
        /* 忽略二次拉取失败 */
      }
      await loadStation({ silent: true });
    } finally {
      setAmending(false);
    }
  }

  onMount(() => {
    const onHash = () => setRoute(readHash());
    window.addEventListener("hashchange", onHash);
    if (user()) {
      if (route().name === "detail") loadDetail(route().id);
      else if (route().name === "restation") loadStation();
      else loadRows();
    }
    return () => window.removeEventListener("hashchange", onHash);
  });

  createEffect(() => {
    const r = route();
    if (!user()) return;
    if (r.name === "detail" && r.id) loadDetail(r.id);
    else if (r.name === "restation") loadStation();
    else if (r.name === "home") loadRows();
  });

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    try {
      const data = await login(loginUser(), loginPass());
      setSession(data.token, {
        username: data.username,
        role: data.role,
        can_write: data.can_write,
      });
      setUser(getUser());
      goHome();
      await loadRows();
    } catch (err) {
      setError(err.message);
    }
  }

  function handleLogout() {
    clearSession();
    setUser(null);
    setRows([]);
    setDetail(null);
    clearSelection();
    goHome();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      await createSubmission(toolCode(), offsetUm());
      setToolCode("");
      setOffsetUm("");
      await loadRows();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div class="page">
      <header class="topbar">
        <div class="brand">
          <h1>数控刀补复核台</h1>
          <p class="hint">刀补绝对值不超过十二微米判合格，否则超差。后台认领进程用行锁跳过已占行领取待复核。</p>
        </div>
        <Show when={user()}>
          <nav class="topnav">
            <a
              href="#/"
              class={route().name === "home" ? "active" : ""}
              onClick={(e) => {
                e.preventDefault();
                goHome();
              }}
            >
              复核总览
            </a>
            <Show when={user().can_write}>
              <a
                href="#/restation"
                class={route().name === "restation" ? "active" : ""}
                onClick={(e) => {
                  e.preventDefault();
                  goStation();
                }}
              >
                重投台
              </a>
            </Show>
          </nav>
        </Show>
      </header>

      <Show when={error()}>
        <div class="banner error">{error()}</div>
      </Show>

      <Show
        when={user()}
        fallback={
          <section class="card">
            <h2>登录</h2>
            <form onSubmit={handleLogin} class="form">
              <label>
                用户名
                <input
                  value={loginUser()}
                  onInput={(e) => setLoginUser(e.currentTarget.value)}
                />
              </label>
              <label>
                密码
                <input
                  type="password"
                  value={loginPass()}
                  onInput={(e) => setLoginPass(e.currentTarget.value)}
                />
              </label>
              <button type="submit">进入系统</button>
            </form>
            <p class="hint">操作员 machinist / machine123456；复核员 auditor / audit123456（只读）</p>
          </section>
        }
      >
        <section class="card toolbar">
          <div>
            当前用户：<strong>{user().username}</strong>（{roleLabel[user().role] || user().role}）
          </div>
          <button type="button" class="ghost" onClick={handleLogout}>
            退出
          </button>
        </section>

        <Show when={route().name === "home"}>
          <Show when={user().can_write}>
            <section class="card">
              <h2>提交刀补</h2>
              <form onSubmit={handleSubmit} class="form inline">
                <label>
                  刀具编号
                  <input
                    placeholder="如 T01"
                    value={toolCode()}
                    onInput={(e) => setToolCode(e.currentTarget.value)}
                    required
                  />
                </label>
                <label>
                  刀补（微米）
                  <input
                    type="number"
                    value={offsetUm()}
                    onInput={(e) => setOffsetUm(e.currentTarget.value)}
                    required
                  />
                </label>
                <button type="submit">提交待复核</button>
              </form>
            </section>
          </Show>

          <section class="card">
            <div class="toolbar">
              <h2>复核列表</h2>
              <button type="button" class="ghost" onClick={loadRows} disabled={loading()}>
                {loading() ? "刷新中…" : "刷新"}
              </button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>刀具</th>
                  <th>刀补 µm</th>
                  <th>状态</th>
                  <th>结论</th>
                  <th>提交时间</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <For each={rows()}>
                  {(row) => (
                    <tr>
                      <td>{row.tool_code}</td>
                      <td>{row.offset_um}</td>
                      <td>{statusLabel[row.status] || row.status}</td>
                      <td class={row.verdict === "合格" ? "pass" : row.verdict === "超差" ? "fail" : ""}>
                        {row.verdict || "—"}
                      </td>
                      <td>{new Date(row.created_at).toLocaleString()}</td>
                      <td>
                        <button type="button" class="ghost" onClick={() => goDetail(row.id)}>
                          详情
                        </button>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
            <Show when={!rows().length && !loading()}>
              <p class="hint">暂无记录</p>
            </Show>
          </section>
        </Show>

        <Show
          when={route().name === "restation" && user().can_write}
          fallback={
            <Show when={route().name === "restation"}>
              <section class="card">
                <p class="hint">复核员账号只读，不能进入重投台改数；可在任意记录的详情页查看改数履历（旧值 → 新值）。</p>
              </section>
            </Show>
          }
        >
          <section class="card">
            <div class="toolbar">
              <h2>重投台 · 待改列表</h2>
              <div class="btn-row">
                <button type="button" class="ghost" onClick={loadStation} disabled={stationLoading()}>
                  {stationLoading() ? "刷新中…" : "刷新"}
                </button>
                <button type="button" class="ghost" onClick={goHome}>
                  返回总览
                </button>
              </div>
            </div>
            <p class="hint">只有仍为「待复核」、未被复核进程领走的刀补才能改数重投；已复核中或已结清的不在此列。</p>
            <table>
              <thead>
                <tr>
                  <th>刀具</th>
                  <th>当前刀补 µm</th>
                  <th>提交时间</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <For each={stationRows()}>
                  {(row) => (
                    <tr class={selected()?.id === row.id ? "row-selected" : ""}>
                      <td>{row.tool_code}</td>
                      <td>{row.offset_um}</td>
                      <td>{new Date(row.created_at).toLocaleString()}</td>
                      <td>
                        <button type="button" onClick={() => selectRow(row)}>
                          改数
                        </button>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
            <Show when={!stationRows().length && !stationLoading()}>
              <p class="hint">暂无待改刀补（都已被领走或结清）</p>
            </Show>
          </section>

          <section class="card">
            <h2>改数区</h2>
            <Show when={selected()} fallback={<p class="hint">请在上方待改列表点「改数」选择一条刀补。</p>}>
              {(sel) => (
                <div>
                  <p class="hint">
                    编号 {sel().id} · 刀具 <strong>{sel().tool_code}</strong> · 当前刀补{" "}
                    <strong>{sel().offset_um}</strong> µm · 状态{" "}
                    {statusLabel[sel().status] || sel().status}
                  </p>
                  <Show
                    when={sel().status === "pending"}
                    fallback={
                      <div class={`banner ${sel().status === "done" ? "error" : "warn"}`}>
                        该刀补已{sel().status === "done" ? "结清" : "被领走复核中"}，不能再改。
                      </div>
                    }
                  >
                    <form onSubmit={handleAmend} class="form inline">
                      <label>
                        新刀补（微米）
                        <input
                          type="number"
                          value={amendValue()}
                          onInput={(e) => setAmendValue(e.currentTarget.value)}
                          required
                        />
                      </label>
                      <button type="submit" disabled={amending()}>
                        {amending() ? "提交中…" : "确认重投"}
                      </button>
                      <button type="button" class="ghost" onClick={clearSelection}>
                        取消
                      </button>
                    </form>
                  </Show>
                  <Show when={amendMsg()}>
                    {(m) => (
                      <div class={`banner ${m().tone === "ok" ? "ok" : m().tone === "warn" ? "warn" : "error"}`}>
                        {m().text}
                      </div>
                    )}
                  </Show>
                </div>
              )}
            </Show>
          </section>

          <section class="card">
            <h2>履历详情</h2>
            <Show when={selected()} fallback={<p class="hint">选中一条刀补后在此查看旧值 → 新值履历。</p>}>
              {(sel) => (
                <Show
                  when={sel().amendments && sel().amendments.length}
                  fallback={<p class="hint">该刀补尚未改过数。</p>}
                >
                  <table>
                    <thead>
                      <tr>
                        <th>改前 µm</th>
                        <th>改后 µm</th>
                        <th>操作人</th>
                        <th>改数时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={sel().amendments}>
                        {(a) => (
                          <tr>
                            <td class="old-val">{a.old_offset_um}</td>
                            <td class="new-val">{a.new_offset_um}</td>
                            <td>{a.changed_by || "—"}</td>
                            <td>{new Date(a.created_at).toLocaleString()}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </Show>
              )}
            </Show>
          </section>
        </Show>

        <Show when={route().name === "detail"}>
          <section class="card">
            <div class="toolbar">
              <h2>刀补详情</h2>
              <button type="button" class="ghost" onClick={goHome}>
                返回总览
              </button>
            </div>
            <Show when={detail()} fallback={<p class="hint">{loading() ? "加载中…" : "未找到记录"}</p>}>
              {(d) => (
                <div>
                  <div class="detail-grid">
                    <p>编号：{d().id}</p>
                    <p>刀具：{d().tool_code}</p>
                    <p>刀补 µm：{d().offset_um}</p>
                    <p>状态：{statusLabel[d().status] || d().status}</p>
                    <p class={d().verdict === "合格" ? "pass" : d().verdict === "超差" ? "fail" : ""}>
                      结论：{d().verdict || "—"}
                    </p>
                    <p>提交时间：{new Date(d().created_at).toLocaleString()}</p>
                    <p>
                      复核时间：
                      {d().reviewed_at ? new Date(d().reviewed_at).toLocaleString() : "—"}
                    </p>
                  </div>

                  <h3>改数履历</h3>
                  <Show
                    when={d().amendments && d().amendments.length}
                    fallback={<p class="hint">无改数履历。</p>}
                  >
                    <table>
                      <thead>
                        <tr>
                          <th>改前 µm</th>
                          <th>改后 µm</th>
                          <th>操作人</th>
                          <th>改数时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={d().amendments}>
                          {(a) => (
                            <tr>
                              <td class="old-val">{a.old_offset_um}</td>
                              <td class="new-val">{a.new_offset_um}</td>
                              <td>{a.changed_by || "—"}</td>
                              <td>{new Date(a.created_at).toLocaleString()}</td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </Show>
                  <Show when={!user().can_write}>
                    <p class="hint">复核员账号只读：可查看履历，不能修改刀补数字。</p>
                  </Show>
                </div>
              )}
            </Show>
          </section>
        </Show>
      </Show>
    </div>
  );
}

export default App;
